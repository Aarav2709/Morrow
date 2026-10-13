import { strToU8, unzipSync, zipSync } from 'fflate';
import {
  dailyInsertIndex,
  dailyTitle,
  dateKey,
  findDailyNote,
  findJournal,
  JOURNAL_TITLE,
} from '../core/daily';
import { fileIdsInDoc } from '../core/doc';
import { planArchiveImport } from '../core/importer';
import type { ArchiveEntry } from '../core/importer';
import { displayTitle } from '../core/model';
import type { FileId, FileMeta, PageId, Snapshot } from '../core/model';
import {
  attachmentNames,
  base64ToBytes,
  bytesToBase64,
  createBackup,
  pageMarkdown,
  parseBackup,
  planMarkdownImport,
  planRestore,
  referencedFileIds,
  safeFileName,
  workspaceMarkdownFiles,
} from '../core/portability';
import type { BackupFile } from '../core/portability';
import { childrenOf, descendantsOf, isEffectivelyTrashed } from '../core/tree';
import { commitEditors } from './editor/commits';
import { desktop } from './platform/desktop';
import { newId, pickFiles, saveFile, stamp } from './platform/files';
import { getPreferences, setPreferences } from './platform/preferences';
import { navigate, openPage, parseRoute } from './router';
import { confirmAction, setUi, toast } from './ui';
import { getSession, getState, run } from './workspace';

export function expandPage(id: PageId | null): void {
  if (!id) return;
  const expanded = getPreferences().expanded;
  if (!expanded.includes(id)) setPreferences({ expanded: [...expanded, id] });
}

export function createPage(
  options: { parentId?: PageId | null; title?: string; index?: number; open?: boolean } = {},
): PageId | null {
  const id = newId();
  const parentId = options.parentId ?? null;
  const result = run({
    type: 'page.create',
    id,
    parentId,
    now: Date.now(),
    title: options.title ?? '',
    ...(options.index !== undefined ? { index: options.index } : {}),
  });
  if (!result.ok) return null;
  expandPage(parentId);
  if (options.open !== false) {
    setUi({ focusTitle: id, mobileSidebar: false });
    openPage(id);
  }
  return id;
}

export function openToday(date = new Date()): void {
  const state = getState();
  const key = dateKey(date);
  const existing = findDailyNote(state, key);
  if (existing) {
    openPage(existing.id);
    setUi({ mobileSidebar: false });
    return;
  }
  let journal = findJournal(state);
  const now = Date.now();
  if (!journal) {
    const journalId = newId();
    const created = run({
      type: 'page.create',
      id: journalId,
      parentId: null,
      now,
      title: JOURNAL_TITLE,
      kind: 'journal',
    });
    if (!created.ok) return;
    journal = created.value.pages[journalId]!;
  }
  const id = newId();
  const siblings = childrenOf(getState().pages, journal.id);
  const result = run({
    type: 'page.create',
    id,
    parentId: journal.id,
    now,
    title: dailyTitle(date),
    dailyDate: key,
    index: dailyInsertIndex(siblings, key),
  });
  if (!result.ok) return;
  expandPage(journal.id);
  setUi({ mobileSidebar: false });
  openPage(id);
}

export function trashPage(id: PageId): void {
  const state = getState();
  const page = state.pages[id];
  if (!page) return;
  const route = parseRoute(window.location.hash);
  const viewingAffected =
    route.name === 'page' &&
    (route.id === id || descendantsOf(state.pages, id).some((child) => child.id === route.id));
  const result = run({ type: 'page.trash', id, now: Date.now() });
  if (!result.ok) return;
  if (viewingAffected) {
    if (page.parentId && !isEffectivelyTrashed(result.value.pages, page.parentId)) openPage(page.parentId);
    else navigate({ name: 'home' });
  }
  toast(`Moved “${displayTitle(page)}” to the trash`, {
    action: {
      label: 'Undo',
      run: () => {
        const restored = run({ type: 'page.restore', id });
        if (restored.ok && viewingAffected) openPage(id);
      },
    },
  });
}

export function restorePage(id: PageId): void {
  const page = getState().pages[id];
  if (!page) return;
  const result = run({ type: 'page.restore', id });
  if (result.ok)
    toast(`Restored “${displayTitle(page)}”`, { action: { label: 'Open', run: () => openPage(id) } });
}

export function deleteForever(id: PageId): void {
  const state = getState();
  const page = state.pages[id];
  if (!page) return;
  const count = descendantsOf(state.pages, id).length;
  confirmAction({
    title: `Delete “${displayTitle(page)}” forever?`,
    body:
      count > 0
        ? `This also deletes ${count} subpage${count === 1 ? '' : 's'}. This cannot be undone.`
        : 'This cannot be undone.',
    confirmLabel: 'Delete forever',
    danger: true,
    onConfirm: () => {
      const result = run({ type: 'page.deleteForever', id });
      if (result.ok) {
        const route = parseRoute(window.location.hash);
        if (route.name === 'page' && !result.value.pages[route.id]) navigate({ name: 'trash' });
      }
    },
  });
}

