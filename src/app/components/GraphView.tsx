import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { Network } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph, DEFAULT_GRAPH_OPTIONS } from '../../core/graph';
import type { GraphLink, GraphNode, GraphOptions } from '../../core/graph';
import { displayTitle } from '../../core/model';
import type { PageId } from '../../core/model';
import { foldText } from '../../core/search';
import { navigate, openPage } from '../router';
import { useWorkspace } from '../workspace';
import { TopBar } from './TopBar';

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { kind: GraphLink['kind'] };

const OPTIONS_KEY = 'morrow.graph';

function readOptions(): GraphOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Partial<GraphOptions>;
    return {
      ...DEFAULT_GRAPH_OPTIONS,
      tags: raw.tags === true,
      hierarchy: raw.hierarchy === true,
      orphans: raw.orphans !== false,
      depth: raw.depth === 2 || raw.depth === 3 ? raw.depth : 1,
    };
  } catch {
    return DEFAULT_GRAPH_OPTIONS;
  }
}

function themeColors(element: HTMLElement) {
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    node: read('--text-faint'),
    tag: read('--accent-line'),
    accent: read('--accent'),
    link: read('--border-strong'),
    text: read('--text-muted'),
    strong: read('--text'),
    bg: read('--bg'),
  };
}

export function GraphView({ focus }: { focus: PageId | null }) {
  const state = useWorkspace();
  const [options, setOptions] = useState<GraphOptions>(readOptions);
  const [query, setQuery] = useState('');
  const graph = useMemo(() => buildGraph(state, { ...options, focus }), [state, options, focus]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const change = (patch: Partial<GraphOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {
      // only a convenience
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const colors = themeColors(wrap);
    const nodes: SimNode[] = graph.nodes.map((node) => ({ ...node }));
    const links: SimLink[] = graph.links.map((link) => ({ source: link.source, target: link.target, kind: link.kind }));
    const neighbours = new Map<string, Set<string>>();
    for (const link of graph.links) {
      neighbours.set(link.source, (neighbours.get(link.source) ?? new Set()).add(link.target));
      neighbours.set(link.target, (neighbours.get(link.target) ?? new Set()).add(link.source));
    }
    const folded = foldText(query.trim());
    const matches = (node: SimNode) => !folded || foldText(node.label).includes(folded);

    let width = 0;
    let height = 0;
    let view = { x: 0, y: 0, k: 1 };
    let hover: SimNode | null = null;
    let dragging: SimNode | null = null;
    let panning: { x: number; y: number; vx: number; vy: number } | null = null;
    let moved = false;
    let frame = 0;
    const radius = (node: SimNode) => (node.kind === 'tag' ? 3 : 3 + Math.sqrt(node.degree) * 1.6) + (node.id === focus ? 2 : 0);

    const draw = () => {
      frame = 0;
      const ratio = window.devicePixelRatio || 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.translate(width / 2 + view.x, height / 2 + view.y);
      context.scale(view.k, view.k);
      const lit = hover ? new Set([hover.id, ...(neighbours.get(hover.id) ?? [])]) : null;
      context.lineWidth = 1 / view.k;
      for (const link of links) {
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        const on = lit && lit.has(source.id) && lit.has(target.id);
        context.strokeStyle = on ? colors.accent : colors.link;
        context.globalAlpha = lit && !on ? 0.15 : link.kind === 'link' ? 0.9 : 0.5;
        context.setLineDash(link.kind === 'link' ? [] : [3 / view.k, 3 / view.k]);
        context.beginPath();
        context.moveTo(source.x ?? 0, source.y ?? 0);
        context.lineTo(target.x ?? 0, target.y ?? 0);
        context.stroke();
      }
      context.setLineDash([]);
      for (const node of nodes) {
        const on = !lit || lit.has(node.id);
        const found = folded ? matches(node) : true;
        context.globalAlpha = on && found ? 1 : 0.18;
        context.fillStyle = node.id === focus || node === hover || (folded && found) ? colors.accent : node.kind === 'tag' ? colors.tag : colors.node;
        context.beginPath();
        context.arc(node.x ?? 0, node.y ?? 0, radius(node), 0, Math.PI * 2);
        context.fill();
      }
      // labels appear when zoomed in, or for the node under the pointer and its neighbours
      context.textAlign = 'center';
      context.textBaseline = 'top';
      context.font = `${12 / Math.max(view.k, 0.6)}px ${getComputedStyle(wrap).fontFamily}`;
      for (const node of nodes) {
        const show = view.k > 1.1 || (lit && lit.has(node.id)) || node.id === focus || (folded && matches(node));
        if (!show) continue;
        context.globalAlpha = lit && !lit.has(node.id) ? 0.2 : 1;
        context.fillStyle = node === hover ? colors.strong : colors.text;
        const label = node.label.length > 40 ? `${node.label.slice(0, 39)}…` : node.label;
        context.fillText(label, node.x ?? 0, (node.y ?? 0) + radius(node) + 3 / view.k);
      }
      context.globalAlpha = 1;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      schedule();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const simulation: Simulation<SimNode, SimLink> = forceSimulation(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((node) => node.id).distance(50).strength(0.6))
      .force('charge', forceManyBody().strength(-90).distanceMax(400))
      .force('center', forceCenter(0, 0))
      .force('x', forceX(0).strength(0.04))
      .force('y', forceY(0).strength(0.04))
      .force('collide', forceCollide<SimNode>((node) => radius(node) + 4))
      .on('tick', schedule);

    const toWorld = (event: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (event.clientX - rect.left - width / 2 - view.x) / view.k, y: (event.clientY - rect.top - height / 2 - view.y) / view.k };
    };
    const nodeAt = (event: PointerEvent | MouseEvent) => {
      const point = toWorld(event);
      let best: SimNode | null = null;
      let distance = Infinity;
      for (const node of nodes) {
        const d = Math.hypot((node.x ?? 0) - point.x, (node.y ?? 0) - point.y);
        if (d < Math.max(radius(node) + 4, 8 / view.k) && d < distance) {
          best = node;
          distance = d;
        }
      }
      return best;
    };

    const onDown = (event: PointerEvent) => {
      moved = false;
      const node = nodeAt(event);
      canvas.setPointerCapture(event.pointerId);
      if (node) {
        dragging = node;
        simulation.alphaTarget(0.3).restart();
      } else panning = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    };
    const onMove = (event: PointerEvent) => {
      if (dragging) {
        const point = toWorld(event);
        dragging.fx = point.x;
        dragging.fy = point.y;
        moved = true;
      } else if (panning) {
        view = { ...view, x: panning.vx + event.clientX - panning.x, y: panning.vy + event.clientY - panning.y };
        moved = moved || Math.abs(event.clientX - panning.x) + Math.abs(event.clientY - panning.y) > 3;
        schedule();
      } else {
        const next = nodeAt(event);
        if (next !== hover) {
          hover = next;
          canvas.style.cursor = next ? 'pointer' : 'grab';
          canvas.title = next ? next.label : '';
          schedule();
        }
      }
    };
    const onUp = (event: PointerEvent) => {
      if (dragging) {
        dragging.fx = null;
        dragging.fy = null;
        simulation.alphaTarget(0);
        if (!moved) {
          const node = dragging;
          if (node.pageId) openPage(node.pageId);
          else navigate({ name: 'tag', tag: node.label.replace(/^#/, '') });
        }
      }
      dragging = null;
      panning = null;
      canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left - width / 2;
      const py = event.clientY - rect.top - height / 2;
      const k = Math.min(6, Math.max(0.1, view.k * Math.exp(-event.deltaY / 300)));
      view = { k, x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k };
      schedule();
    };
    const onLeave = () => {
      hover = null;
      schedule();
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    const theme = new MutationObserver(() => {
      Object.assign(colors, themeColors(wrap));
      schedule();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      simulation.stop();
      observer.disconnect();
      theme.disconnect();
      if (frame) cancelAnimationFrame(frame);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [graph, query, focus]);

  const focused = focus ? state.pages[focus] : undefined;

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{focused ? `Graph around ${displayTitle(focused)}` : 'Graph'}</span>
      </TopBar>
      <div className="graph-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="graph-canvas" role="img" aria-label={`Graph of ${graph.nodes.length} pages and ${graph.links.length} links. Click a dot to open its page.`} />
        <div className="graph-controls popover">
          <input className="text-input small" placeholder="Find in graph" aria-label="Find in graph" value={query} onChange={(event) => setQuery(event.target.value)} />
          <label className="checkbox-row">
            <input type="checkbox" checked={options.tags} onChange={(event) => change({ tags: event.target.checked })} /> Tags
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={options.hierarchy} onChange={(event) => change({ hierarchy: event.target.checked })} /> Subpages
          </label>
          {focus ? (
            <label className="checkbox-row">
              Depth
              <select className="text-input small" value={options.depth} onChange={(event) => change({ depth: Number(event.target.value) })}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
          ) : (
            <label className="checkbox-row">
              <input type="checkbox" checked={options.orphans} onChange={(event) => change({ orphans: event.target.checked })} /> Unlinked pages
            </label>
          )}
          {focus && (
            <button type="button" className="link-button" onClick={() => navigate({ name: 'graph', focus: null })}>
              <Network size={13} /> Whole graph
            </button>
          )}
          <span className="muted small">
            {graph.nodes.length} pages · {graph.links.length} links
          </span>
        </div>
      </div>
    </div>
  );
}
