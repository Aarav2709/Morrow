import MarkdownIt from 'markdown-it';
import type { StateBlock, StateInline, Token } from 'markdown-it';
import { calloutTone, emptyDoc } from '../model';
import type { DocMark, DocNode, PageId } from '../model';
import { inlineText } from '../doc';

export interface ParseOptions {
  // resolves a [[wiki link]] target, a title or a path inside the vault, to a page id
  resolvePage?: (target: string) => PageId | null;
  // resolves relative links such as notion exports use between pages
  resolveLink?: (href: string) => PageId | null;
  // resolves image and file paths, and ![[embeds]], to stored files
  resolveFile?: (href: string) => { fileId: string; name: string; image: boolean } | null;
  // links to pages that do not exist yet stay live and create the page when followed, on by default
  keepUnresolved?: boolean;
}

export interface WikiLink {
  target: string;
  anchor: string | null;
  alias: string | null;
  embed: boolean;
}

const md = new MarkdownIt('commonmark', { html: true }).enable(['table', 'strikethrough']);
md.inline.ruler.before('link', 'wikilink', wikiLinkRule);
md.inline.ruler.after('backticks', 'math_inline', mathInlineRule);
md.inline.ruler.after('strikethrough', 'highlight', highlightRule);
md.block.ruler.before('fence', 'math_block', mathBlockRule, {
  alt: ['paragraph', 'reference', 'blockquote', 'list'],
});

const MAX_INPUT = 5_000_000;
const TASK_PREFIX = /^\[([ xX])\](?:\s+|$)/;
// obsidian callouts and github alerts: > [!type]+ optional title
const CALLOUT = /^\[!([A-Za-z][\w-]{0,30})\]([+-]?)[ \t]*/;
const WIKI = /^(!?)\[\[([^[\]\n]{0,400}?)\]\]/;

// [[target#anchor|alias]] and ![[embed]], before markdown links so the brackets are not read as one
function wikiLinkRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const first = state.src.charCodeAt(start);
  if (first !== 0x21 && first !== 0x5b) return false;
  const match = WIKI.exec(state.src.slice(start, Math.min(state.posMax, start + 810)));
  if (!match) return false;
  if (!silent) {
    const token = state.push('wikilink', '', 0);
    token.meta = { ...parseWikiLink(match[2]!, match[1] === '!') };
    token.markup = match[0];
  }
  state.pos += match[0].length;
  return true;
}

export function parseWikiLink(inner: string, embed: boolean): WikiLink {
  // tables escape the alias bar as \|
  const bar = inner.search(/\\?\|/);
  const head = bar === -1 ? inner : inner.slice(0, bar);
  const alias = bar === -1 ? null : inner.slice(bar).replace(/^\\?\|/, '');
  const hash = head.indexOf('#');
  return {
    target: (hash === -1 ? head : head.slice(0, hash)).trim(),
    anchor: hash === -1 ? null : head.slice(hash + 1).trim(),
    alias: alias === null ? null : alias.trim(),
    embed,
  };
}

// $inline$ with the usual rules that keep prices like $5 and $10 as text
function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const { src } = state;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24) return false;
  const display = src.charCodeAt(start + 1) === 0x24;
  const open = display ? 2 : 1;
  const next = src[start + open];
  if (!next || /\s/.test(next) || next === '$') return false;
  const closer = display ? '$$' : '$';
  let end = src.indexOf(closer, start + open);
  while (end !== -1 && src[end - 1] === '\\') end = src.indexOf(closer, end + 1);
  if (end === -1 || end + open > state.posMax) return false;
  const content = src.slice(start + open, end);
  if (/\s$/.test(content) || content.includes('\n\n')) return false;
  if (!display && /\d/.test(src[end + 1] ?? '')) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = content;
    token.markup = closer;
  }
  state.pos = end + open;
  return true;
}

