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
