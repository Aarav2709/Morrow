// canvases follow the open json canvas format, see jsoncanvas.org
import { isRecord } from './doc';
import type { DocNode, PageId } from './model';

export type CanvasSide = 'top' | 'right' | 'bottom' | 'left';
export const CANVAS_SIDES: readonly CanvasSide[] = ['top', 'right', 'bottom', 'left'];
// json canvas preset colours are the strings 1 to 6, any hex colour is allowed too
export const CANVAS_COLORS = ['1', '2', '3', '4', '5', '6'] as const;

interface CanvasNodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

export type CanvasNode =
  | (CanvasNodeBase & { type: 'text'; text: string })
  // a page in the workspace, stored as its path in the file and its id in memory
  | (CanvasNodeBase & { type: 'page'; pageId: PageId; subpath?: string })
  // any other file in the vault, such as an image
  | (CanvasNodeBase & { type: 'file'; file: string; subpath?: string })
  | (CanvasNodeBase & { type: 'link'; url: string })
  | (CanvasNodeBase & { type: 'group'; label?: string })
  // freehand ink, morrow's own addition to json canvas, other apps skip it
  | (CanvasNodeBase & { type: 'drawing'; strokes: CanvasStroke[] });

export interface CanvasStroke {
  // x and y pairs relative to the drawing's top left corner
  points: number[];
  width: number;
  color?: string;
  highlighter?: boolean;
}

const MAX_POINTS = 20_000;

export function readStrokes(raw: unknown): CanvasStroke[] {
  if (!Array.isArray(raw)) return [];
  const strokes: CanvasStroke[] = [];
  for (const item of raw.slice(0, 2000)) {
    if (!isRecord(item) || !Array.isArray(item.points)) continue;
    const points = item.points
      .slice(0, MAX_POINTS * 2)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (points.length < 2) continue;
    const stroke: CanvasStroke = {
      points: points.length % 2 ? points.slice(0, -1) : points,
      width: typeof item.width === 'number' && item.width > 0 ? Math.min(80, item.width) : 3,
    };
    const tint =
      typeof item.color === 'string' && (/^[1-6]$/.test(item.color) || /^#[0-9a-f]{3,8}$/i.test(item.color))
        ? item.color
        : undefined;
    if (tint) stroke.color = tint;
    if (item.highlighter === true) stroke.highlighter = true;
    strokes.push(stroke);
  }
  return strokes;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  fromEnd?: 'none' | 'arrow';
  toEnd?: 'none' | 'arrow';
  color?: string;
  label?: string;
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

const MAX_NODES = 5000;
const MAX_COORD = 1e7;

export function emptyCanvas(): CanvasData {
  return { nodes: [], edges: [] };
}

export function canvasDoc(data: CanvasData): DocNode {
  return { type: 'doc', content: [{ type: 'canvas', attrs: { nodes: data.nodes, edges: data.edges } }] };
}

export function canvasFromDoc(doc: DocNode | undefined): CanvasData {
  const node = doc?.content?.find((child) => child.type === 'canvas');
  if (!node) return emptyCanvas();
  return readCanvas({ nodes: node.attrs?.nodes, edges: node.attrs?.edges }, () => null) ?? emptyCanvas();
}

const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-MAX_COORD, Math.min(MAX_COORD, value))
    : fallback;
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const side = (value: unknown): CanvasSide | undefined =>
  CANVAS_SIDES.includes(value as CanvasSide) ? (value as CanvasSide) : undefined;
const end = (value: unknown): 'none' | 'arrow' | undefined =>
  value === 'none' || value === 'arrow' ? value : undefined;
const color = (value: unknown): string | undefined =>
  typeof value === 'string' && (/^[1-6]$/.test(value) || /^#[0-9a-f]{3,8}$/i.test(value)) ? value : undefined;

// reads either the file format or the in memory shape, resolving file paths to pages when it can
export function readCanvas(raw: unknown, pageAt: (path: string) => PageId | null): CanvasData | null {
  if (!isRecord(raw)) return null;
  const nodes: CanvasNode[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(raw.nodes) ? raw.nodes.slice(0, MAX_NODES) : []) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) continue;
    const base: CanvasNodeBase = {
      id: item.id.slice(0, 64),
      x: num(item.x, 0),
      y: num(item.y, 0),
      width: Math.max(20, num(item.width, 250)),
      height: Math.max(20, num(item.height, 60)),
    };
    const tint = color(item.color);
    if (tint) base.color = tint;
    const subpath = str(item.subpath);
    let node: CanvasNode | null = null;
    if (item.type === 'text') node = { ...base, type: 'text', text: str(item.text) ?? '' };
    else if (item.type === 'page' && typeof item.pageId === 'string')
      node = { ...base, type: 'page', pageId: item.pageId, ...(subpath ? { subpath } : {}) };
    else if (item.type === 'file' && typeof item.file === 'string') {
      const pageId = pageAt(item.file);
      node = pageId
        ? { ...base, type: 'page', pageId, ...(subpath ? { subpath } : {}) }
        : { ...base, type: 'file', file: item.file, ...(subpath ? { subpath } : {}) };
    } else if (item.type === 'link' && typeof item.url === 'string')
      node = { ...base, type: 'link', url: item.url };
    else if (item.type === 'group') {
      const label = str(item.label);
      node = { ...base, type: 'group', ...(label ? { label } : {}) };
    } else if (item.type === 'drawing') {
      const strokes = readStrokes(item.strokes);
      if (strokes.length) node = { ...base, type: 'drawing', strokes };
    }
    if (!node) continue;
    ids.add(node.id);
    nodes.push(node);
  }
  const edges: CanvasEdge[] = [];
  const edgeIds = new Set<string>();
  for (const item of Array.isArray(raw.edges) ? raw.edges.slice(0, MAX_NODES * 2) : []) {
    if (!isRecord(item) || typeof item.id !== 'string' || edgeIds.has(item.id)) continue;
    if (typeof item.fromNode !== 'string' || typeof item.toNode !== 'string') continue;
    if (!ids.has(item.fromNode) || !ids.has(item.toNode)) continue;
    const edge: CanvasEdge = { id: item.id.slice(0, 64), fromNode: item.fromNode, toNode: item.toNode };
    const fromSide = side(item.fromSide);
    const toSide = side(item.toSide);
    const fromEnd = end(item.fromEnd);
    const toEnd = end(item.toEnd);
    const tint = color(item.color);
    const label = str(item.label);
    if (fromSide) edge.fromSide = fromSide;
    if (toSide) edge.toSide = toSide;
    if (fromEnd) edge.fromEnd = fromEnd;
    if (toEnd) edge.toEnd = toEnd;
    if (tint) edge.color = tint;
    if (label) edge.label = label;
    edgeIds.add(edge.id);
    edges.push(edge);
  }
  return { nodes, edges };
}

// the json canvas file, with pages written as the path of their file
export function writeCanvas(data: CanvasData, pathOf: (id: PageId) => string | null): string {
  const nodes = data.nodes.map((node) => {
    const { type, ...rest } = node;
    if (type === 'page') {
      const { pageId, ...base } = rest as Extract<CanvasNode, { type: 'page' }>;
      return { ...base, type: 'file', file: pathOf(pageId) ?? '' };
    }
    return { ...rest, type };
  });
  return `${JSON.stringify({ nodes, edges: data.edges }, null, '\t')}\n`;
}

export function pagesInCanvas(data: CanvasData): PageId[] {
  return [...new Set(data.nodes.flatMap((node) => (node.type === 'page' ? [node.pageId] : [])))];
}