// ==highlighted text== as obsidian writes it
function highlightRule(state: StateInline, silent: boolean): boolean {
  const { src } = state;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d) return false;
  if (src.charCodeAt(start + 2) === 0x3d) return false;
  const end = src.indexOf('==', start + 2);
  if (end === -1 || end + 2 > state.posMax || end === start + 2) return false;
  const inner = src.slice(start + 2, end);
  if (/^\s|\s$/.test(inner) || inner.includes('\n\n')) return false;
  if (!silent) {
    state.push('mark_open', 'mark', 1);
    const max = state.posMax;
    state.pos = start + 2;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = max;
    state.push('mark_close', 'mark', -1);
  }
  state.pos = end + 2;
  return true;
}

// $$ on its own line opens a display formula that runs until a line ending in $$
function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const max = state.eMarks[startLine]!;
  if (!state.src.startsWith('$$', start)) return false;
  const firstRest = state.src.slice(start + 2, max).trim();
  let line = startLine;
  const parts: string[] = [];
  if (firstRest.endsWith('$$') && firstRest.length >= 2) {
    parts.push(firstRest.slice(0, -2));
  } else {
    if (firstRest) parts.push(firstRest);
    let closed = false;
    while (++line < endLine) {
      const from = state.bMarks[line]! + state.tShift[line]!;
      const to = state.eMarks[line]!;
      if (from < to && state.sCount[line]! < state.blkIndent) break;
      const text = state.src.slice(from, to);
      if (text.trimEnd().endsWith('$$')) {
        const before = text.trimEnd().slice(0, -2);
        if (before.trim()) parts.push(before);
        closed = true;
        break;
      }
      parts.push(state.src.slice(state.bMarks[line]!, to));
    }
    if (!closed) return false;
  }
  if (silent) return true;
  state.line = line + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = parts.join('\n').trim();
  token.map = [startLine, state.line];
  return true;
}

export function markdownToDoc(source: string, options: ParseOptions = {}): DocNode {
  const text = source.length > MAX_INPUT ? source.slice(0, MAX_INPUT) : source;
  const tokens = md.parse(text.replace(/\r\n?/g, '\n'), {});
  const root: DocNode = { type: 'doc', content: [] };
  const stack: DocNode[] = [root];
  const top = () => stack[stack.length - 1]!;
  const push = (node: DocNode) => {
    (top().content ??= []).push(node);
  };
  const open = (node: DocNode) => {
    push(node);
    stack.push(node);
  };
  const close = () => {
    if (stack.length > 1) stack.pop();
  };

  for (const token of tokens) {
    switch (token.type) {
      case 'paragraph_open':
        open({ type: 'paragraph', content: [] });
        break;
      case 'heading_open':
        open({ type: 'heading', attrs: { level: Number(token.tag.slice(1)) || 1 }, content: [] });
        break;
      case 'blockquote_open':
        open({ type: 'blockquote', content: [] });
        break;
      case 'bullet_list_open':
        open({ type: 'bulletList', content: [] });
        break;
      case 'ordered_list_open': {
        const start = Number(token.attrGet('start') ?? 1);
        open({ type: 'orderedList', attrs: { start: Number.isFinite(start) ? start : 1 }, content: [] });
        break;
      }
      case 'list_item_open':
        open({ type: 'listItem', content: [] });
        break;
      case 'table_open':
        open({ type: 'table', content: [] });
        break;
      case 'tr_open':
        open({ type: 'tableRow', content: [] });
        break;
      case 'th_open':
      case 'td_open':
        open({ type: token.type === 'th_open' ? 'tableHeader' : 'tableCell', content: [] });
        open({ type: 'paragraph', content: [] });
        break;
      case 'th_close':
      case 'td_close':
        close();
        close();
        break;
      case 'paragraph_close':
      case 'heading_close':
      case 'blockquote_close':
      case 'bullet_list_close':
      case 'ordered_list_close':
      case 'list_item_close':
      case 'table_close':
      case 'tr_close':
        close();
        break;
      case 'inline':
        (top().content ??= []).push(...inlineNodes(token.children ?? [], options));
        break;
      case 'fence':
      case 'code_block': {
        const code = token.content.replace(/\n$/, '');
        const language = token.info.trim().split(/\s+/)[0] ?? '';
        push({
          type: 'codeBlock',
          attrs: { language: language || null },
          content: code ? [{ type: 'text', text: code }] : [],
        });
        break;
      }
      case 'math_block':
        push({ type: 'blockMath', attrs: { latex: token.content } });
        break;
      case 'hr':
        push({ type: 'horizontalRule' });
        break;
      case 'html_block':
        htmlBlock(token.content, options, { push, top, close, stack });
        break;
      default:
        break;
    }
  }

  const doc = normalize(root);
  return (doc.content ?? []).length > 0 ? doc : emptyDoc();
}

