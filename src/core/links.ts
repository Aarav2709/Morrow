import { docToPlainText, inlineText } from './doc';
import { displayTitle } from './model';
import type { DocNode, PageId, PageMeta, WorkspaceState } from './model';
import { livePages } from './tree';

const PAGE_HREF = /^#\/page\/([A-Za-z0-9_-]+)/;

export function pageIdFromHref(href: unknown): PageId | null {
  if (typeof href !== 'string') return null;
  return PAGE_HREF.exec(href)?.[1] ?? null;
}

export interface LinkOccurrence {
  targetId: PageId;
  context: string;
}

// documents never change once made, so the links of each are worked out once. backlinks and the graph
// look through every page after every edit, which this keeps quick in a big vault
const linkCache = new WeakMap<DocNode, LinkOccurrence[]>();

// page link nodes plus ordinary links that point at a page
export function linksInDoc(doc: DocNode): LinkOccurrence[] {
  const cached = linkCache.get(doc);
  if (cached) return cached;
  const result = findLinks(doc);
  linkCache.set(doc, result);
  return result;
}

function findLinks(doc: DocNode): LinkOccurrence[] {
  const result: LinkOccurrence[] = [];
  const visitBlock = (block: DocNode) => {
    const targets: PageId[] = [];
    const collect = (node: DocNode) => {
      if (node.type === 'pageLink' && typeof node.attrs?.id === 'string') targets.push(node.attrs.id);
      for (const mark of node.marks ?? []) {
        const id = mark.type === 'link' ? pageIdFromHref(mark.attrs?.href) : null;
        if (id) targets.push(id);
      }
      for (const child of node.content ?? []) collect(child);
    };
    collect(block);
    if (targets.length === 0) return;
    const context = inlineText(block).trim();
    for (const targetId of new Set(targets)) result.push({ targetId, context });
  };
  const visit = (node: DocNode) => {
    if (node.type === 'paragraph' || node.type === 'heading') return visitBlock(node);
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return result;
}

export interface Backlink {
  source: PageMeta;
  contexts: string[];
}

export function backlinksTo(state: WorkspaceState, targetId: PageId): Backlink[] {
  const result: Backlink[] = [];
  for (const page of livePages(state.pages)) {
    if (page.id === targetId) continue;
    const doc = state.docs[page.id];
    if (!doc) continue;
    const contexts = linksInDoc(doc)
      .filter((link) => link.targetId === targetId)
      .map((link) => link.context);
    if (contexts.length > 0) result.push({ source: page, contexts });
  }
  return result.sort((a, b) => b.source.updatedAt - a.source.updatedAt);
}

// swaps stored link labels for current titles before export
export function refreshLinkLabels(doc: DocNode, titleOf: (id: PageId) => string | null): DocNode {
  const visit = (node: DocNode): DocNode => {
    if (node.type === 'pageLink' && typeof node.attrs?.id === 'string') {
      const title = titleOf(node.attrs.id);
      return title === null ? node : { ...node, attrs: { ...node.attrs, label: title } };
    }
    if (!node.content) return node;
    return { ...node, content: node.content.map(visit) };
  };
  return visit(doc);
}

export interface Mention {
  source: PageMeta;
  context: string;
}

// pages that name this page in their text without linking to it, so a link is easy to add
export function unlinkedMentions(state: WorkspaceState, targetId: PageId, limit = 20): Mention[] {
  const target = state.pages[targetId];
  const title = target ? displayTitle(target).trim() : '';
  if (title.length < 3 || title === 'Untitled') return [];
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`,
    'iu',
  );
  const result: Mention[] = [];
  for (const page of livePages(state.pages)) {
    if (page.id === targetId || result.length >= limit) continue;
    const doc = state.docs[page.id];
    if (!doc || linksInDoc(doc).some((link) => link.targetId === targetId)) continue;
    const text = docToPlainText(doc);
    const match = pattern.exec(text);
    if (!match) continue;
    const at = match.index + match[1]!.length;
    const lineStart = text.lastIndexOf('\n', at) + 1;
    const lineEnd = text.indexOf('\n', at);
    result.push({
      source: page,
      context: text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).slice(0, 200),
    });
  }
  return result.sort((a, b) => b.source.updatedAt - a.source.updatedAt);
}
