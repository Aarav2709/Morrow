// tags come from a page's tags property and from #tags written in its text
import { walk } from './doc';
import { COLORS } from './model';
import type { ColorName, DocNode, PageId, PageMeta, WorkspaceState } from './model';
import { livePages } from './tree';
import { normalizeTag } from './vault/frontmatter';

const INLINE_TAG = /(?:^|[\s(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

const docTagCache = new WeakMap<DocNode, string[]>();

export function inlineTags(doc: DocNode | undefined): string[] {
  if (!doc) return [];
  const cached = docTagCache.get(doc);
  if (cached) return cached;
  const tags = new Set<string>();
  walk(doc, (node, parent) => {
    if (node.type === 'codeBlock' || node.type === 'rawBlock') return false;
    if (node.type !== 'text' || !node.text || parent?.type === 'codeBlock') return;
    if (node.marks?.some((mark) => mark.type === 'code' || mark.type === 'link')) return;
    for (const match of node.text.matchAll(INLINE_TAG)) {
      const tag = normalizeTag(match[1]!);
      if (tag) tags.add(tag);
    }
  });
  const result = [...tags];
  docTagCache.set(doc, result);
  return result;
}

export function tagsOf(page: PageMeta, doc: DocNode | undefined): string[] {
  return [...new Set([...page.tags, ...inlineTags(doc)])];
}

// a page tagged project/garden also counts for project
export function tagMatches(tag: string, wanted: string): boolean {
  const a = tag.toLowerCase();
  const b = wanted.toLowerCase();
  return a === b || a.startsWith(`${b}/`);
}

export interface TagSummary {
  tag: string;
  pages: PageId[];
}

export function collectTags(state: WorkspaceState): TagSummary[] {
  const byTag = new Map<string, { tag: string; pages: Set<PageId> }>();
  for (const page of livePages(state.pages)) {
    for (const tag of tagsOf(page, state.docs[page.id])) {
      const key = tag.toLowerCase();
      const entry = byTag.get(key) ?? { tag, pages: new Set<PageId>() };
      entry.pages.add(page.id);
      byTag.set(key, entry);
    }
  }
  return [...byTag.values()]
    .map((entry) => ({ tag: entry.tag, pages: [...entry.pages] }))
    .sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
}

export function pagesWithTag(state: WorkspaceState, wanted: string): PageMeta[] {
  return livePages(state.pages)
    .filter((page) => tagsOf(page, state.docs[page.id]).some((tag) => tagMatches(tag, wanted)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// every tag keeps the same colour everywhere, picked from its name
export function tagColor(tag: string): ColorName {
  let hash = 0;
  for (const char of tag.toLowerCase().split('/')[0]!) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  // gray is left out so every tag gets a real colour
  const palette = COLORS.filter((color) => color !== 'gray');
  return palette[hash % palette.length]!;
}