interface Builder {
  push: (node: DocNode) => void;
  top: () => DocNode;
  close: () => void;
  stack: DocNode[];
}

// toggles and notion asides become blocks, any other html is kept exactly as written
function htmlBlock(source: string, options: ParseOptions, b: Builder): void {
  const html = source.trim();
  const details = /^<details[^>]*>/i.exec(html);
  const aside = /^<aside[^>]*>/i.exec(html);
  if (details) {
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(html);
    const title = decodeEntities((summary?.[1] ?? '').replace(/<[^>]+>/g, '')).trim();
    const body: DocNode = { type: 'detailsContent', content: [] };
    const node: DocNode = {
      type: 'details',
      attrs: { open: false },
      content: [{ type: 'detailsSummary', content: title ? [{ type: 'text', text: title }] : [] }, body],
    };
    b.push(node);
    const after = html.slice(summary ? summary.index + summary[0].length : details[0].length);
    const closed = /<\/details>\s*$/i.test(after);
    const inner = after.replace(/<\/details>\s*$/i, '').trim();
    if (inner) body.content!.push(...(markdownToDoc(inner, options).content ?? []));
    if (!closed) b.stack.push(node, body);
  } else if (/^<\/details>/i.test(html)) {
    if (b.top().type === 'detailsContent') {
      b.close();
      b.close();
    }
  } else if (aside) {
    const closed = /<\/aside>\s*$/i.test(html);
    const inner = html
      .slice(aside[0].length)
      .replace(/<\/aside>\s*$/i, '')
      .trim();
    const node: DocNode = { type: 'callout', attrs: { tone: 'note', kind: 'note' }, content: [] };
    if (inner) node.content!.push(...(markdownToDoc(inner, options).content ?? []));
    b.push(node);
    if (!closed) b.stack.push(node);
  } else if (/^<\/aside>/i.test(html)) {
    if (b.top().type === 'callout') b.close();
  } else if (html) b.push({ type: 'rawBlock', attrs: { text: source.replace(/\n+$/, '') } });
}

// first level one heading becomes the page title
export function markdownToPage(
  source: string,
  fallbackTitle: string,
  options: ParseOptions = {},
): { title: string; doc: DocNode } {
  const doc = markdownToDoc(source, options);
  const first = doc.content?.[0];
  if (first?.type === 'heading' && first.attrs?.level === 1) {
    const rest = doc.content!.slice(1);
    return {
      title: inlineText(first).trim() || fallbackTitle,
      doc: rest.length ? { type: 'doc', content: rest } : emptyDoc(),
    };
  }
  return { title: fallbackTitle, doc };
}

