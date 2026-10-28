import { MAX_TREE_DEPTH } from './model';
import type { PageId, PageMeta, WorkspaceState } from './model';

type Pages = WorkspaceState['pages'];

export function compareSiblings(a: PageMeta, b: PageMeta): number {
  return a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

// built once per pages object so large trees stay fast, pages objects are never mutated
const liveIndex = new WeakMap<Pages, Map<PageId | null, PageMeta[]>>();

export function childrenOf(pages: Pages, parentId: PageId | null, includeTrashed = false): PageMeta[] {
  if (!includeTrashed) {
    let index = liveIndex.get(pages);
    if (!index) {
      index = groupByParent(pages, false);
      for (const list of index.values()) Object.freeze(list);
      liveIndex.set(pages, index);
    }
    return index.get(parentId) ?? [];
  }
  const result: PageMeta[] = [];
  for (const page of Object.values(pages)) {
    if (effectiveParent(pages, page) === parentId && (includeTrashed || page.trashedAt === null)) {
      result.push(page);
    }
  }
  return result.sort(compareSiblings);
}

// a page with a missing parent shows at the top level instead of vanishing
export function effectiveParent(pages: Pages, page: PageMeta): PageId | null {
  return page.parentId !== null && pages[page.parentId] ? page.parentId : null;
}

// nearest parent first, stops on missing parents and corrupted cycles
export function ancestorsOf(pages: Pages, id: PageId): PageMeta[] {
  const result: PageMeta[] = [];
  const seen = new Set<PageId>([id]);
  let current = pages[id]?.parentId ?? null;
  while (current !== null && result.length < MAX_TREE_DEPTH && !seen.has(current)) {
    const parent = pages[current];
    if (!parent) break;
    seen.add(current);
    result.push(parent);
    current = parent.parentId;
  }
  return result;
}

export function descendantsOf(pages: Pages, id: PageId): PageMeta[] {
  const byParent = groupByParent(pages);
  const result: PageMeta[] = [];
  const seen = new Set<PageId>([id]);
  const queue: PageId[] = [id];
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const child of byParent.get(next) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      queue.push(child.id);
    }
  }
  return result;
}

export function isDescendantOf(pages: Pages, id: PageId, ancestorId: PageId): boolean {
  return ancestorsOf(pages, id).some((page) => page.id === ancestorId);
}

export function isEffectivelyTrashed(pages: Pages, id: PageId): boolean {
  const page = pages[id];
  if (!page) return true;
  if (page.trashedAt !== null) return true;
  return ancestorsOf(pages, id).some((ancestor) => ancestor.trashedAt !== null);
}

const liveCache = new WeakMap<Pages, PageMeta[]>();

export function livePages(pages: Pages): PageMeta[] {
  const cached = liveCache.get(pages);
  if (cached) return cached;
  const trashed = new Map<PageId, boolean>();
  const resolve = (id: PageId, depth: number): boolean => {
    const known = trashed.get(id);
    if (known !== undefined) return known;
    const page = pages[id];
    let value: boolean;
    if (!page || page.trashedAt !== null) value = true;
    else if (page.parentId === null || depth > MAX_TREE_DEPTH) value = false;
    else if (!pages[page.parentId]) value = false;
    else value = resolve(page.parentId, depth + 1);
    trashed.set(id, value);
    return value;
  };
  const result = Object.values(pages).filter((page) => !resolve(page.id, 0));
  liveCache.set(pages, Object.freeze(result) as PageMeta[]);
  return result;
}

export function trashedPages(pages: Pages): PageMeta[] {
  return Object.values(pages)
    .filter((page) => page.trashedAt !== null)
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
}

export function archivedPages(pages: Pages): PageMeta[] {
  return Object.values(pages)
    .filter((page) => page.archivedAt !== null && !isEffectivelyTrashed(pages, page.id))
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
}

export function flattenTree(pages: Pages): Array<{ page: PageMeta; depth: number }> {
  const byParent = groupByParent(pages, false);
  const result: Array<{ page: PageMeta; depth: number }> = [];
  const seen = new Set<PageId>();
  const visit = (parentId: PageId | null, depth: number) => {
    if (depth > MAX_TREE_DEPTH) return;
    for (const page of byParent.get(parentId) ?? []) {
      if (seen.has(page.id)) continue;
      seen.add(page.id);
      result.push({ page, depth });
      visit(page.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

function groupByParent(pages: Pages, includeTrashed = true): Map<PageId | null, PageMeta[]> {
  const map = new Map<PageId | null, PageMeta[]>();
  for (const page of Object.values(pages)) {
    if (!includeTrashed && page.trashedAt !== null) continue;
    const parent = effectiveParent(pages, page);
    const list = map.get(parent);
    if (list) list.push(page);
    else map.set(parent, [page]);
  }
  for (const list of map.values()) list.sort(compareSiblings);
  return map;
}
