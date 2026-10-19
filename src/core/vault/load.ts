// turns a scanned vault folder into pages, every file is read on its own so one bad file never blocks the rest
import { canvasDoc, readCanvas } from '../canvas';
import { isEncryptedText } from '../crypto';
import { validateDoc, isRecord } from '../doc';
import { markdownToDoc } from '../markdown/parse';
import type { ParseOptions } from '../markdown/parse';
import { newPageMeta } from '../model';
import type { DocNode, PageId, PageMeta, WorkspaceState } from '../model';
import { foldText } from '../search';
import { compareSiblings } from '../tree';
import type { Layout, Placement } from './layout';
import { readPageText, takeProperties } from './pageFile';
import type { PageSource } from './pageFile';
import { impliedTitle } from './pageFile';
import {
  ATTACHMENTS_DIR,
  basename,
  dirname,
  extension,
  isHiddenPath,
  isImagePath,
  isInTrash,
  isPageFile,
  resolveRelative,
  stripExtension,
  TRASH_DIR,
} from './paths';

export interface ScannedFile {
  path: string;
  text: string;
  mtime: number;
  birthtime: number;
}

export interface ScannedFolder {
  path: string;
  mtime: number;
  // true when the folder holds nothing at all
  empty: boolean;
}

export interface VaultScan {
  // markdown and canvas files
  files: ScannedFile[];
  folders: ScannedFolder[];
  // every other file, such as images and pdfs
  others: string[];
  // parsed contents of .morrow/workspace.json and .morrow/recent.json, or null
  registry: unknown;
  recent: unknown;
}

export interface RegistryEntry {
  id: PageId;
  created?: number;
  order?: number;
  favorite?: boolean;
  trashed?: number;
  // where a trashed page came from, so restoring puts it back
  parent?: PageId | null;
  // icons of canvases and folders, which have no frontmatter
  icon?: string;
}

export interface LoadedVault {
  pages: PageMeta[];
  docs: Record<PageId, DocNode>;
  problems: string[];
  unreadable: PageId[];
  layout: Map<PageId, Placement>;
  folderOnly: Set<PageId>;
  sources: Map<PageId, PageSource>;
  // the exact text of each page file, so morrow can tell its own writes from edits made elsewhere
  texts: Map<PageId, string>;
  // folders and files that are not pages, page names must not collide with them
  reserved: Set<string>;
  // true when pages were given new ids that the registry should remember
  registryChanged: boolean;
}

// files this large are opened read only rather than risk cutting them short
export const MAX_PAGE_BYTES = 4_000_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_NAME = /^\d{4}-\d{2}-\d{2}$/;

export function readRegistry(raw: unknown): Map<string, RegistryEntry> {
  const result = new Map<string, RegistryEntry>();
  const pages = isRecord(raw) && isRecord(raw.pages) ? raw.pages : {};
  const seen = new Set<string>();
  for (const [path, value] of Object.entries(pages)) {
    if (!isRecord(value) || typeof value.id !== 'string' || !ID_PATTERN.test(value.id) || seen.has(value.id))
      continue;
    seen.add(value.id);
    const num = (field: unknown) => (typeof field === 'number' && Number.isFinite(field) ? field : undefined);
    const entry: RegistryEntry = { id: value.id };
    if (num(value.created) !== undefined) entry.created = num(value.created)!;
    if (num(value.order) !== undefined) entry.order = num(value.order)!;
    if (value.favorite === true) entry.favorite = true;
    if (num(value.trashed) !== undefined) entry.trashed = num(value.trashed)!;
    if (typeof value.parent === 'string' && ID_PATTERN.test(value.parent)) entry.parent = value.parent;
    if (typeof value.icon === 'string' && value.icon.length <= 32) entry.icon = value.icon;
    result.set(path, entry);
  }
  return result;
}

export function readRecent(raw: unknown): Map<PageId, number> {
  const result = new Map<PageId, number>();
  const opened = isRecord(raw) && isRecord(raw.opened) ? raw.opened : {};
  for (const [id, value] of Object.entries(opened)) {
    if (ID_PATTERN.test(id) && typeof value === 'number' && Number.isFinite(value)) result.set(id, value);
  }
  return result;
}

interface Candidate {
  key: string;
  folder: string;
  file: ScannedFile | null;
  mtime: number;
  birthtime: number;
}

