import { strToU8, zipSync } from 'fflate';
import {
  dailyInsertIndex,
  dailyTitle,
  dateKey,
  findDailyNote,
  findJournal,
  JOURNAL_TITLE,
} from '../core/daily';
import { displayTitle } from '../core/model';
import type { PageId } from '../core/model';
import {
  createBackup,
  pageMarkdown,
  parseBackup,
  planMarkdownImport,
  planRestore,
  safeFileName,
  workspaceMarkdownFiles,
} from '../core/portability';
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

export function exportPageMarkdown(id: PageId): void {
  commitEditors();
  const state = getState();
  const page = state.pages[id];
  if (!page) return;
  saveFile(`${safeFileName(displayTitle(page))}.md`, pageMarkdown(state, id), 'text/markdown;charset=utf-8');
}

export async function exportBackup(): Promise<void> {
  commitEditors();
  await getSession().flush();
  const backup = createBackup(getState(), new Date());
  saveFile(`morrow-backup-${stamp()}.json`, JSON.stringify(backup, null, 1), 'application/json');
  toast('Backup saved. Keep it somewhere safe.');
}

export function exportAllMarkdown(): void {
  commitEditors();
  const files = workspaceMarkdownFiles(getState());
  if (files.length === 0) {
    toast('There are no pages to export yet.');
    return;
  }
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[`Morrow/${file.path}`] = strToU8(file.content);
  saveFile(
    `morrow-markdown-${stamp()}.zip`,
    zipSync(entries, { level: 6 }) as Uint8Array<ArrayBuffer>,
    'application/zip',
  );
}

export async function importMarkdown(parentId: PageId | null = null): Promise<void> {
  const files = await pickFiles('.md,.markdown,.mdown,.txt,text/markdown,text/plain', true);
  if (files.length === 0) return;
  const tooLarge = files.filter((file) => file.size > 5_000_000);
  const readable = files.filter((file) => file.size <= 5_000_000);
  try {
    const texts = await Promise.all(
      readable.map(async (file) => ({ name: file.name, text: await file.text() })),
    );
    if (texts.length === 0) throw new Error('Files larger than 5 MB are not imported.');
    const plan = planMarkdownImport(getState(), texts, parentId, newId, Date.now());
    const result = run({ type: 'pages.insert', pages: plan.pages, docs: plan.docs });
    if (!result.ok) return;
    expandPage(parentId);
    const skipped = tooLarge.length
      ? ` ${tooLarge.length} file${tooLarge.length === 1 ? ' was' : 's were'} too large.`
      : '';
    toast(`Imported ${plan.pages.length} page${plan.pages.length === 1 ? '' : 's'}.${skipped}`);
    if (plan.pages.length === 1) openPage(plan.pages[0]!.id);
  } catch (error) {
    toast(`Import failed: ${error instanceof Error ? error.message : 'unknown error'}`, { tone: 'error' });
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
    if (plan.pages.length === 0) {
      toast('Everything in this backup is already in your workspace.');
      return;
    }
    const result = run({ type: 'pages.insert', pages: plan.pages, docs: plan.docs });
    if (!result.ok) return;
    const notes = [
      plan.skipped ? `${plan.skipped} already present` : '',
      plan.problems.length ? `${plan.problems.length} could not be read` : '',
    ].filter(Boolean);
    toast(
      `Restored ${plan.pages.length} page${plan.pages.length === 1 ? '' : 's'}${notes.length ? ` (${notes.join(', ')})` : ''}.`,
    );
  } catch (error) {
    toast(`Restore failed: ${error instanceof Error ? error.message : 'unknown error'}`, { tone: 'error' });
  }
}

let lastAutoBackup = 0;

// desktop only, keeps rolling json copies next to the app data
export async function writeAutoBackup(force = false): Promise<void> {
  if (!desktop) return;
  commitEditors();
  const state = getState();
  const latest = Math.max(0, ...Object.values(state.pages).map((page) => page.updatedAt));
  if (!force && latest <= lastAutoBackup) return;
  const result = await desktop.writeAutoBackup(JSON.stringify(createBackup(state, new Date())));
  if (result.ok) lastAutoBackup = latest;
  else toast(`Automatic backup failed: ${result.error}`, { tone: 'error' });
}
