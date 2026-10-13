import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import { emptyDoc } from '../model';
import type { DocMark, DocNode, PageId } from '../model';
import { inlineText } from '../doc';

export interface ParseOptions {
  // resolves [[title]] links to page ids, unresolved links stay as text
  resolvePage?: (title: string) => PageId | null;
  // resolves relative links such as notion exports use between pages
  resolveLink?: (href: string) => PageId | null;
  // resolves image and file paths that came with an import
  resolveFile?: (href: string) => { fileId: string; name: string; image: boolean } | null;
}

const ALERT = /^\[!(note|tip|important|warning|caution)\]\s*/i;
const TONES: Record<string, string> = {
  note: 'note',
  important: 'note',
  tip: 'tip',
  warning: 'warning',
  caution: 'warning',
};

const md = new MarkdownIt('commonmark', { html: true }).enable(['table', 'strikethrough']);
const MAX_INPUT = 5_000_000;
const TASK_PREFIX = /^\[([ xX])\](?:\s+|$)/;
const WIKI_LINK = /\[\[([^[\]\n]{1,200})\]\]/g;

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
      case 'hr':
        push({ type: 'horizontalRule' });
        break;
      case 'html_block': {
        const html = token.content.trim();
        const details = /^<details[^>]*>/i.exec(html);
        const aside = /^<aside[^>]*>/i.exec(html);
        if (details) {
          const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(html);
          const title = decodeEntities((summary?.[1] ?? '').replace(/<[^>]+>/g, '')).trim();
          const body: DocNode = { type: 'detailsContent', content: [] };
          const node: DocNode = {
            type: 'details',
            attrs: { open: false },
            content: [
              { type: 'detailsSummary', content: title ? [{ type: 'text', text: title }] : [] },
              body,
            ],
          };
          push(node);
          const after = html.slice(summary ? summary.index + summary[0].length : details[0].length);
          const closed = /<\/details>\s*$/i.test(after);
          const inner = after.replace(/<\/details>\s*$/i, '').trim();
          if (inner) body.content!.push(...(markdownToDoc(inner, options).content ?? []));
          if (!closed) stack.push(node, body);
        } else if (/^<\/details>/i.test(html)) {
          if (top().type === 'detailsContent') {
            close();
            close();
          }
        } else if (aside) {
          const closed = /<\/aside>\s*$/i.test(html);
          const inner = html
            .slice(aside[0].length)
            .replace(/<\/aside>\s*$/i, '')
            .trim();
          const node: DocNode = { type: 'callout', attrs: { tone: 'note' }, content: [] };
          if (inner) node.content!.push(...(markdownToDoc(inner, options).content ?? []));
          push(node);
          if (!closed) stack.push(node);
        } else if (/^<\/aside>/i.test(html)) {
          if (top().type === 'callout') close();
        } else if (html) push({ type: 'paragraph', content: [{ type: 'text', text: html }] });
        break;
      }
      default:
        break;
    }
  }

  const doc = normalize(root);
  return (doc.content ?? []).length > 0 ? doc : emptyDoc();
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
        add(' ');
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
      case 'link_close':
        if (pageTarget) {
          out.push({ type: 'pageLink', attrs: { id: pageTarget.id, label: pageTarget.label.trim() } });
          pageTarget = null;
        } else remove('link');
        break;
      case 'code_inline':
        add(token.content, [{ type: 'code' }]);
        break;
      case 'image': {
        const src = String(token.attrGet('src') ?? '');
        const alt = token.content || String(token.attrGet('alt') ?? '');
        const file = options.resolveFile?.(src) ?? null;
        if (file?.image) out.push({ type: 'image', attrs: { fileId: file.fileId, alt } });
        else add(alt || 'image', [{ type: 'link', attrs: { href: src } }]);
        break;
      }
      case 'html_inline': {
        const tag = token.content.trim().toLowerCase();
        if (tag === '<u>') marks.push({ type: 'underline' });
        else if (tag === '</u>') remove('underline');
        else if (/^<br\s*\/?>$/.test(tag)) out.push({ type: 'hardBreak' });
        else add(token.content);
        break;
      }
      default:
        if (token.content) add(token.content);
    }
  }
  return linkPages(mergeText(out), options);
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