export function loadVault(scan: VaultScan, newId: () => string, now = Date.now()): LoadedVault {
  const registry = readRegistry(scan.registry);
  const recent = readRecent(scan.recent);
  const problems: string[] = [];
  const unreadable: PageId[] = [];
  let registryChanged = false;

  // page files, the folder of each page is its path without the extension
  const candidates: Candidate[] = [];
  const pageFolders = new Set<string>();
  for (const file of scan.files) {
    if (!isPageFile(file.path) || isHiddenPath(file.path) || file.path === TRASH_DIR) continue;
    const folder = stripExtension(file.path);
    if (folder === TRASH_DIR) continue;
    candidates.push({ key: file.path, folder, file, mtime: file.mtime, birthtime: file.birthtime });
    for (let dir = dirname(folder); dir && dir !== TRASH_DIR; dir = dirname(dir)) pageFolders.add(dir);
  }
  // folders holding pages without a note of their own, and empty folders, become pages too
  const filed = new Set(candidates.map((candidate) => candidate.folder.toLowerCase()));
  for (const folder of scan.folders) {
    if (folder.path === TRASH_DIR || isHiddenPath(folder.path)) continue;
    // the attachments folder holds files, it only becomes a page if someone keeps notes in it
    if (folder.path === ATTACHMENTS_DIR && !pageFolders.has(folder.path)) continue;
    if (!pageFolders.has(folder.path) && !folder.empty) continue;
    if (filed.has(folder.path.toLowerCase())) continue;
    filed.add(folder.path.toLowerCase());
    candidates.push({
      key: folder.path,
      folder: folder.path,
      file: null,
      mtime: folder.mtime,
      birthtime: folder.mtime,
    });
  }
  // a folder that holds pages but was not listed still needs a page
  for (const dir of pageFolders) {
    if (filed.has(dir.toLowerCase())) continue;
    filed.add(dir.toLowerCase());
    candidates.push({ key: dir, folder: dir, file: null, mtime: now, birthtime: now });
  }
  candidates.sort((a, b) => a.key.localeCompare(b.key));

  const usedIds = new Set<PageId>();
  const idOf = new Map<string, PageId>();
  for (const candidate of candidates) {
    const known = registry.get(candidate.key)?.id;
    if (known && !usedIds.has(known)) {
      usedIds.add(known);
      idOf.set(candidate.key, known);
    }
  }
  for (const candidate of candidates) {
    if (idOf.has(candidate.key)) continue;
    let id = newId();
    while (usedIds.has(id)) id = newId();
    usedIds.add(id);
    idOf.set(candidate.key, id);
    registryChanged = true;
  }

  // the page that owns a folder: its note, else its canvas, else the bare folder
  const owner = new Map<string, PageId>();
  const rank = (candidate: Candidate) => (candidate.file ? (candidate.file.path.endsWith('.md') ? 0 : 1) : 2);
  for (const candidate of [...candidates].sort((a, b) => rank(a) - rank(b))) {
    const lower = candidate.folder.toLowerCase();
    if (!owner.has(lower)) owner.set(lower, idOf.get(candidate.key)!);
  }

  const pages = new Map<PageId, PageMeta>();
  const layout = new Map<PageId, Placement>();
  const folderOnly = new Set<PageId>();
  const sources = new Map<PageId, PageSource>();
  const texts = new Map<PageId, string>();
  const bodies = new Map<PageId, { body: string; file: string }>();
  const canvases = new Map<PageId, unknown>();

  for (const candidate of candidates) {
    const id = idOf.get(candidate.key)!;
    const entry = registry.get(candidate.key);
    const parentFolder = dirname(candidate.folder);
    const trashRoot = parentFolder === TRASH_DIR;
    let parentId: PageId | null = null;
    if (trashRoot) parentId = entry?.parent && entry.parent !== id ? entry.parent : null;
    else if (parentFolder) parentId = owner.get(parentFolder.toLowerCase()) ?? null;
    if (parentId === id) parentId = null;

    const page = newPageMeta({
      id,
      parentId,
      title: basename(candidate.folder),
      createdAt: entry?.created ?? (candidate.birthtime || candidate.mtime || now),
      updatedAt: candidate.mtime || now,
      trashedAt: trashRoot ? (entry?.trashed ?? (candidate.mtime || now)) : null,
      favorite: entry?.favorite === true,
      lastOpenedAt: recent.get(id) ?? null,
      icon: entry?.icon ?? null,
      order: entry?.order ?? Number.MAX_SAFE_INTEGER,
    });
    layout.set(id, { file: candidate.file?.path ?? null, folder: candidate.folder });
    if (!candidate.file) {
      folderOnly.add(id);
      pages.set(id, page);
      continue;
    }
    texts.set(id, candidate.file.text);
    const label = candidate.file.path;
    if (candidate.file.text.length > MAX_PAGE_BYTES) {
      unreadable.push(id);
      problems.push(`“${label}” is too large to edit in Morrow, so it is shown read only.`);
      pages.set(id, page);
      continue;
    }
    if (extension(candidate.file.path) === 'canvas') {
      page.kind = 'canvas';
      try {
        canvases.set(id, JSON.parse(candidate.file.text || '{}'));
      } catch {
        unreadable.push(id);
        problems.push(`The canvas “${label}” could not be read and was left untouched.`);
      }
      pages.set(id, page);
      continue;
    }
    // an encrypted page stays locked until someone gives its password
    if (isEncryptedText(candidate.file.text)) {
      page.encrypted = true;
      unreadable.push(id);
      pages.set(id, page);
      continue;
    }
    const read = readPageText(candidate.file.text);
    if (read.error) {
      unreadable.push(id);
      problems.push(`“${label}”: ${read.error} It is shown read only.`);
      pages.set(id, page);
      continue;
    }
    if (read.title) page.title = read.title;
    if (read.icon) page.icon = read.icon;
    page.cover = read.cover;
    if (read.kind) page.kind = read.kind;
    page.tags = read.tags;
    page.database = read.database;
    page.extra = read.extra;
    sources.set(id, read.source);
    bodies.set(id, { body: read.body, file: candidate.file.path });
    pages.set(id, page);
  }

  // daily notes are the date named pages inside the journal, their titles follow the date
  for (const page of pages.values()) {
    const parent = page.parentId ? pages.get(page.parentId) : undefined;
    const name = basename(layout.get(page.id)!.folder);
    if (parent?.kind === 'journal' && DATE_NAME.test(name)) {
      page.dailyDate = name;
      if (page.title === name) page.title = impliedTitle(name, name);
    }
  }

  // database rows read their property values from frontmatter keys named after each property
  for (const page of pages.values()) {
    const parent = page.parentId ? pages.get(page.parentId) : undefined;
    if (parent?.kind === 'database' && parent.database)
      takeProperties(parent.database, page.extra, page.properties, newId);
  }

  // siblings keep the order the registry remembers, the rest follow by name, newest first in the journal
  const byParent = new Map<PageId | null, PageMeta[]>();
  for (const page of pages.values()) {
    const key = page.parentId && pages.has(page.parentId) ? page.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), page]);
  }
  for (const [parentId, siblings] of byParent) {
    const journal = parentId !== null && pages.get(parentId)?.kind === 'journal';
    siblings.sort(
      (a, b) =>
        a.order - b.order ||
        (journal ? (b.dailyDate ?? '').localeCompare(a.dailyDate ?? '') : 0) ||
        a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }),
    );
    siblings.forEach((page, index) => (page.order = index));
  }

  const state: WorkspaceState = { pages: Object.fromEntries(pages), docs: {} };
  const otherIndex = new Map<string, string>();
  const otherNames = new Map<string, string[]>();
  for (const path of scan.others) {
    if (isHiddenPath(path)) continue;
    otherIndex.set(path.toLowerCase(), path);
    const name = basename(path).toLowerCase();
    otherNames.set(name, [...(otherNames.get(name) ?? []), path]);
  }
  const resolver = makeResolver(state, layout, sources);
  const docs: Record<PageId, DocNode> = {};
  for (const [id, { body, file }] of bodies) {
    const dir = dirname(file);
    const doc = markdownToDoc(
      body,
      parseOptions(dir, resolver, (href) => resolveFile(dir, href, otherIndex, otherNames)),
    );
    const valid = validateDoc(doc);
    if (valid.ok) docs[id] = valid.value;
    else {
      unreadable.push(id);
      problems.push(`“${file}” could not be read: ${valid.error}`);
    }
  }
  const pageAtPath = (path: string) => resolver.byPath(stripExtension(path));
  for (const [id, raw] of canvases) {
    const data = readCanvas(raw, pageAtPath);
    if (data) docs[id] = canvasDoc(data);
    else {
      unreadable.push(id);
      problems.push(`The canvas “${layout.get(id)?.file}” could not be read and was left untouched.`);
    }
  }

  const reserved = new Set<string>();
  for (const folder of scan.folders)
    if (!filed.has(folder.path.toLowerCase())) reserved.add(folder.path.toLowerCase());

  return {
    pages: [...pages.values()],
    docs,
    problems,
    unreadable,
    layout,
    folderOnly,
    sources,
    texts,
    reserved,
    registryChanged,
  };
}

