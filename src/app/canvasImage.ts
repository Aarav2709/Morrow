// a canvas drawn as a picture by morrow itself, card by card, for systems whose web view can't be
// photographed, such as macos. it reads the same cards, lines and ink the canvas shows
import type { CanvasData, CanvasNode, CanvasSide } from '../core/canvas';

const PRESETS: Record<string, string> = {
  '1': '#e5484d',
  '2': '#e8803a',
  '3': '#d6a72a',
  '4': '#4d9a5c',
  '5': '#3f9bb3',
  '6': '#8b5fc7',
};
const MARGIN = 40;
// a canvas larger than this is drawn smaller, so the picture stays a size any app opens
const MAX_SIDE = 8000;

export interface CanvasImageOptions {
  // the title of a page a card shows
  pageTitle: (id: string) => string;
  // a picture a file card shows, already loaded, or null for its name only
  picture: (path: string) => HTMLImageElement | ImageBitmap | null;
  dark: boolean;
}

export function colourOf(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  return PRESETS[color] ?? (/^#[0-9a-f]{3,8}$/i.test(color) ? color : fallback);
}

// the area everything on the canvas covers
export function canvasBounds(data: CanvasData): { x: number; y: number; width: number; height: number } {
  if (data.nodes.length === 0) return { x: 0, y: 0, width: 400, height: 300 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of data.nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  return {
    x: left - MARGIN,
    y: top - MARGIN,
    width: right - left + MARGIN * 2,
    height: bottom - top + MARGIN * 2,
  };
}

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

function facing(node: CanvasNode, other: CanvasNode): CanvasSide {
  const dx = other.x + other.width / 2 - (node.x + node.width / 2);
  const dy = other.y + other.height / 2 - (node.y + node.height / 2);
  if (Math.abs(dx) / node.width > Math.abs(dy) / node.height) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

const NORMAL: Record<CanvasSide, { x: number; y: number }> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

// words wrapped to a width, as many lines as fit the height
function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  lineHeight: number,
): void {
  let line = 0;
  const maxLines = Math.max(1, Math.floor(height / lineHeight));
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/);
    let current = '';
    const flush = () => {
      if (line < maxLines) context.fillText(current, x, y + line * lineHeight);
      line++;
      current = '';
    };
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (context.measureText(next).width > width && current) {
        flush();
        current = word;
      } else current = next;
    }
    flush();
    if (line >= maxLines) return;
  }
}

