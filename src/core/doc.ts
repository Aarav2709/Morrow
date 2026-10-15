import { KNOWN_MARK_TYPES, KNOWN_NODE_TYPES, MAX_DOC_DEPTH, MAX_DOC_NODES } from './model';
import type { DocNode } from './model';
import { fail, ok } from './result';
import type { Result } from './result';

// checks structure and size only, unknown node types are allowed and preserved
export function validateDoc(value: unknown): Result<DocNode> {
  if (!isRecord(value) || value.type !== 'doc') return fail('Document must be an object of type "doc".');
  let count = 0;
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > MAX_DOC_DEPTH) return fail('Document is nested too deeply.');
    if (++count > MAX_DOC_NODES) return fail('Document is too large.');
    if (!isRecord(node) || typeof node.type !== 'string' || node.type.length === 0) {
      return fail('Document contains an invalid node.');
    }
    if (node.text !== undefined && typeof node.text !== 'string') return fail('Text node has invalid text.');
    if (node.attrs !== undefined && !isRecord(node.attrs)) return fail('Node has invalid attributes.');
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) return fail('Node has invalid marks.');
      for (const mark of node.marks) {
        if (!isRecord(mark) || typeof mark.type !== 'string') return fail('Node has an invalid mark.');
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) return fail('Node has invalid content.');
      for (const child of node.content) stack.push({ node: child, depth: depth + 1 });
    }
  }
  return ok(value as unknown as DocNode);
}

// node and mark types this version cannot edit safely
export function findUnknownTypes(doc: DocNode): string[] {
  const unknown = new Set<string>();
  walk(doc, (node) => {
    if (!KNOWN_NODE_TYPES.has(node.type)) unknown.add(node.type);
    for (const mark of node.marks ?? []) if (!KNOWN_MARK_TYPES.has(mark.type)) unknown.add(mark.type);
  });
  return [...unknown];
}

// depth first walk, return false from the visitor to skip children
export function walk(doc: DocNode, visit: (node: DocNode, parent: DocNode | null) => boolean | void): void {
  const stack: Array<{ node: DocNode; parent: DocNode | null }> = [{ node: doc, parent: null }];
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    if (visit(node, parent) === false) continue;
    const children = node.content ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i]!, parent: node });
  }
}

export function inlineText(node: DocNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'pageLink') return String(node.attrs?.alias ?? node.attrs?.label ?? '');
  if (node.type === 'inlineMath') return String(node.attrs?.latex ?? '');
  return (node.content ?? []).map(inlineText).join('');
}

export function docToPlainText(doc: DocNode): string {
  const lines: string[] = [];
  const visit = (node: DocNode) => {
    if (
      node.type === 'paragraph' ||
      node.type === 'heading' ||
      node.type === 'codeBlock' ||
      node.type === 'detailsSummary'
    ) {
      const text = inlineText(node);
      if (text.length > 0) lines.push(text);
      return;
    }
    if (node.type === 'image' && node.attrs?.alt) lines.push(String(node.attrs.alt));
    if (node.type === 'rawBlock' && node.attrs?.text) lines.push(String(node.attrs.text));
    if (node.type === 'blockMath' && node.attrs?.latex) lines.push(String(node.attrs.latex));
    // canvases are searched by the words on their cards
    if (node.type === 'canvas' && Array.isArray(node.attrs?.nodes)) {
      for (const card of node.attrs.nodes as Array<{ text?: unknown; label?: unknown; url?: unknown }>) {
        for (const value of [card.text, card.label, card.url]) if (typeof value === 'string' && value) lines.push(value);
      }
    }
    if (node.type === 'fileAttachment' && node.attrs?.name) lines.push(String(node.attrs.name));
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return lines.join('\n');
}

export function isDocEmpty(doc: DocNode): boolean {
  const blocks = doc.content ?? [];
  if (blocks.length === 0) return true;
  if (blocks.length > 1) return false;
  const only = blocks[0]!;
  return only.type === 'paragraph' && (only.content ?? []).length === 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function cloneDoc(doc: DocNode): DocNode {
  return JSON.parse(JSON.stringify(doc)) as DocNode;
}

// every stored file a document points at, through images and attachments
export function fileIdsInDoc(doc: DocNode): string[] {
  const ids = new Set<string>();
  walk(doc, (node) => {
    if ((node.type === 'image' || node.type === 'fileAttachment') && typeof node.attrs?.fileId === 'string') {
      ids.add(node.attrs.fileId);
    }
  });
  return [...ids];
}

// points images and attachments at new file ids, for files that were stored under a different id
export function remapFileIds(doc: DocNode, ids: ReadonlyMap<string, string>): DocNode {
  if (ids.size === 0) return doc;
  const visit = (node: DocNode): DocNode => {
    let next = node;
    if ((node.type === 'image' || node.type === 'fileAttachment') && typeof node.attrs?.fileId === 'string') {
      const id = ids.get(node.attrs.fileId);
      if (id) next = { ...node, attrs: { ...node.attrs, fileId: id } };
    }
    return next.content ? { ...next, content: next.content.map(visit) } : next;
  };
  return visit(doc);
}
