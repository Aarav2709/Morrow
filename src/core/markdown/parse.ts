import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import { emptyDoc } from '../model';
import type { DocMark, DocNode, PageId } from '../model';
import { inlineText } from '../doc';

export interface ParseOptions {
  // resolves [[title]] links to page ids, unresolved links stay as text
  resolvePage?: (title: string) => PageId | null;
}

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
        if (html) push({ type: 'paragraph', content: [{ type: 'text', text: html }] });
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

  for (const token of tokens) {
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
      case 'link_open':
        marks.push({ type: 'link', attrs: { href: String(token.attrGet('href') ?? '') } });
        break;
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
        remove('link');
        break;
      case 'code_inline':
        add(token.content, [{ type: 'code' }]);
        break;
      case 'image': {
        const alt = token.content || String(token.attrGet('alt') ?? '') || 'image';
        add(alt, [{ type: 'link', attrs: { href: String(token.attrGet('src') ?? '') } }]);
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
    a.every((mark, i) => mark.type === b[i]!.type && mark.attrs?.href === b[i]!.attrs?.href)
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
  const content = node.content?.map(normalize);
  let next: DocNode = content ? { ...node, content } : { ...node };

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