function inlineNodes(tokens: Token[], options: ParseOptions): DocNode[] {
  const out: DocNode[] = [];
  const marks: DocMark[] = [];
  const add = (text: string, extra: DocMark[] = []) => {
    if (!text) return;
    const all = [...marks, ...extra];
    out.push(all.length ? { type: 'text', text, marks: all } : { type: 'text', text });
  };
  const remove = (type: string) => {
    const index = marks.map((mark) => mark.type).lastIndexOf(type);
    if (index !== -1) marks.splice(index, 1);
  };
  let pageTarget: { id: PageId; label: string } | null = null;

  for (const token of tokens) {
    if (pageTarget && token.type !== 'link_close') {
      pageTarget.label += token.content;
      continue;
    }
    switch (token.type) {
      case 'text':
        add(token.content);
        break;
      case 'softbreak':
        // kept until callout titles are read, then becomes a space
        out.push({ type: 'softBreak' });
        break;
      case 'hardbreak':
        out.push({ type: 'hardBreak' });
        break;
      case 'strong_open':
        marks.push({ type: 'bold' });
        break;
      case 'em_open':
        marks.push({ type: 'italic' });
        break;
      case 's_open':
        marks.push({ type: 'strike' });
        break;
      case 'mark_open':
        marks.push({ type: 'highlight' });
        break;
      case 'link_open': {
        const href = String(token.attrGet('href') ?? '');
        const pageId = options.resolveLink?.(href) ?? null;
        const file = pageId ? null : (options.resolveFile?.(href) ?? null);
        if (pageId) pageTarget = { id: pageId, label: '' };
        else if (file) marks.push({ type: 'link', attrs: { href, fileRef: file } });
        else marks.push({ type: 'link', attrs: { href } });
        break;
      }
      case 'strong_close':
        remove('bold');
        break;
      case 'em_close':
        remove('italic');
        break;
      case 's_close':
        remove('strike');
        break;
      case 'mark_close':
        remove('highlight');
        break;
      case 'link_close':
        if (pageTarget) {
          out.push({ type: 'pageLink', attrs: { id: pageTarget.id, label: pageTarget.label.trim() } });
          pageTarget = null;
        } else remove('link');
        break;
      case 'code_inline':
        add(token.content, [{ type: 'code' }]);
        break;
      case 'math_inline':
        out.push({ type: 'inlineMath', attrs: { latex: token.content } });
        break;
      case 'wikilink':
        out.push(...wikiNode(token.meta as unknown as WikiLink, token.markup, options, marks));
        break;
      case 'image': {
        const src = String(token.attrGet('src') ?? '');
        const alt = token.content || String(token.attrGet('alt') ?? '');
        const file = options.resolveFile?.(src) ?? null;
        if (file?.image) out.push({ type: 'image', attrs: { fileId: file.fileId, alt } });
        else if (file) add(alt || file.name, [{ type: 'link', attrs: { href: src, fileRef: file } }]);
        else out.push({ type: 'image', attrs: { fileId: null, src, alt } });
        break;
      }
      case 'html_inline': {
        const tag = token.content.trim().toLowerCase();
        if (tag === '<u>') marks.push({ type: 'underline' });
        else if (tag === '</u>') remove('underline');
        else if (tag === '<mark>') marks.push({ type: 'highlight' });
        else if (tag === '</mark>') remove('highlight');
        else if (/^<br\s*\/?>$/.test(tag)) out.push({ type: 'hardBreak' });
        else add(token.content);
        break;
      }
      default:
        if (token.content) add(token.content);
    }
  }
  return mergeText(out);
}

function wikiNode(link: WikiLink, markup: string, options: ParseOptions, marks: DocMark[]): DocNode[] {
  if (link.embed) {
    const file = link.target ? (options.resolveFile?.(link.target) ?? null) : null;
    if (file?.image) return [{ type: 'image', attrs: { fileId: file.fileId, alt: link.alias ?? '' } }];
    if (file) {
      const fileMarks = [...marks, { type: 'link', attrs: { href: link.target, fileRef: { ...file, embed: true } } }];
      return [{ type: 'text', text: link.alias ?? file.name, marks: fileMarks }];
    }
  }
  const id = link.target ? (options.resolvePage?.(link.target) ?? null) : null;
  if (!id && options.keepUnresolved === false) {
    return [marks.length ? { type: 'text', text: markup, marks: [...marks] } : { type: 'text', text: markup }];
  }
  const label = link.alias ?? (link.target.split('/').pop() || link.target);
  // the written target is only needed while the page does not exist, resolved links follow the page
  const attrs: Record<string, unknown> = id ? { id, label } : { id, label, target: link.target };
  if (link.anchor !== null) attrs.anchor = link.anchor;
  if (link.alias !== null) attrs.alias = link.alias;
  if (link.embed) attrs.embed = true;
  return [{ type: 'pageLink', attrs }];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function mergeText(nodes: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (last?.type === 'text' && node.type === 'text' && sameMarks(last.marks, node.marks)) {
      out[out.length - 1] = { ...last, text: (last.text ?? '') + (node.text ?? '') };
    } else out.push(node);
  }
  return out;
}