// markdown marks a text card's words may carry, left off so the picture reads cleanly
function plainText(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__|~~|==|`/g, '')
    .replace(
      /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
      (_, page: string, alias?: string) => alias ?? page,
    )
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function drawCanvas(data: CanvasData, options: CanvasImageOptions): HTMLCanvasElement {
  const bounds = canvasBounds(data);
  const scale = Math.min(2, MAX_SIDE / Math.max(bounds.width, bounds.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bounds.width * scale));
  canvas.height = Math.max(1, Math.round(bounds.height * scale));
  const context = canvas.getContext('2d')!;
  context.scale(scale, scale);
  context.translate(-bounds.x, -bounds.y);
  const text = options.dark ? '#e8e6e3' : '#1f1f1f';
  const muted = options.dark ? '#9b9a97' : '#787774';
  const card = options.dark ? '#262626' : '#ffffff';
  const border = options.dark ? '#3a3a3a' : '#e3e2de';
  context.fillStyle = options.dark ? '#191919' : '#f7f6f3';
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  const font = '-apple-system, "Segoe UI", Inter, sans-serif';

  // groups first, behind everything else
  for (const node of data.nodes.filter((item) => item.type === 'group')) {
    const color = colourOf(node.color, muted);
    roundedRect(context, node.x, node.y, node.width, node.height, 12);
    context.fillStyle = `${color}14`;
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.stroke();
    if (node.type === 'group' && node.label) {
      context.fillStyle = color;
      context.font = `600 15px ${font}`;
      context.textBaseline = 'bottom';
      context.fillText(node.label, node.x + 4, node.y - 6);
    }
  }

  // the lines between cards, under the cards
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  for (const edge of data.edges) {
    const from = byId.get(edge.fromNode);
    const to = byId.get(edge.toNode);
    if (!from || !to) continue;
    const fromSide = edge.fromSide ?? facing(from, to);
    const toSide = edge.toSide ?? facing(to, from);
    const a = anchor(from, fromSide);
    const b = anchor(to, toSide);
    const bend = Math.min(150, Math.max(30, Math.hypot(b.x - a.x, b.y - a.y) / 2));
    const color = colourOf(edge.color, muted);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(a.x, a.y);
    const c1 = { x: a.x + NORMAL[fromSide].x * bend, y: a.y + NORMAL[fromSide].y * bend };
    const c2 = { x: b.x + NORMAL[toSide].x * bend, y: b.y + NORMAL[toSide].y * bend };
    context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
    context.stroke();
    const arrow = (tip: { x: number; y: number }, from: { x: number; y: number }) => {
      const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
      context.beginPath();
      context.moveTo(tip.x, tip.y);
      context.lineTo(tip.x - 11 * Math.cos(angle - 0.45), tip.y - 11 * Math.sin(angle - 0.45));
      context.lineTo(tip.x - 11 * Math.cos(angle + 0.45), tip.y - 11 * Math.sin(angle + 0.45));
      context.closePath();
      context.fill();
    };
    if (edge.toEnd !== 'none') arrow(b, c2);
    if (edge.fromEnd === 'arrow') arrow(a, c1);
    if (edge.label) {
      const mid = {
        x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x,
        y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y,
      };
      context.font = `13px ${font}`;
      const width = context.measureText(edge.label).width + 12;
      context.fillStyle = options.dark ? '#191919' : '#f7f6f3';
      context.fillRect(mid.x - width / 2, mid.y - 11, width, 22);
      context.fillStyle = muted;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(edge.label, mid.x, mid.y);
      context.textAlign = 'left';
    }
  }

  for (const node of data.nodes) {
    if (node.type === 'group') continue;
    if (node.type === 'drawing') {
      for (const stroke of node.strokes) {
        context.strokeStyle = colourOf(stroke.color, text);
        context.globalAlpha = stroke.highlighter ? 0.35 : 1;
        context.lineWidth = stroke.width;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        for (let index = 0; index < stroke.points.length; index += 2) {
          const x = node.x + stroke.points[index]!;
          const y = node.y + stroke.points[index + 1]!;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        context.globalAlpha = 1;
      }
      continue;
    }
    const color = node.color ? colourOf(node.color, border) : null;
    roundedRect(context, node.x, node.y, node.width, node.height, 10);
    context.fillStyle = color ? `${color}22` : card;
    context.fill();
    context.fillStyle = card;
    context.globalCompositeOperation = 'destination-over';
    context.fill();
    context.globalCompositeOperation = 'source-over';
    context.strokeStyle = color ?? border;
    context.lineWidth = color ? 2 : 1;
    context.stroke();
    context.save();
    roundedRect(context, node.x, node.y, node.width, node.height, 10);
    context.clip();
    context.textBaseline = 'top';
    const pad = 14;
    if (node.type === 'text') {
      context.fillStyle = text;
      context.font = `15px ${font}`;
      wrapText(
        context,
        plainText(node.text),
        node.x + pad,
        node.y + pad,
        node.width - pad * 2,
        node.height - pad * 2,
        21,
      );
    } else if (node.type === 'page') {
      context.fillStyle = text;
      context.font = `600 16px ${font}`;
      wrapText(
        context,
        options.pageTitle(node.pageId),
        node.x + pad,
        node.y + pad,
        node.width - pad * 2,
        node.height - pad * 2,
        22,
      );
    } else if (node.type === 'link') {
      context.fillStyle = muted;
      context.font = `14px ${font}`;
      wrapText(
        context,
        node.url,
        node.x + pad,
        node.y + pad,
        node.width - pad * 2,
        node.height - pad * 2,
        20,
      );
    } else if (node.type === 'file') {
      const image = options.picture(node.file);
      if (image) {
        const ratio = Math.min(node.width / image.width, node.height / image.height);
        const w = image.width * ratio;
        const h = image.height * ratio;
        context.drawImage(image, node.x + (node.width - w) / 2, node.y + (node.height - h) / 2, w, h);
      } else {
        context.fillStyle = text;
        context.font = `14px ${font}`;
        wrapText(
          context,
          node.file.split('/').pop() ?? node.file,
          node.x + pad,
          node.y + pad,
          node.width - pad * 2,
          node.height - pad * 2,
          20,
        );
      }
    }
    context.restore();
  }
  return canvas;
}

// a picture the page's menu asked for, taken by the canvas once its page is open. it waits here rather
// than in an event alone, since the canvas may not be on screen yet when the menu is used
let wanted: string | null = null;

export function requestCanvasImage(pageId: string): void {
  wanted = pageId;
  window.dispatchEvent(new CustomEvent('morrow:canvas-image'));
}

export function takeCanvasImageRequest(pageId: string): boolean {
  if (wanted !== pageId) return false;
  wanted = null;
  return true;
}