export function emptyTrash(count: number): void {
  confirmAction({
    title: 'Empty the trash?',
    body: `${count} page${count === 1 ? '' : 's'} and everything inside ${count === 1 ? 'it' : 'them'} will be deleted forever.`,
    confirmLabel: 'Empty trash',
    danger: true,
    onConfirm: () => {
      run({ type: 'trash.empty' });
    },
  });
}

export function duplicatePage(id: PageId): void {
  const copyId = newId();
  const result = run({ type: 'page.duplicate', id, newId: copyId, now: Date.now() });
  if (result.ok) openPage(copyId);
}

export function toggleFavorite(id: PageId): void {
  const page = getState().pages[id];
  if (page) run({ type: 'page.setFavorite', id, favorite: !page.favorite });
}

async function fileIndex(): Promise<Record<FileId, FileMeta>> {
  return Object.fromEntries((await getSession().listFiles()).map((file) => [file.id, file]));
}

async function zipAttachments(
  paths: Map<FileId, string>,
  entries: Record<string, Uint8Array>,
  prefix: string,
) {
  for (const [id, path] of paths) {
    const file = await getSession().getFile(id);
    if (file) entries[`${prefix}${path}`] = new Uint8Array(file.data);
  }
}

function zipBytes(entries: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  return zipSync(entries, { level: 6 }) as Uint8Array<ArrayBuffer>;
}

// a page with attachments exports as a zip so its images travel with it
export async function exportPageMarkdown(id: PageId): Promise<void> {
  commitEditors();
  const state = getState();
  const page = state.pages[id];
  const doc = state.docs[id];
  if (!page || !doc) return;
  const name = safeFileName(displayTitle(page));
  const ids = fileIdsInDoc(doc);
  if (ids.length === 0) {
    saveFile(`${name}.md`, pageMarkdown(state, id), 'text/markdown;charset=utf-8');
    return;
  }
  const names = attachmentNames(ids, await fileIndex());
  const paths = new Map([...names].map(([fileId, file]) => [fileId, `attachments/${file}`]));
  const entries: Record<string, Uint8Array> = {
    [`${name}/${name}.md`]: strToU8(pageMarkdown(state, id, (fileId) => paths.get(fileId) ?? null)),
  };
  await zipAttachments(paths, entries, `${name}/`);
  saveFile(`${name}.zip`, zipBytes(entries), 'application/zip');
}

async function backupFiles(): Promise<BackupFile[]> {
  const ids = referencedFileIds(getState());
  for (const snapshot of await getSession().allSnapshots()) {
    for (const fileId of fileIdsInDoc(snapshot.doc)) ids.add(fileId);
  }
  const files: BackupFile[] = [];
  for (const id of ids) {
    const file = await getSession().getFile(id);
    if (file) files.push({ ...file.meta, data: bytesToBase64(new Uint8Array(file.data)) });
  }
  return files;
}

async function backupJson(): Promise<string> {
  commitEditors();
  await getSession().flush();
  return JSON.stringify(createBackup(getState(), new Date(), await backupFiles()));
}

export async function exportBackup(): Promise<void> {
  try {
    saveFile(`morrow-backup-${stamp()}.json`, await backupJson(), 'application/json');
    toast('Backup saved. Keep it somewhere safe.');
  } catch (error) {
    toast(`The backup could not be created: ${message(error)}`, { tone: 'error' });
  }
}

export async function exportAllMarkdown(): Promise<void> {
  commitEditors();
  const { files, attachments } = workspaceMarkdownFiles(getState(), await fileIndex());
  if (files.length === 0) {
    toast('There are no pages to export yet.');
    return;
  }
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[`Morrow/${file.path}`] = strToU8(file.content);
  await zipAttachments(attachments, entries, 'Morrow/');
  saveFile(`morrow-markdown-${stamp()}.zip`, zipBytes(entries), 'application/zip');
}

const MAX_IMPORT_BYTES = 500 * 1024 * 1024;

// notion exports sometimes wrap their parts in further zips
function unzipAll(data: Uint8Array, depth = 0): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const [path, bytes] of Object.entries(unzipSync(data))) {
    if (path.endsWith('/')) continue;
    if (/\.zip$/i.test(path) && depth < 2) entries.push(...unzipAll(bytes, depth + 1));
    else entries.push({ path, data: bytes });
  }
  return entries;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

