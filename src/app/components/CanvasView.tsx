import {
  Eraser,
  FileText,
  Group,
  Highlighter,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  StickyNote,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { canvasDoc, canvasFromDoc, CANVAS_COLORS } from '../../core/canvas';
import type { CanvasData, CanvasEdge, CanvasNode, CanvasSide, CanvasStroke } from '../../core/canvas';
import { docToPlainText } from '../../core/doc';
import { displayTitle } from '../../core/model';
import type { DocNode, PageId } from '../../core/model';
import { findPagesByTitle } from '../../core/search';
import { isImagePath } from '../../core/vault/paths';
import { fileUrl } from '../platform/attachments';
import { openExternal } from '../platform/desktop';
import { newId } from '../platform/files';
import { openPage } from '../router';
import { openDialog } from '../ui';
import { getState, run, useWorkspace } from '../workspace';
import { Emoji } from './Emoji';
import { Popover } from './Popover';
import { t } from '../i18n';

interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

type Interaction =
  | { kind: 'pan'; startX: number; startY: number; origin: Viewport }
  | {
      kind: 'move';
      startX: number;
      startY: number;
      origins: Map<string, { x: number; y: number }>;
      moved: boolean;
    }
  | {
      kind: 'resize';
      id: string;
      // which way the card grows: both from the corner, one way from its right or bottom edge
      axis: 'both' | 'x' | 'y';
      startX: number;
      startY: number;
      width: number;
      height: number;
    }
  | { kind: 'connect'; from: string; side: CanvasSide; x: number; y: number }
  | { kind: 'draw'; points: number[] }
  | { kind: 'erase'; removed: boolean };

type Tool = 'select' | 'pen' | 'highlighter' | 'eraser';
const INK_WIDTHS = [2, 4, 8];
// the preset colours as ink, matching the card colours json canvas defines
const INK_COLORS: Record<string, string> = {
  '1': '#e5484d',
  '2': '#e8803a',
  '3': '#d6a72a',
  '4': '#4d9a5c',
  '5': '#3f9bb3',
  '6': '#8b5fc7',
};

export function inkColor(color: string | undefined): string {
  if (!color) return 'var(--text)';
  return INK_COLORS[color] ?? color;
}

// a smooth line through the points, each corner becomes a curve through the midpoints
export function strokePath(points: number[]): string {
  if (points.length < 2) return '';
  if (points.length <= 4) {
    const [x, y] = points;
    const [x2, y2] = points.length === 4 ? [points[2]!, points[3]!] : [x! + 0.01, y!];
    return `M ${x} ${y} L ${x2} ${y2}`;
  }
  let path = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    const midX = (points[i]! + points[i + 2]!) / 2;
    const midY = (points[i + 1]! + points[i + 3]!) / 2;
    path += ` Q ${points[i]} ${points[i + 1]} ${midX} ${midY}`;
  }
  return `${path} L ${points[points.length - 2]} ${points[points.length - 1]}`;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const SAVE_DELAY_MS = 400;
const MAX_HISTORY = 100;

function anchor(node: CanvasNode, side: CanvasSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y };
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 };
    default:
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