export function parseOptions(
  dir: string,
  resolver: Resolver,
  resolveFileHref: ParseOptions['resolveFile'],
): ParseOptions {
  return {
    resolvePage: (target) => resolver.resolve(target, dir),
    resolveLink: (href) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return null;
      const decoded = safeDecode(href.split('#')[0]!);
      if (!/\.(md|canvas)$/i.test(decoded)) return null;
      const path = resolveRelative(dir, decoded) ?? decoded;
      return resolver.byPath(stripExtension(path)) ?? resolver.byPath(stripExtension(decoded));
    },
    ...(resolveFileHref ? { resolveFile: resolveFileHref } : {}),
  };
}

export function resolveFile(
  dir: string,
  href: string,
  index: ReadonlyMap<string, string>,
  names: ReadonlyMap<string, string[]>,
): { fileId: string; name: string; image: boolean } | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const decoded = safeDecode(href.split('#')[0]!.split('?')[0]!);
  if (!decoded) return null;
  const relative = resolveRelative(dir, decoded);
  const hit =
    (relative !== null ? index.get(relative.toLowerCase()) : undefined) ??
    index.get(decoded.replace(/^\/+/, '').toLowerCase()) ??
    (decoded.includes('/')
      ? undefined
      : names
          .get(decoded.toLowerCase())
          ?.slice()
          .sort((a, b) => a.length - b.length)[0]);
  return hit ? { fileId: hit, name: basename(hit), image: isImagePath(hit) } : null;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export interface Resolver {
  // finds the page a [[link]] means, the way obsidian does: path, then file name, then title or alias
  resolve(target: string, fromDir: string): PageId | null;
  byPath(path: string): PageId | null;
}

