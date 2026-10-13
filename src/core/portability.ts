import { cloneDoc, isRecord } from './doc';
import { findDailyNote, findJournal } from './daily';
import { refreshLinkLabels } from './links';
import { markdownToPage } from './markdown/parse';
import { pageToMarkdown } from './markdown/serialize';
import { displayTitle, SCHEMA_VERSION } from './model';
import type { DocNode, PageId, PageMeta, WorkspaceState } from './model';
import { readWorkspace } from './migrations';
import { errorMessage, fail, ok } from './result';
import type { Result } from './result';
import { pageIdByTitle } from './search';
import { childrenOf, livePages } from './tree';

export const BACKUP_FORMAT = 'morrow-backup';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  pages: PageMeta[];
  docs: Record<PageId, DocNode>;
}

export interface InsertPlan {
  pages: PageMeta[];
  docs: Record<PageId, DocNode>;
  skipped: number;
  problems: string[];
}

export function createBackup(state: WorkspaceState, now: Date): Backup {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    pages: Object.values(state.pages),
    docs: { ...state.docs },
  };
}

export function parseBackup(
  text: string,
): Result<{ pages: PageMeta[]; docs: Record<PageId, DocNode>; problems: string[] }> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return fail(`This file is not valid JSON (${errorMessage(error)}).`);
  }
  if (!isRecord(data) || data.format !== BACKUP_FORMAT) return fail('This file is not a Morrow backup.');
  if (!Array.isArray(data.pages) || !isRecord(data.docs)) return fail('The backup is incomplete.');
  const loaded = readWorkspace(Number(data.schemaVersion), { pages: data.pages, docs: data.docs });
  if (!loaded.ok) return loaded;
  return ok(loaded.value);
}

// restoring only ever adds pages, conflicting ids get fresh ids and identical pages are skipped
export function planRestore(
  state: WorkspaceState,
  backup: { pages: PageMeta[]; docs: Record<PageId, DocNode>; problems: string[] },
  newId: () => PageId,
): InsertPlan {
  const remap = new Map<PageId, PageId>();
  const skip = new Set<PageId>();
  for (const page of backup.pages) {
    const existing = state.pages[page.id];
    if (!existing) continue;
    if (existing.updatedAt === page.updatedAt && existing.title === page.title) skip.add(page.id);
    else remap.set(page.id, newId());
  }
  const hasJournal = findJournal(state) !== null;
  const mapId = (id: PageId) => remap.get(id) ?? id;
  const incomingIds = new Set(backup.pages.map((page) => page.id));
  const pages: PageMeta[] = [];
  const docs: Record<PageId, DocNode> = {};
  for (const page of backup.pages) {
    if (skip.has(page.id)) continue;
    const id = mapId(page.id);
    const parentKnown =
      page.parentId !== null && (incomingIds.has(page.parentId) || state.pages[page.parentId]);
    pages.push({
      ...page,
      id,
      parentId: parentKnown ? mapId(page.parentId!) : null,
      title: remap.has(page.id) ? `${page.title || 'Untitled'} (restored)` : page.title,
      kind: page.kind === 'journal' && hasJournal ? 'page' : page.kind,
      dailyDate: page.dailyDate && findDailyNote(state, page.dailyDate) ? null : page.dailyDate,
    });
    const doc = backup.docs[page.id];
    if (doc) docs[id] = remapLinks(doc, mapId);
  }
  return { pages, docs, skipped: skip.size, problems: backup.problems };
}

function remapLinks(doc: DocNode, mapId: (id: PageId) => PageId): DocNode {
  const visit = (node: DocNode): DocNode => {
    const next = node.content ? { ...node, content: node.content.map(visit) } : node;
    if (node.type === 'pageLink' && typeof node.attrs?.id === 'string') {
      return { ...next, attrs: { ...node.attrs, id: mapId(node.attrs.id) } };
    }
    return next;
  };
  return visit(cloneDoc(doc));
}

export interface MarkdownFile {
  name: string;
  text: string;
}

// each file becomes a page, [[links]] resolve against existing and imported pages
export function planMarkdownImport(
  state: WorkspaceState,
  files: MarkdownFile[],
  parentId: PageId | null,
  newId: () => PageId,
  now: number,
): InsertPlan {
  const base = childrenOf(state.pages, parentId).length;
  const drafts = files.map((file) => {
    const fallback = file.name.replace(/\.(md|markdown|mdown|txt)$/i, '').trim() || 'Untitled';
    const firstLine = /^#\s+(.+)$/m.exec(file.text.split('\n').find((line) => line.trim()) ?? '');
    return { id: newId(), file, fallback, title: firstLine?.[1]?.trim() ?? fallback };
  });
  const resolvePage = (title: string): PageId | null => {
    const imported = drafts.find((draft) => draft.title.toLowerCase() === title.toLowerCase());
    return imported?.id ?? pageIdByTitle(state, title);
  };
  const pages: PageMeta[] = [];
  const docs: Record<PageId, DocNode> = {};
  drafts.forEach((draft, index) => {
    const parsed = markdownToPage(draft.file.text, draft.fallback, { resolvePage });
    pages.push({
      id: draft.id,
      parentId,
      title: parsed.title,
      icon: null,
      kind: 'page',
      order: base + index,
      createdAt: now,
      updatedAt: now,
      trashedAt: null,
      favorite: false,
      dailyDate: null,
      lastOpenedAt: null,
    });
    docs[draft.id] = parsed.doc;
  });
  return { pages, docs, skipped: 0, problems: [] };
}

export function pageMarkdown(state: WorkspaceState, id: PageId): string {
  const page = state.pages[id];
  const doc = state.docs[id];
  if (!page || !doc) return '';
  const titleOf = (target: PageId) => (state.pages[target] ? displayTitle(state.pages[target]) : null);
  return pageToMarkdown(displayTitle(page), refreshLinkLabels(doc, titleOf), { titleOf });
}

export interface ExportFile {
  path: string;
  content: string;
}

// a page with subpages exports as title.md next to a folder named after it
export function workspaceMarkdownFiles(state: WorkspaceState): ExportFile[] {
  const live = new Set(livePages(state.pages).map((page) => page.id));
  const files: ExportFile[] = [];
  const visit = (parentId: PageId | null, folder: string, depth: number) => {
    if (depth > 32) return;
    const used = new Set<string>();
    for (const page of childrenOf(state.pages, parentId)) {
      if (!live.has(page.id)) continue;
      const name = uniqueName(safeFileName(displayTitle(page)), used);
      files.push({ path: `${folder}${name}.md`, content: pageMarkdown(state, page.id) });
      visit(page.id, `${folder}${name}/`, depth + 1);
    }
  };
  visit(null, '', 0);
  return files;
}

export function safeFileName(title: string): string {
  const printable = [...title].map((char) => (char.charCodeAt(0) < 32 ? ' ' : char)).join('');
  const cleaned = printable
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60)
    .trim();
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  return !cleaned || reserved.test(cleaned) ? 'Untitled' : cleaned;
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})`;
  used.add(candidate.toLowerCase());
  return candidate;
}