export async function importMarkdown(parentId: PageId | null = null): Promise<void> {
  const picked = await pickFiles(
    '.md,.markdown,.mdown,.txt,.zip,text/markdown,text/plain,application/zip',
    true,
  );
  if (picked.length === 0) return;
  const tooLarge = picked.filter((file) => file.size > MAX_IMPORT_BYTES);
  const files = picked.filter((file) => file.size <= MAX_IMPORT_BYTES);
  try {
    const entries: ArchiveEntry[] = [];
    const texts: Array<{ name: string; text: string }> = [];
    for (const file of files) {
      if (/\.zip$/i.test(file.name)) entries.push(...unzipAll(new Uint8Array(await file.arrayBuffer())));
      else texts.push({ name: file.name, text: await file.text() });
    }
    if (entries.length === 0 && texts.length === 0)
      throw new Error('Files larger than 500 MB are not imported.');
    const state = getState();
    const now = Date.now();
    const archive = entries.length ? planArchiveImport(state, entries, parentId, newId, now) : null;
    const loose = texts.length ? planMarkdownImport(state, texts, parentId, newId, now) : null;
    // attachments are saved first so no imported page points at a file that is not stored
    if (archive && archive.files.length > 0) {
      const stored = await getSession().addFiles(
        archive.files.map((file) => ({ meta: file.meta, data: file.data.slice().buffer as ArrayBuffer })),
      );
      if (!stored.ok) throw new Error(stored.error);
    }
    const pages = [...(archive?.pages ?? []), ...(loose?.pages ?? [])];
    if (pages.length === 0) throw new Error('No Markdown files were found.');
    const result = run({ type: 'pages.insert', pages, docs: { ...archive?.docs, ...loose?.docs } });
    if (!result.ok) return;
    expandPage(parentId);
    const notes = [
      tooLarge.length ? `${plural(tooLarge.length, 'file')} too large` : '',
      archive?.files.length ? plural(archive.files.length, 'attachment') : '',
      ...(archive?.problems ?? []),
    ].filter(Boolean);
    toast(`Imported ${plural(pages.length, 'page')}${notes.length ? ` (${notes.join(', ')})` : ''}.`);
    const top = pages.filter((page) => page.parentId === parentId);
    if (top.length === 1) openPage(top[0]!.id);
  } catch (error) {
    toast(`Import failed: ${message(error)}`, { tone: 'error' });
  }
}

export async function restoreBackup(): Promise<void> {
  const [file] = await pickFiles('.json,application/json', false);
  if (!file) return;
  try {
    const parsed = parseBackup(await file.text());
    if (!parsed.ok) {
      toast(parsed.error, { tone: 'error' });
      return;
    }
    const plan = planRestore(getState(), parsed.value, newId);
    const existing = new Set((await getSession().listFiles()).map((meta) => meta.id));
    const missing = parsed.value.files.filter((backupFile) => !existing.has(backupFile.id));
    if (plan.pages.length === 0 && missing.length === 0) {
      toast('Everything in this backup is already in your workspace.');
      return;
    }
    // files go first, so no restored page ever points at something that is not saved yet
    if (missing.length > 0) {
      const stored = await getSession().addFiles(
        missing.map(({ data, ...meta }) => ({ meta, data: base64ToBytes(data).buffer as ArrayBuffer })),
      );
      if (!stored.ok) throw new Error(stored.error);
    }
    if (plan.pages.length > 0) {
      const result = run({ type: 'pages.insert', pages: plan.pages, docs: plan.docs });
      if (!result.ok) return;
    }
    const notes = [
      plan.skipped ? `${plan.skipped} already present` : '',
      plan.problems.length ? `${plan.problems.length} could not be read` : '',
    ].filter(Boolean);
    toast(`Restored ${plural(plan.pages.length, 'page')}${notes.length ? ` (${notes.join(', ')})` : ''}.`);
  } catch (error) {
    toast(`Restore failed: ${message(error)}`, { tone: 'error' });
  }
}

// files nothing points at any more, not pages, not the trash, not page history
export async function unusedFiles(): Promise<FileMeta[]> {
  const used = referencedFileIds(getState());
  for (const snapshot of await getSession().allSnapshots()) {
    for (const id of fileIdsInDoc(snapshot.doc)) used.add(id);
  }
  return (await getSession().listFiles()).filter((file) => !used.has(file.id));
}

export async function deleteUnusedFiles(): Promise<void> {
  const unused = await unusedFiles();
  if (unused.length === 0) {
    toast('There are no unused files.');
    return;
  }
  await getSession().deleteFiles(unused.map((file) => file.id));
  toast(`Removed ${plural(unused.length, 'unused file')}.`);
}

export async function restoreVersion(snapshot: Snapshot): Promise<boolean> {
  commitEditors();
  const result = await getSession().restoreSnapshot(snapshot);
  if (!result.ok) {
    toast(result.error, { tone: 'error' });
    return false;
  }
  toast('Version restored. The version it replaced is kept in the page history.');
  return true;
}

let lastAutoBackup = 0;

// desktop only, keeps rolling json copies next to the app data
export async function writeAutoBackup(force = false): Promise<void> {
  if (!desktop) return;
  const state = getState();
  const latest = Math.max(0, ...Object.values(state.pages).map((page) => page.updatedAt));
  if (!force && latest <= lastAutoBackup) return;
  try {
    const result = await desktop.writeAutoBackup(await backupJson());
    if (result.ok) lastAutoBackup = latest;
    else toast(`Automatic backup failed: ${result.error}`, { tone: 'error' });
  } catch (error) {
    toast(`Automatic backup failed: ${message(error)}`, { tone: 'error' });
  }
}