// the side of a card that faces a point, used when an edge does not say
function facing(node: CanvasNode, x: number, y: number): CanvasSide {
  const dx = x - (node.x + node.width / 2);
  const dy = y - (node.y + node.height / 2);
  if (Math.abs(dx) / node.width > Math.abs(dy) / node.height) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

const NORMAL: Record<CanvasSide, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function edgePath(
  from: { x: number; y: number },
  fromSide: CanvasSide,
  to: { x: number; y: number },
  toSide: CanvasSide | null,
): string {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const bend = Math.min(150, Math.max(30, distance / 2));
  const a = NORMAL[fromSide];
  const b = toSide ? NORMAL[toSide] : { x: 0, y: 0 };
  return `M ${from.x} ${from.y} C ${from.x + a.x * bend} ${from.y + a.y * bend}, ${to.x + b.x * bend} ${to.y + b.y * bend}, ${to.x} ${to.y}`;
}

function colorStyle(color: string | undefined): React.CSSProperties | undefined {
  return color?.startsWith('#') ? ({ '--card-color': color } as React.CSSProperties) : undefined;
}

export function CanvasView({
  pageId,
  doc,
  editable,
  embedded = false,
}: {
  pageId: PageId;
  doc: DocNode | undefined;
  editable: boolean;
  // shown inside a page, where the wheel scrolls the page until the canvas has focus
  embedded?: boolean;
}) {
  // every canvas on screen needs its own arrow head, a shared id breaks once the first one goes away
  const arrowId = `canvas-arrow-${useId().replace(/[^\w-]/g, '')}`;
  const [data, setData] = useState<CanvasData>(() => canvasFromDoc(doc));
  const [view, setView] = useState<Viewport>({ x: 80, y: 80, zoom: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pageAnchor, setPageAnchor] = useState<HTMLElement | null>(null);
  // the edge being drawn from a card's handle
  const [tool, setTool] = useState<Tool>('select');
  const [ink, setInk] = useState<{ color?: string; width: number }>({ width: 4 });
  // the line being drawn right now, in canvas coordinates
  const [draft, setDraft] = useState<number[] | null>(null);
  const activeDrawing = useRef<string | null>(null);
  const [link, setLink] = useState<{ from: string; side: CanvasSide; x: number; y: number } | null>(null);
  const interaction = useRef<Interaction | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const saved = useRef<DocNode | undefined>(doc);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<CanvasData | null>(null);
  const history = useRef<{ past: CanvasData[]; future: CanvasData[] }>({ past: [], future: [] });
  const dataRef = useRef(data);
  useLayoutEffect(() => {
    dataRef.current = data;
  }, [data]);

  const save = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    const nextDoc = canvasDoc(next);
    saved.current = nextDoc;
    run({ type: 'page.setDoc', id: pageId, doc: nextDoc, now: Date.now() });
  }, [pageId]);

  useEffect(() => () => save(), [save]);

  // the canvas was changed elsewhere, for example in another app, while nothing is waiting to be saved
  useEffect(() => {
    if (doc === saved.current || pending.current || interaction.current) return;
    saved.current = doc;
    setData(canvasFromDoc(doc));
  }, [doc]);

  const commit = useCallback(
    (next: CanvasData, record = true) => {
      if (record) {
        history.current.past = [...history.current.past.slice(-MAX_HISTORY + 1), dataRef.current];
        history.current.future = [];
      }
      setData(next);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, SAVE_DELAY_MS);
    },
    [save],
  );

  const undo = () => {
    const previous = history.current.past.pop();
    if (!previous) return;
    history.current.future.push(dataRef.current);
    commit(previous, false);
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(dataRef.current);
    commit(next, false);
  };

  const toWorld = (clientX: number, clientY: number) => {
    const rect = rootRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom };
  };

  const center = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const addNode = (node: Omit<CanvasNode, 'id'>, edit = false) => {
    const created = { ...node, id: newId().replace(/-/g, '').slice(0, 16) } as CanvasNode;
    commit({ ...data, nodes: node.type === 'group' ? [created, ...data.nodes] : [...data.nodes, created] });
    setSelected(new Set([created.id]));
    if (edit) setEditing(created.id);
    return created;
  };

  const updateNode = (id: string, patch: Partial<CanvasNode>, record = true) =>
    commit(
      {
        ...dataRef.current,
        nodes: dataRef.current.nodes.map((node) =>
          node.id === id ? ({ ...node, ...patch } as CanvasNode) : node,
        ),
      },
      record,
    );

  const removeSelection = () => {
    if (selectedEdge) {
      commit({ ...data, edges: data.edges.filter((edge) => edge.id !== selectedEdge) });
      setSelectedEdge(null);
      return;
    }
    if (selected.size === 0) return;
    commit({
      nodes: data.nodes.filter((node) => !selected.has(node.id)),
      edges: data.edges.filter((edge) => !selected.has(edge.fromNode) && !selected.has(edge.toNode)),
    });
    setSelected(new Set());
  };

  const fit = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || data.nodes.length === 0) {
      setView({ x: 80, y: 80, zoom: 1 });
      return;
    }
    const minX = Math.min(...data.nodes.map((node) => node.x));
    const minY = Math.min(...data.nodes.map((node) => node.y));
    const maxX = Math.max(...data.nodes.map((node) => node.x + node.width));
    const maxY = Math.max(...data.nodes.map((node) => node.y + node.height));
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min((rect.width - 120) / (maxX - minX || 1), (rect.height - 120) / (maxY - minY || 1), 1.2),
      ),
    );
    setView({
      zoom,
      x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
      y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
    });
  };

  // start fitted to what is on the canvas
  useEffect(() => {
    fit();
    // only when the canvas first opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const rect = rootRef.current!.getBoundingClientRect();
    const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
    setView((current) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * factor));
      return {
        zoom,
        x: px - ((px - current.x) / current.zoom) * zoom,
        y: py - ((py - current.y) / current.zoom) * zoom,
      };
    });
  };

  // wheel listener is attached by hand so it can prevent the page from scrolling
  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const zooming = event.ctrlKey || event.metaKey;
      if (embedded && !zooming && !element.contains(document.activeElement)) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY / 300), event.clientX, event.clientY);
      else setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  // a finished line joins the drawing it was drawn on or next to, otherwise it starts a new one
  const finishStroke = (points: number[]) => {
    if (points.length === 2) points.push(points[0]! + 0.5, points[1]! + 0.5);
    const highlighter = tool === 'highlighter';
    const width = highlighter ? ink.width * 3.5 : ink.width;
    const xs = points.filter((_, index) => index % 2 === 0);
    const ys = points.filter((_, index) => index % 2 === 1);
    const box = {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
    const current = dataRef.current;
    const near = current.nodes.find(
      (node): node is Extract<CanvasNode, { type: 'drawing' }> =>
        node.type === 'drawing' &&
        node.id === activeDrawing.current &&
        box.maxX > node.x - 160 &&
        box.minX < node.x + node.width + 160 &&
        box.maxY > node.y - 160 &&
        box.minY < node.y + node.height + 160,
    );
    const absolute = (near?.strokes ?? []).map((stroke) => ({
      ...stroke,
      points: stroke.points.map((value, index) => value + (index % 2 === 0 ? near!.x : near!.y)),
    }));
    const stroke: CanvasStroke = {
      points,
      width,
      ...(ink.color ? { color: ink.color } : {}),
      ...(highlighter ? { highlighter: true } : {}),
    };
    const all = [...absolute, stroke];
    const pad = Math.max(...all.map((item) => item.width)) / 2 + 6;
    const allX = all.flatMap((item) => item.points.filter((_, index) => index % 2 === 0));
    const allY = all.flatMap((item) => item.points.filter((_, index) => index % 2 === 1));
    const x = Math.floor(Math.min(...allX) - pad);
    const y = Math.floor(Math.min(...allY) - pad);
    const node: CanvasNode = {
      id: near?.id ?? newId().replace(/-/g, '').slice(0, 16),
      type: 'drawing',
      x,
      y,
      width: Math.ceil(Math.max(...allX) + pad - x),
      height: Math.ceil(Math.max(...allY) + pad - y),
      strokes: all.map((item) => ({
        ...item,
        points: item.points.map((value, index) => Math.round((value - (index % 2 === 0 ? x : y)) * 10) / 10),
      })),
    };
    activeDrawing.current = node.id;
    commit({
      ...current,
      nodes: near
        ? current.nodes.map((item) => (item.id === near.id ? node : item))
        : [...current.nodes, node],
    });
  };

  // removes every line passing under the eraser, and drawings left empty
  const eraseAt = (px: number, py: number) => {
    const radius = 10 / view.zoom;
    const current = dataRef.current;
    let changed = false;
    const nodes = current.nodes.flatMap<CanvasNode>((node) => {
      if (node.type !== 'drawing') return [node];
      if (
        px < node.x - radius ||
        px > node.x + node.width + radius ||
        py < node.y - radius ||
        py > node.y + node.height + radius
      )
        return [node];
      const strokes = node.strokes.filter((stroke) => {
        const reach = radius + stroke.width / 2;
        for (let i = 0; i < stroke.points.length; i += 2) {
          if (Math.hypot(stroke.points[i]! + node.x - px, stroke.points[i + 1]! + node.y - py) <= reach)
            return false;
        }
        return true;
      });
      if (strokes.length === node.strokes.length) return [node];
      changed = true;
      return strokes.length ? [{ ...node, strokes }] : [];
    });
    if (!changed) return;
    if (interaction.current?.kind === 'erase') interaction.current.removed = true;
    const next = {
      nodes,
      edges: current.edges.filter(
        (edge) => nodes.some((n) => n.id === edge.fromNode) && nodes.some((n) => n.id === edge.toNode),
      ),
    };
    dataRef.current = next;
    setData(next);
  };

  const chooseTool = (next: Tool) => {
    setTool(next);
    activeDrawing.current = null;
    if (next !== 'select') {
      setSelected(new Set());
      setEditing(null);
    }
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest('.canvas-toolbar, textarea, input, button:not(.canvas-node)')) return;
    rootRef.current?.focus();
    if (editable && tool !== 'select' && event.button === 0) {
      const point = toWorld(event.clientX, event.clientY);
      if (tool === 'eraser') {
        history.current.past = [...history.current.past.slice(-MAX_HISTORY + 1), dataRef.current];
        history.current.future = [];
        interaction.current = { kind: 'erase', removed: false };
        eraseAt(point.x, point.y);
      } else {
        interaction.current = { kind: 'draw', points: [point.x, point.y] };
        setDraft([point.x, point.y]);
      }
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      return;
    }
    const handle = target.closest<HTMLElement>('[data-handle]');
    const nodeElement = target.closest<HTMLElement>('[data-node]');
    if (handle && editable) {
      const id = handle.dataset.node!;
      const resize = handle.dataset.handle?.match(/^resize(?:-(x|y))?$/);
      if (resize) {
        const node = data.nodes.find((item) => item.id === id)!;
        interaction.current = {
          kind: 'resize',
          id,
          axis: (resize[1] as 'x' | 'y' | undefined) ?? 'both',
          startX: event.clientX,
          startY: event.clientY,
          width: node.width,
          height: node.height,
        };
      } else {
        const point = toWorld(event.clientX, event.clientY);
        const side = handle.dataset.handle as CanvasSide;
        interaction.current = { kind: 'connect', from: id, side, x: point.x, y: point.y };
        setLink({ from: id, side, ...point });
      }
    } else if (nodeElement && event.button === 0) {
      const id = nodeElement.dataset.node!;
      if (editing === id) return;
      const next = new Set(event.shiftKey ? selected : selected.has(id) ? selected : []);
      if (event.shiftKey && next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
      setSelectedEdge(null);
      if (editable) {
        // moving a group moves the cards inside it
        const moving = new Set(next);
        for (const node of data.nodes) {
          if (node.type !== 'group' || !next.has(node.id)) continue;
          for (const inner of data.nodes) {
            if (
              inner.x >= node.x &&
              inner.y >= node.y &&
              inner.x + inner.width <= node.x + node.width &&
              inner.y + inner.height <= node.y + node.height
            )
              moving.add(inner.id);
          }
        }
        interaction.current = {
          kind: 'move',
          startX: event.clientX,
          startY: event.clientY,
          origins: new Map(
            data.nodes
              .filter((node) => moving.has(node.id))
              .map((node) => [node.id, { x: node.x, y: node.y }]),
          ),
          moved: false,
        };
      }
    } else {
      if (!event.shiftKey) setSelected(new Set());
      setSelectedEdge(null);
      setEditing(null);
      interaction.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, origin: view };
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const current = interaction.current;
    if (!current) return;
    if (current.kind === 'draw') {
      const point = toWorld(event.clientX, event.clientY);
      const last = current.points.length;
      // points closer than a pixel add nothing but weight
      if (
        Math.hypot(point.x - current.points[last - 2]!, point.y - current.points[last - 1]!) * view.zoom <
        1.5
      )
        return;
      current.points.push(point.x, point.y);
      setDraft([...current.points]);
      return;
    }
    if (current.kind === 'erase') {
      const point = toWorld(event.clientX, event.clientY);
      eraseAt(point.x, point.y);
      return;
    }
    if (current.kind === 'pan') {
      setView({
        ...current.origin,
        x: current.origin.x + event.clientX - current.startX,
        y: current.origin.y + event.clientY - current.startY,
      });
    } else if (current.kind === 'move') {
      const dx = (event.clientX - current.startX) / view.zoom;
      const dy = (event.clientY - current.startY) / view.zoom;
      if (!current.moved && Math.hypot(dx, dy) < 3) return;
      if (!current.moved) history.current.past.push(dataRef.current);
      current.moved = true;
      const nodes = dataRef.current.nodes.map((node) => {
        const origin = current.origins.get(node.id);
        return origin ? { ...node, x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) } : node;
      });
      setData({ ...dataRef.current, nodes });
    } else if (current.kind === 'resize') {
      const dx = current.axis === 'y' ? 0 : event.clientX - current.startX;
      const dy = current.axis === 'x' ? 0 : event.clientY - current.startY;
      const width = Math.max(60, Math.round(current.width + dx / view.zoom));
      const height = Math.max(40, Math.round(current.height + dy / view.zoom));
      setData({
        ...dataRef.current,
        nodes: dataRef.current.nodes.map((node) =>
          node.id === current.id ? { ...node, width, height } : node,
        ),
      });
    } else if (current.kind === 'connect') {
      setLink({ from: current.from, side: current.side, ...toWorld(event.clientX, event.clientY) });
    }
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const current = interaction.current;
    interaction.current = null;
    if (!current) return;
    if (current.kind === 'draw') {
      setDraft(null);
      finishStroke(current.points);
      return;
    }
    if (current.kind === 'erase') {
      if (current.removed) commit(dataRef.current, false);
      else history.current.past.pop();
      return;
    }
    if (current.kind === 'move' && current.moved) commit(dataRef.current, false);
    else if (current.kind === 'resize') {
      const resized = dataRef.current.nodes.find((node) => node.id === current.id);
      if (
        resized?.type === 'drawing' &&
        (resized.width !== current.width || resized.height !== current.height)
      ) {
        const sx = resized.width / current.width;
        const sy = resized.height / current.height;
        const strokes = resized.strokes.map((stroke) => ({
          ...stroke,
          points: stroke.points.map((value, index) => (index % 2 === 0 ? value * sx : value * sy)),
        }));
        dataRef.current = {
          ...dataRef.current,
          nodes: dataRef.current.nodes.map((node) =>
            node.id === resized.id ? { ...resized, strokes } : node,
          ),
        };
      }
      history.current.past.push({
        ...dataRef.current,
        nodes: dataRef.current.nodes.map((node) =>
          node.id === current.id ? { ...node, width: current.width, height: current.height } : node,
        ),
      });
      commit(dataRef.current, false);
    } else if (current.kind === 'connect') {
      setLink(null);
      const point = toWorld(event.clientX, event.clientY);
      const target = [...data.nodes]
        .reverse()
        .find(
          (node) =>
            node.id !== current.from &&
            node.type !== 'group' &&
            point.x >= node.x &&
            point.x <= node.x + node.width &&
            point.y >= node.y &&
            point.y <= node.y + node.height,
        );
      if (target) {
        const from = data.nodes.find((node) => node.id === current.from)!;
        const edge: CanvasEdge = {
          id: newId().replace(/-/g, '').slice(0, 16),
          fromNode: current.from,
          toNode: target.id,
          fromSide: current.side,
          toSide: facing(target, anchor(from, current.side).x, anchor(from, current.side).y),
        };
        commit({ ...data, edges: [...data.edges, edge] });
      } else {
        // dropping in empty space makes a new card joined to this one
        const card = {
          type: 'text' as const,
          text: '',
          x: Math.round(point.x - 125),
          y: Math.round(point.y - 30),
          width: 250,
          height: 60,
        };
        const id = newId().replace(/-/g, '').slice(0, 16);
        const node = { ...card, id } as CanvasNode;
        commit({
          nodes: [...data.nodes, node],
          edges: [
            ...data.edges,
            {
              id: `${id}e`,
              fromNode: current.from,
              toNode: id,
              fromSide: current.side,
              toSide: facing(
                node,
                anchor(
                  data.nodes.find((n) => n.id === current.from)!,
                  current.side,
                ).x,
                anchor(
                  data.nodes.find((n) => n.id === current.from)!,
                  current.side,
                ).y,
              ),
            },
          ],
        });
        setSelected(new Set([id]));
        setEditing(id);
      }
    }
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    if (!editable) return;
    const target = event.target as HTMLElement;
    const nodeElement = target.closest<HTMLElement>('[data-node]');
    if (nodeElement) {
      const node = data.nodes.find((item) => item.id === nodeElement.dataset.node);
      if (node?.type === 'text') setEditing(node.id);
      else if (node?.type === 'page') openPage(node.pageId);
      else if (node?.type === 'link') openExternal(node.url);
      else if (node?.type === 'group')
        openDialog({
          kind: 'source',
          title: t('canvas.groupName'),
          value: node.label ?? '',
          language: 'markdown',
          onSave: (label) => updateNode(node.id, { label: label.trim() || undefined } as Partial<CanvasNode>),
        });
      return;
    }
    if (target.closest('.canvas-toolbar')) return;
    const point = toWorld(event.clientX, event.clientY);
    addNode(
      {
        type: 'text',
        text: '',
        x: Math.round(point.x - 125),
        y: Math.round(point.y - 30),
        width: 250,
        height: 60,
      } as Omit<CanvasNode, 'id'>,
      true,
    );
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing || (event.target as HTMLElement).closest('input, textarea')) return;
    const mod = event.ctrlKey || event.metaKey;
    if (!mod && editable && !event.altKey) {
      const key = event.key.toLowerCase();
      const chosen: Tool | null =
        key === 'v'
          ? 'select'
          : key === 'p'
            ? 'pen'
            : key === 'h'
              ? 'highlighter'
              : key === 'e'
                ? 'eraser'
                : null;
      if (chosen) {
        event.preventDefault();
        chooseTool(chosen);
        return;
      }
      if (event.key === 'Escape' && tool !== 'select') {
        chooseTool('select');
        return;
      }
    }
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      redo();
    } else if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelected(new Set(data.nodes.map((node) => node.id)));
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && editable) {
      event.preventDefault();
      removeSelection();
    } else if (event.key === 'Escape') {
      setSelected(new Set());
      setSelectedEdge(null);
    } else if (event.key === 'Enter' && selected.size === 1 && editable) {
      const node = data.nodes.find((item) => selected.has(item.id));
      if (node?.type === 'text') {
        event.preventDefault();
        setEditing(node.id);
      }
    } else if (event.key.startsWith('Arrow') && selected.size > 0 && editable) {
      event.preventDefault();
      const step = event.shiftKey ? 50 : 10;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      commit({
        ...data,
        nodes: data.nodes.map((node) =>
          selected.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node,
        ),
      });
    }
  };

  const byId = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes]);
  const ordered = useMemo(
    () => [
      ...data.nodes.filter((node) => node.type === 'group'),
      ...data.nodes.filter((node) => node.type !== 'group'),
    ],
    [data.nodes],
  );
  const selectedNodes = data.nodes.filter((node) => selected.has(node.id));

  return (
    <div
      ref={rootRef}
      className={`canvas-view tool-${tool}`}
      tabIndex={0}
      role="application"
      aria-label={t('canvas.canvasAria')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      style={
        {
          '--grid-size': `${24 * view.zoom}px`,
          '--grid-x': `${view.x}px`,
          '--grid-y': `${view.y}px`,
        } as React.CSSProperties
      }
    >
      <div
        className="canvas-world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <svg className="canvas-edges" width="1" height="1" aria-hidden="true">
          {draft && (
            <path
              d={strokePath(draft)}
              className="canvas-ink-draft"
              fill="none"
              stroke={inkColor(ink.color)}
              strokeWidth={tool === 'highlighter' ? ink.width * 3.5 : ink.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={tool === 'highlighter' ? 0.35 : 1}
            />
          )}
          <defs>
            <marker
              id={arrowId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {data.edges.map((edge) => {
            const from = byId.get(edge.fromNode);
            const to = byId.get(edge.toNode);
            if (!from || !to) return null;
            const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
            const fromSide = edge.fromSide ?? facing(from, toCenter.x, toCenter.y);
            const start = anchor(from, fromSide);
            const toSide = edge.toSide ?? facing(to, start.x, start.y);
            const finish = anchor(to, toSide);
            const path = edgePath(start, fromSide, finish, toSide);
            const mid = { x: (start.x + finish.x) / 2, y: (start.y + finish.y) / 2 };
            return (
              <g
                key={edge.id}
                className={`canvas-edge${selectedEdge === edge.id ? ' is-selected' : ''}${edge.color ? ` canvas-color-${edge.color}` : ''}`}
                style={colorStyle(edge.color)}
              >
                <path
                  d={path}
                  className="canvas-edge-hit"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelectedEdge(edge.id);
                    setSelected(new Set());
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!editable) return;
                    openDialog({
                      kind: 'source',
                      title: t('canvas.label'),
                      value: edge.label ?? '',
                      language: 'markdown',
                      onSave: (label) =>
                        commit({
                          ...dataRef.current,
                          edges: dataRef.current.edges.map((item) =>
                            item.id === edge.id ? { ...item, label: label.trim() || undefined } : item,
                          ),
                        }),
                    });
                  }}
                />
                <path
                  d={path}
                  className="canvas-edge-line"
                  markerEnd={edge.toEnd === 'none' ? undefined : `url(#${arrowId})`}
                  markerStart={edge.fromEnd === 'arrow' ? `url(#${arrowId})` : undefined}
                />
                {edge.label && (
                  <text
                    x={mid.x}
                    y={mid.y}
                    className="canvas-edge-label"
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {link && byId.get(link.from) && (
            <path
              d={edgePath(anchor(byId.get(link.from)!, link.side), link.side, link, null)}
              className="canvas-edge-line is-drafting"
            />
          )}
        </svg>
        {ordered.map((node) => (
          <CanvasCard
            key={node.id}
            node={node}
            selected={selected.has(node.id)}
            editing={editing === node.id}
            editable={editable}
            onText={(text) => {
              updateNode(node.id, { text } as Partial<CanvasNode>);
              setEditing(null);
            }}
          />
        ))}
      </div>

      <div className="canvas-toolbar" role="toolbar" aria-label={t('canvas.canvasTools')}>
        {editable && (
          <>
            {(
              [
                ['select', MousePointer2, 'Select and move (V)'],
                ['pen', Pencil, 'Pen (P)'],
                ['highlighter', Highlighter, 'Highlighter (H)'],
                ['eraser', Eraser, 'Eraser (E)'],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                className={`icon-button${tool === value ? ' is-tool' : ''}`}
                title={label}
                aria-label={label}
                aria-pressed={tool === value}
                onClick={() => chooseTool(value)}
              >
                <Icon size={16} />
              </button>
            ))}
            {(tool === 'pen' || tool === 'highlighter') && (
              <>
                <span className="toolbar-divider" />
                {[undefined, ...CANVAS_COLORS].map((color) => (
                  <button
                    key={color ?? 'ink'}
                    type="button"
                    className={`canvas-swatch ink-swatch${ink.color === color ? ' is-active' : ''}`}
                    style={{ '--card-color': inkColor(color) } as React.CSSProperties}
                    aria-label={color ? `Ink colour ${color}` : 'Ink in the text colour'}
                    onClick={() => setInk((current) => ({ ...current, color }))}
                  />
                ))}
                {INK_WIDTHS.map((width) => (
                  <button
                    key={width}
                    type="button"
                    className={`icon-button ink-width${ink.width === width ? ' is-tool' : ''}`}
                    aria-label={t('canvas.lineWidth', { width })}
                    onClick={() => setInk((current) => ({ ...current, width }))}
                  >
                    <span style={{ width: width + 4, height: width + 4 }} />
                  </button>
                ))}
              </>
            )}
            <span className="toolbar-divider" />
            <button
              type="button"
              className="icon-button"
              title={t('canvas.addACard')}
              aria-label={t('canvas.addACard')}
              onClick={() => {
                const point = center();
                addNode(
                  {
                    type: 'text',
                    text: '',
                    x: Math.round(point.x - 125),
                    y: Math.round(point.y - 30),
                    width: 250,
                    height: 60,
                  } as Omit<CanvasNode, 'id'>,
                  true,
                );
              }}
            >
              <StickyNote size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              title={t('canvas.addAPage')}
              aria-label={t('canvas.addAPage')}
              onClick={(event) => setPageAnchor(event.currentTarget)}
            >
              <FileText size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              title={t('canvas.addAGroup')}
              aria-label={t('canvas.addAGroup')}
              onClick={() => {
                const point = center();
                addNode({
                  type: 'group',
                  label: t('canvas.group'),
                  x: Math.round(point.x - 200),
                  y: Math.round(point.y - 150),
                  width: 400,
                  height: 300,
                } as Omit<CanvasNode, 'id'>);
              }}
            >
              <Group size={16} />
            </button>
            <span className="toolbar-divider" />
            <button
              type="button"
              className="icon-button"
              title={t('toasts.undo')}
              aria-label={t('toasts.undo')}
              onClick={undo}
            >
              <Undo2 size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              title={t('canvas.redo')}
              aria-label={t('canvas.redo')}
              onClick={redo}
            >
              <Redo2 size={16} />
            </button>
            <span className="toolbar-divider" />
          </>
        )}
        <button
          type="button"
          className="icon-button"
          title={t('canvas.zoomOut')}
          aria-label={t('canvas.zoomOut')}
          onClick={() => zoomAt(1 / 1.25)}
        >
          <Minus size={16} />
        </button>
        <span className="canvas-zoom">{Math.round(view.zoom * 100)}%</span>
        <button
          type="button"
          className="icon-button"
          title={t('canvas.zoomIn')}
          aria-label={t('canvas.zoomIn')}
          onClick={() => zoomAt(1.25)}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          title={t('canvas.fitEverythingInView')}
          aria-label={t('canvas.fitEverythingInView')}
          onClick={fit}
        >
          <Maximize size={16} />
        </button>
        {editable && (selectedNodes.length > 0 || selectedEdge) && (
          <>
            <span className="toolbar-divider" />
            {[undefined, ...CANVAS_COLORS].map((color) => (
              <button
                key={color ?? 'none'}
                type="button"
                className={`canvas-swatch${color ? ` canvas-color-${color}` : ''}`}
                aria-label={color ? `Colour ${color}` : 'No colour'}
                onClick={() => {
                  if (selectedEdge)
                    commit({
                      ...data,
                      edges: data.edges.map((edge) => (edge.id === selectedEdge ? { ...edge, color } : edge)),
                    });
                  else
                    commit({
                      ...data,
                      nodes: data.nodes.map((node) => (selected.has(node.id) ? { ...node, color } : node)),
                    });
                }}
              />
            ))}
            <button
              type="button"
              className="icon-button"
              title={t('common.delete')}
              aria-label={t('canvas.deleteSelection')}
              onClick={removeSelection}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
      {data.nodes.length === 0 && (
        <p className="canvas-empty muted">{t('canvas.emptyHint')}</p>
      )}
      {pageAnchor && (
        <PagePicker
          anchor={pageAnchor}
          exclude={pageId}
          onClose={() => setPageAnchor(null)}
          onPick={(id) => {
            const point = center();
            addNode({
              type: 'page',
              pageId: id,
              x: Math.round(point.x - 200),
              y: Math.round(point.y - 120),
              width: 400,
              height: 240,
            } as Omit<CanvasNode, 'id'>);
            setPageAnchor(null);
          }}
        />
      )}
    </div>
  );
}

function PagePicker({
  anchor: element,
  exclude,
  onClose,
  onPick,
}: {
  anchor: HTMLElement;
  exclude: PageId;
  onClose: () => void;
  onPick: (id: PageId) => void;
}) {
  const [query, setQuery] = useState('');
  const pages = findPagesByTitle(getState(), query, 10).filter((page) => page.id !== exclude);
  return (
    <Popover anchor={element} onClose={onClose} label={t('canvas.addAPage')} className="option-picker">
      <input
        className="text-input small"
        data-autofocus
        placeholder={t('dialogs.move.placeholder')}
        aria-label={t('dialogs.move.placeholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && pages[0]) onPick(pages[0].id);
        }}
      />
      <ul className="option-list">
        {pages.map((page) => (
          <li key={page.id}>
            <button type="button" className="option-row" onClick={() => onPick(page.id)}>
              {displayTitle(page)}
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

function CanvasCard({
  node,
  selected,
  editing,
  editable,
  onText,
}: {
  node: CanvasNode;
  selected: boolean;
  editing: boolean;
  editable: boolean;
  onText: (text: string) => void;
}) {
  const color =
    node.color && !node.color.startsWith('#')
      ? ` canvas-color-${node.color}`
      : node.color
        ? ' has-color'
        : '';
  return (
    <div
      className={`canvas-node canvas-${node.type}${selected ? ' is-selected' : ''}${color}`}
      data-node={node.id}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height, ...colorStyle(node.color) }}
    >
      {node.type === 'group' && <span className="canvas-group-label">{node.label ?? ''}</span>}
      {node.type === 'text' &&
        (editing ? <TextEditor text={node.text} onDone={onText} /> : <TextCard text={node.text} />)}
      {node.type === 'page' && <PageCard pageId={node.pageId} />}
      {node.type === 'drawing' && <DrawingCard node={node} />}
      {node.type === 'file' && <FileCard path={node.file} />}
      {node.type === 'link' && (
        <div className="canvas-link">
          <strong>{safeHost(node.url)}</strong>
          <span className="muted small">{node.url}</span>
        </div>
      )}
      {editable && selected && node.type !== 'group' && node.type !== 'drawing' && (
        <>
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <span
              key={side}
              className={`canvas-handle canvas-handle-${side}`}
              data-handle={side}
              data-node={node.id}
            />
          ))}
        </>
      )}
      {editable && (
        // the right and bottom edges stretch a card one way, the corner both, without selecting it first
        <>
          <span className="canvas-resize-edge is-x" data-handle="resize-x" data-node={node.id} />
          <span className="canvas-resize-edge is-y" data-handle="resize-y" data-node={node.id} />
          <span className="canvas-resize" data-handle="resize" data-node={node.id} />
        </>
      )}
    </div>
  );
}

function DrawingCard({ node }: { node: Extract<CanvasNode, { type: 'drawing' }> }) {
  return (
    <svg
      className="canvas-drawing"
      width={node.width}
      height={node.height}
      viewBox={`0 0 ${node.width} ${node.height}`}
      aria-label={t('canvas.drawing')}
    >
      {node.strokes.map((stroke, index) => (
        <path
          key={index}
          d={strokePath(stroke.points)}
          fill="none"
          stroke={inkColor(stroke.color)}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={stroke.highlighter ? 0.35 : 1}
        />
      ))}
    </svg>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function TextEditor({ text, onDone }: { text: string; onDone: (text: string) => void }) {
  const [value, setValue] = useState(text);
  return (
    <textarea
      className="canvas-textarea"
      autoFocus
      aria-label={t('canvas.cardText')}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          onDone(value);
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}

// card text is markdown, headings and lists are shown lightly styled
function TextCard({ text }: { text: string }) {
  if (!text.trim()) return <span className="canvas-placeholder">{t('canvas.emptyCard')}</span>;
  return (
    <div className="canvas-text">
      {text.split('\n').map((line, index) => {
        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading)
          return (
            <p key={index} className={`canvas-h${heading[1]!.length}`}>
              {heading[2]}
            </p>
          );
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        if (bullet)
          return (
            <p key={index} className="canvas-bullet">
              • {bullet[1]}
            </p>
          );
        return <p key={index}>{line || ' '}</p>;
      })}
    </div>
  );
}

function PageCard({ pageId }: { pageId: PageId }) {
  const state = useWorkspace();
  const page = state.pages[pageId];
  const snippet = useMemo(
    () => docToPlainText(state.docs[pageId] ?? { type: 'doc' }).slice(0, 400),
    [state.docs, pageId],
  );
  if (!page) return <span className="canvas-placeholder">{t('canvas.pageMissing')}</span>;
  return (
    <div className="canvas-page">
      <strong className="canvas-page-title">
        {page.icon && <Emoji emoji={page.icon} />}
        {displayTitle(page)}
      </strong>
      <p className="canvas-page-text">{snippet}</p>
    </div>
  );
}

function FileCard({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const image = isImagePath(path);
  useEffect(() => {
    let live = true;
    if (image) void fileUrl(path).then((value) => live && setUrl(value));
    return () => {
      live = false;
    };
  }, [path, image]);
  if (image && url) return <img className="canvas-image" src={url} alt={path} draggable={false} />;
  return <span className="canvas-file">{path.split('/').pop()}</span>;
}
