import { FileText, Group, Maximize, Minus, Plus, Redo2, StickyNote, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { canvasDoc, canvasFromDoc, CANVAS_COLORS } from '../../core/canvas';
import type { CanvasData, CanvasEdge, CanvasNode, CanvasSide } from '../../core/canvas';
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
import { Popover } from './Popover';

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
  | { kind: 'resize'; id: string; startX: number; startY: number; width: number; height: number }
  | { kind: 'connect'; from: string; side: CanvasSide; x: number; y: number };

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
}: {
  pageId: PageId;
  doc: DocNode | undefined;
  editable: boolean;
}) {
  const [data, setData] = useState<CanvasData>(() => canvasFromDoc(doc));
  const [view, setView] = useState<Viewport>({ x: 80, y: 80, zoom: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pageAnchor, setPageAnchor] = useState<HTMLElement | null>(null);
  // the edge being drawn from a card's handle
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
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY / 300), event.clientX, event.clientY);
      else setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest('.canvas-toolbar, textarea, input, button:not(.canvas-node)')) return;
    rootRef.current?.focus();
    const handle = target.closest<HTMLElement>('[data-handle]');
    const nodeElement = target.closest<HTMLElement>('[data-node]');
    if (handle && editable) {
      const id = handle.dataset.node!;
      if (handle.dataset.handle === 'resize') {
        const node = data.nodes.find((item) => item.id === id)!;
        interaction.current = {
          kind: 'resize',
          id,
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
      const width = Math.max(60, Math.round(current.width + (event.clientX - current.startX) / view.zoom));
      const height = Math.max(40, Math.round(current.height + (event.clientY - current.startY) / view.zoom));
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
    if (current.kind === 'move' && current.moved) commit(dataRef.current, false);
    else if (current.kind === 'resize') {
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
          title: 'Group name',
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
      className="canvas-view"
      tabIndex={0}
      role="application"
      aria-label="Canvas. Double-click to add a card, drag to move, Delete to remove."
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
          <defs>
            <marker
              id="canvas-arrow"
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
                      title: 'Label',
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
                  markerEnd={edge.toEnd === 'none' ? undefined : 'url(#canvas-arrow)'}
                  markerStart={edge.fromEnd === 'arrow' ? 'url(#canvas-arrow)' : undefined}
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

      <div className="canvas-toolbar" role="toolbar" aria-label="Canvas tools">
        {editable && (
          <>
            <button
              type="button"
              className="icon-button"
              title="Add a card"
              aria-label="Add a card"
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
              title="Add a page"
              aria-label="Add a page"
              onClick={(event) => setPageAnchor(event.currentTarget)}
            >
              <FileText size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Add a group"
              aria-label="Add a group"
              onClick={() => {
                const point = center();
                addNode({
                  type: 'group',
                  label: 'Group',
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
            <button type="button" className="icon-button" title="Undo" aria-label="Undo" onClick={undo}>
              <Undo2 size={16} />
            </button>
            <button type="button" className="icon-button" title="Redo" aria-label="Redo" onClick={redo}>
              <Redo2 size={16} />
            </button>
            <span className="toolbar-divider" />
          </>
        )}
        <button
          type="button"
          className="icon-button"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomAt(1 / 1.25)}
        >
          <Minus size={16} />
        </button>
        <span className="canvas-zoom">{Math.round(view.zoom * 100)}%</span>
        <button
          type="button"
          className="icon-button"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => zoomAt(1.25)}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Fit everything in view"
          aria-label="Fit everything in view"
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
              title="Delete"
              aria-label="Delete selection"
              onClick={removeSelection}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
      {data.nodes.length === 0 && (
        <p className="canvas-empty muted">
          Double-click anywhere to add a card. Drag from the dot on a card's edge to connect it to another.
        </p>
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
    <Popover anchor={element} onClose={onClose} label="Add a page" className="option-picker">
      <input
        className="text-input small"
        data-autofocus
        placeholder="Find a page"
        aria-label="Find a page"
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
      {node.type === 'file' && <FileCard path={node.file} />}
      {node.type === 'link' && (
        <div className="canvas-link">
          <strong>{safeHost(node.url)}</strong>
          <span className="muted small">{node.url}</span>
        </div>
      )}
      {editable && selected && node.type !== 'group' && (
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
      {editable && selected && <span className="canvas-resize" data-handle="resize" data-node={node.id} />}
    </div>
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
      aria-label="Card text"
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
  if (!text.trim()) return <span className="canvas-placeholder">Empty card</span>;
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
  if (!page) return <span className="canvas-placeholder">This page no longer exists.</span>;
  return (
    <div className="canvas-page">
      <strong className="canvas-page-title">
        {page.icon && <span>{page.icon} </span>}
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