function sameMarks(a: DocMark[] = [], b: DocMark[] = []): boolean {
  return (
    a.length === b.length &&
    a.every(
      (mark, i) =>
        mark.type === b[i]!.type &&
        mark.attrs?.href === b[i]!.attrs?.href &&
        mark.attrs?.fileRef === b[i]!.attrs?.fileRef,
    )
  );
}

// shapes the tree so the editor schema accepts it
function normalize(input: DocNode): DocNode {
  // callouts read their title from the raw first line, before line breaks turn into spaces
  const node = input.type === 'blockquote' ? toCallout(input) : input;
  const content = node.content?.flatMap((child) => liftMedia(normalize(child)));
  let next: DocNode = content ? { ...node, content } : { ...node };
  if ((next.type === 'callout' || next.type === 'detailsContent') && (next.content ?? []).length === 0) {
    next = { ...next, content: [{ type: 'paragraph', content: [] }] };
  }

  if (
    next.type === 'listItem' ||
    next.type === 'tableCell' ||
    next.type === 'tableHeader' ||
    next.type === 'blockquote'
  ) {
    const children = next.content ?? [];
    if (children.length === 0 || (next.type === 'listItem' && children[0]!.type !== 'paragraph')) {
      next = { ...next, content: [{ type: 'paragraph', content: [] }, ...children] };
    }
  }
  if (next.type === 'bulletList') return next;
  if (next.content?.some((child) => child.type === 'bulletList')) {
    next = { ...next, content: next.content.flatMap(splitTaskLists) };
  }
  if (next.type === 'paragraph' || next.type === 'heading' || next.type === 'detailsSummary') {
    const inline = mergeText(
      (next.content ?? []).map((child) =>
        child.type === 'softBreak' ? { type: 'text', text: ' ', ...marksOf(child) } : child,
      ),
    );
    next = { ...next, content: inline.filter((child) => child.type !== 'text' || child.text) };
  }
  return next;
}

function marksOf(node: DocNode): { marks?: DocMark[] } {
  return node.marks?.length ? { marks: node.marks } : {};
}

// images and embeds become blocks, a paragraph that mixes them with text is split around them,
// so nothing an image or embed points at is ever lost
function liftMedia(node: DocNode): DocNode[] {
  if (node.type !== 'paragraph' || !node.content) return [node];
  const children = node.content;
  const blank = (child: DocNode) =>
    child.type === 'hardBreak' || child.type === 'softBreak' || (child.type === 'text' && !child.text?.trim());
  const meaningful = children.filter((child) => !blank(child));
  // a lone link to a stored file is shown as an attachment
  const refs = new Set(meaningful.map((child) => fileRefOf(child)));
  const ref = refs.size === 1 ? [...refs][0] : undefined;
  if (ref && meaningful.every((child) => fileRefOf(child) === ref)) return [mediaBlock(ref)];
  if (!meaningful.some((child) => child.type === 'image' || fileRefOf(child)?.embed)) {
    return [{ ...node, content: children.map(plainFileLink) }];
  }
  const out: DocNode[] = [];
  let run: DocNode[] = [];
  const flush = () => {
    while (run.length && blank(run[0]!)) run.shift();
    while (run.length && blank(run[run.length - 1]!)) run.pop();
    if (run.length) {
      const content = mergeText(run);
      const last = content[content.length - 1]!;
      if (last.type === 'text') content[content.length - 1] = { ...last, text: last.text!.trimEnd() };
      out.push({ ...node, content: content.filter((child) => child.type !== 'text' || child.text) });
    }
    run = [];
  };
  for (const child of children) {
    const embed = fileRefOf(child);
    if (child.type === 'image') {
      flush();
      out.push(child);
    } else if (embed?.embed) {
      flush();
      out.push(mediaBlock(embed));
    } else run.push(plainFileLink(child));
  }
  flush();
  return out.length ? out : [{ ...node, content: [] }];
}

