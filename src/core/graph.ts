// the graph of pages joined by links, used by the graph view
import { pagesInCanvas, canvasFromDoc } from './canvas';
import { linksInDoc } from './links';
import { displayTitle } from './model';
import type { PageId, WorkspaceState } from './model';
import { tagsOf } from './tags';
import { ancestorsOf, livePages } from './tree';

export interface GraphNode {
  id: string;
  label: string;
  kind: 'page' | 'tag';
  pageId: PageId | null;
  degree: number;
  // the top level page this node sits under, the graph colours each section differently
  group: string;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: 'link' | 'child' | 'tag';
}

export interface GraphOptions {
  tags: boolean;
  hierarchy: boolean;
  orphans: boolean;
  // only pages within depth links of this page
  focus: PageId | null;
  depth: number;
}

export const DEFAULT_GRAPH_OPTIONS: GraphOptions = {
  tags: false,
  hierarchy: false,
  orphans: true,
  focus: null,
  depth: 1,
};

export function buildGraph(
  state: WorkspaceState,
  options: GraphOptions,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const pages = livePages(state.pages);
  const live = new Set(pages.map((page) => page.id));
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  const addLink = (source: string, target: string, kind: GraphLink['kind']) => {
    if (source === target) return;
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source, target, kind });
  };
  const rootOf = (id: PageId) => {
    const chain = ancestorsOf(state.pages, id);
    return chain.length ? chain[chain.length - 1]!.id : id;
  };
  for (const page of pages) {
    nodes.set(page.id, {
      id: page.id,
      label: displayTitle(page),
      kind: 'page',
      pageId: page.id,
      degree: 0,
      group: rootOf(page.id),
    });
  }
  for (const page of pages) {
    const doc = state.docs[page.id];
    if (!doc) continue;
    if (page.kind === 'canvas')
      for (const target of pagesInCanvas(canvasFromDoc(doc)))
        if (live.has(target)) addLink(page.id, target, 'link');
    for (const link of linksInDoc(doc)) if (live.has(link.targetId)) addLink(page.id, link.targetId, 'link');
    if (options.hierarchy && page.parentId && live.has(page.parentId))
      addLink(page.parentId, page.id, 'child');
    if (options.tags) {
      for (const tag of tagsOf(page, doc)) {
        const id = `#${tag.toLowerCase()}`;
        if (!nodes.has(id))
          nodes.set(id, { id, label: `#${tag}`, kind: 'tag', pageId: null, degree: 0, group: id });
        addLink(page.id, id, 'tag');
      }
    }
  }
  for (const link of links) {
    nodes.get(link.source)!.degree++;
    nodes.get(link.target)!.degree++;
  }
  let kept = [...nodes.values()];
  if (options.focus && nodes.has(options.focus)) {
    const near = new Set([options.focus]);
    for (let step = 0; step < Math.max(1, options.depth); step++) {
      for (const link of links) {
        if (near.has(link.source)) near.add(link.target);
        else if (near.has(link.target)) near.add(link.source);
      }
    }
    kept = kept.filter((node) => near.has(node.id));
  } else if (!options.orphans) kept = kept.filter((node) => node.degree > 0);
  const ids = new Set(kept.map((node) => node.id));
  return { nodes: kept, links: links.filter((link) => ids.has(link.source) && ids.has(link.target)) };
}