export function makeResolver(
  state: WorkspaceState,
  layout: Layout,
  sources: ReadonlyMap<PageId, PageSource>,
): Resolver {
  const paths = new Map<string, PageId>();
  const names = new Map<string, PageId[]>();
  const titles = new Map<string, PageId[]>();
  const add = (map: Map<string, PageId[]>, key: string, id: PageId) =>
    map.set(key, [...(map.get(key) ?? []), id]);
  for (const [id, placement] of layout) {
    if (!state.pages[id]) continue;
    const lower = placement.folder.toLowerCase();
    if (!paths.has(lower) || placement.file?.endsWith('.md')) paths.set(lower, id);
    add(names, foldText(basename(placement.folder)), id);
  }
  for (const page of Object.values(state.pages)) {
    add(titles, foldText(page.title.trim()), page.id);
    for (const alias of sources.get(page.id)?.aliases ?? []) add(titles, foldText(alias), page.id);
  }
  // pages outside the trash and closer to the root win when names are shared
  const best = (ids: PageId[] | undefined) => {
    if (!ids?.length) return null;
    return [...ids].sort((a, b) => {
      const pa = layout.get(a)?.folder ?? '';
      const pb = layout.get(b)?.folder ?? '';
      return (
        Number(isInTrash(pa)) - Number(isInTrash(pb)) ||
        pa.split('/').length - pb.split('/').length ||
        compareSiblings(state.pages[a]!, state.pages[b]!)
      );
    })[0]!;
  };
  const byPath = (path: string) => paths.get(path.replace(/^\/+/, '').toLowerCase()) ?? null;
  return {
    byPath,
    resolve(target, fromDir) {
      const clean = target.trim().replace(/\.(md|canvas)$/i, '');
      if (!clean) return null;
      if (clean.startsWith('.')) {
        const relative = resolveRelative(fromDir, clean);
        if (relative !== null && byPath(relative)) return byPath(relative);
      }
      if (clean.includes('/')) {
        const exact = byPath(clean);
        if (exact) return exact;
        // obsidian also accepts a path that ends with the folders it names
        const suffix = `/${clean.toLowerCase()}`;
        const tail = [...paths.entries()].filter(([path]) => path.endsWith(suffix)).map(([, id]) => id);
        if (tail.length) return best(tail);
      }
      const folded = foldText(clean);
      return best(names.get(folded)) ?? best(titles.get(folded));
    },
  };
}