function mediaBlock(ref: { fileId: string; name: string; image: boolean }): DocNode {
  return ref.image
    ? { type: 'image', attrs: { fileId: ref.fileId, alt: '' } }
    : { type: 'fileAttachment', attrs: { fileId: ref.fileId, name: ref.name } };
}

// a link to a file inside a sentence stays an ordinary link to it
function plainFileLink(child: DocNode): DocNode {
  if (!fileRefOf(child)) return child;
  const marks = (child.marks ?? []).map((mark) => (mark.attrs?.fileRef ? { type: 'link', attrs: { href: mark.attrs.href } } : mark));
  return { ...child, marks };
}

function fileRefOf(node: DocNode): { fileId: string; name: string; image: boolean; embed?: boolean } | undefined {
  const ref = node.marks?.find((mark) => mark.attrs?.fileRef)?.attrs?.fileRef;
  return ref as { fileId: string; name: string; image: boolean; embed?: boolean } | undefined;
}

// a quote that starts with [!type] is a callout, the rest of that first line is its title
function toCallout(quote: DocNode): DocNode {
  const [first, ...rest] = quote.content ?? [];
  const lead = first?.type === 'paragraph' ? first.content?.[0] : undefined;
  const match = lead?.type === 'text' && !lead.marks?.length ? CALLOUT.exec(lead.text ?? '') : null;
  if (!first || !lead || !match) return quote;
  const inline = [
    ...((lead.text ?? '').length > match[0].length ? [{ ...lead, text: lead.text!.slice(match[0].length) }] : []),
    ...(first.content ?? []).slice(1),
  ];
  const breakAt = inline.findIndex((node) => node.type === 'softBreak' || node.type === 'hardBreak');
  const titleNodes = breakAt === -1 ? inline : inline.slice(0, breakAt);
  const body = breakAt === -1 ? [] : inline.slice(breakAt + 1);
  const title = titleNodes.map((node) => inlineText(node)).join('').trim();
  const kind = match[1]!.toLowerCase();
  const attrs: Record<string, unknown> = { tone: calloutTone(kind), kind };
  if (title) attrs.title = title;
  if (match[2]) attrs.fold = match[2];
  const content = body.length ? [{ ...first, content: body }, ...rest] : rest;
  return {
    type: 'callout',
    attrs,
    content: content.length ? content : [{ type: 'paragraph', content: [] }],
  };
}

// a bullet list whose items start with [ ] or [x] becomes a checklist, mixed lists are split
function splitTaskLists(node: DocNode): DocNode[] {
  if (node.type !== 'bulletList') return [node];
  const groups: DocNode[] = [];
  for (const item of node.content ?? []) {
    const task = toTaskItem(item);
    const type = task ? 'taskList' : 'bulletList';
    const last = groups[groups.length - 1];
    if (last?.type === type) last.content!.push(task ?? item);
    else groups.push({ type, content: [task ?? item] });
  }
  return groups;
}

function toTaskItem(item: DocNode): DocNode | null {
  const first = item.content?.[0];
  const lead = first?.type === 'paragraph' ? first.content?.[0] : undefined;
  if (!first || lead?.type !== 'text' || lead.marks?.length) return null;
  const match = TASK_PREFIX.exec(lead.text ?? '');
  if (!match) return null;
  const rest = (lead.text ?? '').slice(match[0].length);
  const inline = [...(rest ? [{ ...lead, text: rest }] : []), ...(first.content ?? []).slice(1)];
  return {
    type: 'taskItem',
    attrs: { checked: match[1] !== ' ' },
    content: [{ ...first, content: inline }, ...(item.content ?? []).slice(1)],
  };
}
