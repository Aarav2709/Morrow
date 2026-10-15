// where every page lives on disk: Title.md, with its subpages in a folder named Title next to it
import { displayTitle } from '../model';
import type { PageId, PageMeta, WorkspaceState } from '../model';
import { compareSiblings, effectiveParent } from '../tree';
import { basename, isInTrash, joinPath, safeFileName, TRASH_DIR } from './paths';

export interface Placement {
  // the page's own file, null for a folder that has no note of its own
  file: string | null;
  // the folder that holds its subpages, which may not exist on disk yet
  folder: string;
}

export type Layout = ReadonlyMap<PageId, Placement>;

const MAX_NAME = 120;

export function pageExtension(page: Pick<PageMeta, 'kind'>): string {
  return page.kind === 'canvas' ? '.canvas' : '.md';
}

export function desiredName(page: PageMeta): string {
  return page.dailyDate ?? safeFileName(displayTitle(page), MAX_NAME);
}

// names stay put when they still fit, so renaming one page never renames its siblings
export function placePages(
  state: WorkspaceState,
  previous: Layout,
  folderOnly: ReadonlySet<PageId>,
  // lower case paths of folders and files that belong to something other than a page
  reserved: ReadonlySet<string> = new Set(),
): Map<PageId, Placement> {
  const result = new Map<PageId, Placement>();
  const groups = new Map<string, PageMeta[]>();
  const byParent = new Map<PageId | null, PageMeta[]>();
  for (const page of Object.values(state.pages)) {
    const parent = effectiveParent(state.pages, page);
    const list = byParent.get(parent);
    if (list) list.push(page);
    else byParent.set(parent, [page]);
  }

  const visit = (parentId: PageId | null, folder: string, depth: number) => {
    if (depth > 256) return;
    for (const page of (byParent.get(parentId) ?? []).sort(compareSiblings)) {
      // a page trashed on its own goes to the trash folder, its subpages travel inside it
      const dir = page.trashedAt !== null ? TRASH_DIR : folder;
      const list = groups.get(dir);
      if (list) list.push(page);
      else groups.set(dir, [page]);
    }
    const dirs = new Set((byParent.get(parentId) ?? []).map((page) => (page.trashedAt !== null ? TRASH_DIR : folder)));
    for (const dir of dirs) assign(dir);
    for (const page of byParent.get(parentId) ?? []) {
      const placed = result.get(page.id);
      if (placed) visit(page.id, placed.folder, depth + 1);
    }
  };

  const used = new Map<string, Set<string>>();
  const assign = (dir: string) => {
    const pages = (groups.get(dir) ?? []).filter((page) => !result.has(page.id));
    let taken = used.get(dir);
    if (!taken) {
      taken = new Set();
      used.set(dir, taken);
    }
    const isFree = (name: string) => !taken.has(name.toLowerCase()) && !reserved.has(joinPath(dir, name).toLowerCase());
    const place = (page: PageMeta, name: string) => {
      taken.add(name.toLowerCase());
      const folder = joinPath(dir, name);
      result.set(page.id, { file: folderOnly.has(page.id) ? null : `${folder}${pageExtension(page)}`, folder });
    };
    const later: PageMeta[] = [];
    for (const page of pages) {
      const before = previous.get(page.id);
      const name = before ? basename(before.folder) : null;
      const wanted = desiredName(page);
      const fits =
        name !== null &&
        before !== undefined &&
        joinPath(dir, name) === before.folder &&
        (name.toLowerCase() === wanted.toLowerCase() || new RegExp(`^${escapeRegExp(wanted)} \\d+$`, 'i').test(name));
      if (fits && isFree(name)) place(page, name);
      else later.push(page);
    }
    for (const page of later) {
      const wanted = desiredName(page);
      let name = wanted;
      for (let n = 2; !isFree(name); n++) name = `${wanted} ${n}`;
      place(page, name);
    }
  };

  visit(null, '', 0);
  return result;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// how [[links]] name each page: the file name when it is unique in the vault, otherwise the full path,
// trashed pages keep their plain name so links read the same once they are restored
export function linkTargets(layout: Layout): Map<PageId, string> {
  const counts = new Map<string, number>();
  for (const placement of layout.values()) {
    if (isInTrash(placement.folder)) continue;
    const name = basename(placement.folder).toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const targets = new Map<PageId, string>();
  for (const [id, placement] of layout) {
    const name = basename(placement.folder);
    const shared = !isInTrash(placement.folder) && (counts.get(name.toLowerCase()) ?? 0) > 1;
    // obsidian names canvases with their extension
    const suffix = placement.file?.endsWith('.canvas') ? '.canvas' : '';
    targets.set(id, (shared ? placement.folder : name) + suffix);
  }
  return targets;
}