function linkPages(nodes: DocNode[], options: ParseOptions): DocNode[] {
  if (!options.resolvePage) return nodes;
  const out: DocNode[] = [];
  for (const node of nodes) {
    const text = node.text ?? '';
    if (node.type !== 'text' || node.marks?.some((mark) => mark.type === 'code') || !text.includes('[[')) {
      out.push(node);
      continue;
    }
    let last = 0;
    for (const match of text.matchAll(WIKI_LINK)) {
      const title = match[1]!.trim();
      const id = options.resolvePage(title);
      if (!id) continue;
      if (match.index > last) out.push({ ...node, text: text.slice(last, match.index) });
      out.push({ type: 'pageLink', attrs: { id, label: title } });
      last = match.index + match[0].length;
    }
    if (last < text.length) out.push({ ...node, text: text.slice(last) });
  }
  return out;
}

// shapes the tree so the editor schema accepts it
function normalize(node: DocNode): DocNode {
  const content = node.content?.flatMap((child) => liftMedia(normalize(child)));
  let next: DocNode = content ? { ...node, content } : { ...node };
  if (next.type === 'blockquote') next = toCallout(next);
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
  if (next.type === 'paragraph' || next.type === 'heading') {
    next = { ...next, content: (next.content ?? []).filter((child) => child.type !== 'text' || child.text) };
  }
  return next;
}

// images and file links alone in a paragraph become blocks, anywhere else they fall back to text
function liftMedia(node: DocNode): DocNode[] {
  if (node.type !== 'paragraph' || !node.content) return [node];
  const children = node.content;
  const meaningful = children.filter(
    (child) => !(child.type === 'hardBreak' || (child.type === 'text' && !child.text?.trim())),
  );
  if (meaningful.length > 0 && meaningful.every((child) => child.type === 'image')) return meaningful;
  const refs = new Set(meaningful.map((child) => fileRefOf(child)));
  const ref = refs.size === 1 ? [...refs][0] : undefined;
  if (ref?.image) return [{ type: 'image', attrs: { fileId: ref.fileId, alt: '' } }];
  if (ref) return [{ type: 'fileAttachment', attrs: { fileId: ref.fileId, name: ref.name } }];
  const content = children.map((child): DocNode => {
    if (child.type === 'image') return { type: 'text', text: String(child.attrs?.alt || 'image') };
    if (!fileRefOf(child)) return child;
    const marks = (child.marks ?? []).filter((mark) => !mark.attrs?.fileRef);
    return marks.length ? { ...child, marks } : { type: 'text', text: child.text ?? '' };
  });
  return [{ ...node, content: mergeText(content) }];
}

function fileRefOf(node: DocNode): { fileId: string; name: string; image: boolean } | undefined {
  const ref = node.marks?.find((mark) => mark.attrs?.fileRef)?.attrs?.fileRef;
  return ref as { fileId: string; name: string; image: boolean } | undefined;
}

// github style alerts, a quote that starts with a note, tip or warning marker
function toCallout(quote: DocNode): DocNode {
  const [first, ...rest] = quote.content ?? [];
  const lead = first?.type === 'paragraph' ? first.content?.[0] : undefined;
  const match = lead?.type === 'text' && !lead.marks?.length ? ALERT.exec(lead.text ?? '') : null;
  if (!first || !lead || !match) return quote;
  const remainder = (lead.text ?? '').slice(match[0].length);
  const inline = [...(remainder ? [{ ...lead, text: remainder }] : []), ...(first.content ?? []).slice(1)];
  if (inline[0]?.type === 'hardBreak') inline.shift();
  const content = inline.length ? [{ ...first, content: inline }, ...rest] : rest;
  return {
    type: 'callout',
    attrs: { tone: TONES[match[1]!.toLowerCase()] ?? 'note' },
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
