// the parts of a page a link can point at after #: a heading by its text, or a block by its ^id
import { inlineText } from './doc';
import type { DocNode } from './model';
import { foldText } from './search';

export function isBlockAnchor(anchor: string): boolean {
  return anchor.startsWith('^');
}

export function headingMatches(node: DocNode, anchor: string): boolean {
  return node.type === 'heading' && foldText(inlineText(node).trim()) === foldText(anchor.trim());
}

// what an embed of page#anchor shows: the block with that id, or a heading with everything under it
export function anchorSlice(doc: DocNode, anchor: string): DocNode | null {
  const blocks = doc.content ?? [];
  if (isBlockAnchor(anchor)) {
    const id = anchor.slice(1);
    let found: DocNode | null = null;
    const visit = (node: DocNode): void => {
      if (found) return;
      if (node.attrs?.blockId === id) found = node;
      else node.content?.forEach(visit);
    };
    blocks.forEach(visit);
    return found ? { type: 'doc', content: [found] } : null;
  }
  const start = blocks.findIndex((node) => headingMatches(node, anchor));
  if (start === -1) return null;
  const level = Number(blocks[start]!.attrs?.level ?? 1);
  let end = start + 1;
  while (end < blocks.length) {
    const node = blocks[end]!;
    if (node.type === 'heading' && Number(node.attrs?.level ?? 1) <= level) break;
    end++;
  }
  return { type: 'doc', content: blocks.slice(start, end) };
}

// a page with the part an anchor points at written again, such as after it was edited where it is shown in
// another page. the block keeps its ^id so links to it still find it. null when the part is gone
export function replaceAnchorSlice(doc: DocNode, anchor: string, blocks: DocNode[]): DocNode | null {
  const top = doc.content ?? [];
  if (isBlockAnchor(anchor)) {
    const id = anchor.slice(1);
    // the id goes on the first line of what replaces the block
    let placed = false;
    const keepId = (node: DocNode): DocNode => {
      if (placed) return node;
      if (node.type === 'paragraph') {
        placed = true;
        return { ...node, attrs: { ...node.attrs, blockId: id } };
      }
      return node.content ? { ...node, content: node.content.map(keepId) } : node;
    };
    const replacement = blocks.map(keepId);
    let found = false;
    const visit = (nodes: DocNode[]): DocNode[] =>
      nodes.flatMap((node) => {
        if (found) return [node];
        if (node.attrs?.blockId === id) {
          found = true;
          return replacement;
        }
        return node.content ? [{ ...node, content: visit(node.content) }] : [node];
      });
    const content = visit(top);
    return found ? { ...doc, content } : null;
  }
  const start = top.findIndex((node) => headingMatches(node, anchor));
  if (start === -1) return null;
  const level = Number(top[start]!.attrs?.level ?? 1);
  let end = start + 1;
  while (end < top.length) {
    const node = top[end]!;
    if (node.type === 'heading' && Number(node.attrs?.level ?? 1) <= level) break;
    end++;
  }
  return { ...doc, content: [...top.slice(0, start), ...blocks, ...top.slice(end)] };
}
