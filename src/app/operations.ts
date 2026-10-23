import { strToU8, unzipSync, zipSync } from 'fflate';
import katex from 'katex';
import {
  dailyInsertIndex,
  dailyTitle,
  dateKey,
  findDailyNote,
  findJournal,
  JOURNAL_TITLE,
} from '../core/daily';
import { fileIdsInDoc, remapFileIds } from '../core/doc';
import { planArchiveImport } from '../core/importer';
import type { ArchiveEntry } from '../core/importer';
import { canvasDoc, emptyCanvas } from '../core/canvas';
import type { Command } from '../core/commands';
import { defaultDatabase } from '../core/database';
import { displayTitle } from '../core/model';
import type { FileId, FileMeta, PageId, PageKind, Snapshot } from '../core/model';
import { databaseFromSubpages, fieldsForMove, releaseRow } from '../core/properties';
import { buildSite } from '../core/site';
import {
  applyTemplate,
  dailyTemplate,
  fillTemplate,
  findTemplatesPage,
  hasPlaceholder,
  TEMPLATES_TITLE,
} from '../core/templates';
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
import type { Route } from './router';
import { getTabs } from './tabs';
import type { PaneId } from './tabs';
import { dateLocale, t } from './i18n';
import { confirmAction, setUi, toast } from './ui';
import { getSession, getState, run, runAll } from './workspace';

export function expandPage(id: PageId | null): void {
  if (!id) return;
  const expanded = getPreferences().expanded;
  if (!expanded.includes(id)) setPreferences({ expanded: [...expanded, id] });
}

export function createPage(
  options: { parentId?: PageId | null; title?: string; index?: number; open?: boolean; kind?: PageKind } = {},
): PageId | null {
  const id = newId();
  const parentId = options.parentId ?? null;
  const kind = options.kind ?? 'page';
  const result = run({
    type: 'page.create',
    id,
    parentId,
    now: Date.now(),
    title: options.title ?? '',
    kind,
    ...(kind === 'database' ? { database: defaultDatabase(newId) } : {}),
    ...(kind === 'canvas' ? { doc: canvasDoc(emptyCanvas()) } : {}),
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

// moves a page under a new parent, carrying its values into or out of a database as frontmatter
export function movePage(id: PageId, parentId: PageId | null, index?: number): boolean {
  const now = Date.now();
  const plan = fieldsForMove(getState().pages, id, parentId, newId);
  const commands: Command[] = [];
  if (plan?.database)
    commands.push({ type: 'database.set', id: plan.database.id, database: plan.database.database, now });
  if (plan)
    commands.push({
      type: 'page.setFields',
      id,
      properties: plan.fields.properties,
      extra: plan.fields.extra,
      now,
    });
  commands.push({ type: 'page.move', id, parentId, ...(index !== undefined ? { index } : {}) });
  return runAll(commands).ok;
}

// a page and its subpages become a database and its rows, their frontmatter turning into columns
export function turnIntoDatabase(id: PageId): void {
  const state = getState();
  const page = state.pages[id];
  if (!page || page.kind !== 'page' || page.encrypted || page.dailyDate) return;
  const now = Date.now();
  const adopted = databaseFromSubpages(state.pages, id, newId, () => defaultDatabase(newId));
  const result = runAll([
    { type: 'page.setKind', id, kind: 'database', now },
    { type: 'database.set', id, database: adopted.database, now },
    ...adopted.rows.map((row): Command => ({
      type: 'page.setFields',
      id: row.id,
      properties: row.properties,
      extra: row.extra,
      now,
    })),
  ]);
  if (!result.ok) return;
  const rows = childrenOf(result.value.pages, id).length;
  const columns = adopted.database.properties.length;
  toast(
    rows
      ? t('toasts.turnedIntoDatabase', {
          rows: rows === 1 ? t('toasts.databaseRowSingle') : t('toasts.databaseRowPlural', { count: rows }),
          columns:
            columns === 1
              ? t('toasts.databasePropertySingle')
              : t('toasts.databasePropertyPlural', { count: columns }),
        })
      : t('toasts.turnedIntoDatabaseEmpty'),
  );
}

// a database becomes an ordinary page again, every row keeping its values as frontmatter
export function turnIntoPage(id: PageId): void {
  const state = getState();
  const page = state.pages[id];
  if (!page || page.kind !== 'database' || !page.database) return;
  const now = Date.now();
  const database = page.database;
  runAll([
    ...childrenOf(state.pages, id).map((row): Command => ({
      type: 'page.setFields',
      id: row.id,
      properties: {},
      extra: releaseRow(row, database),
      now,
    })),
    { type: 'page.setKind', id, kind: 'page', now },
  ]);
}

// today's daily note, made from the daily template when it does not exist yet
export function ensureToday(date = new Date()): PageId | null {
  const state = getState();
  const key = dateKey(date);
  const existing = findDailyNote(state, key);
  if (existing) return existing.id;
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
    if (!created.ok) return null;
    journal = created.value.pages[journalId]!;
  }
  const id = newId();
  const siblings = childrenOf(getState().pages, journal.id);
  const title = dailyTitle(date, dateLocale());
  const template = dailyTemplate(getState());
  const templateDoc = template ? getState().docs[template.id] : undefined;
  const result = run({
    type: 'page.create',
    id,
    parentId: journal.id,
    now,
    title,
    dailyDate: key,
    index: dailyInsertIndex(siblings, key),
    ...(template ? { tags: template.tags, icon: template.icon } : {}),
    ...(templateDoc ? { doc: applyTemplate(templateDoc, { title, date }) } : {}),
  });
  if (!result.ok) return null;
  expandPage(journal.id);
  return id;
}

export function openToday(date = new Date()): void {
  const id = ensureToday(date);
  if (!id) return;
  setUi({ mobileSidebar: false });
  openPage(id);
}

// a quick note from anywhere, added to the end of today's note with the time, a line starting [ ] becomes a task
export function captureToToday(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  commitEditors();
  const id = ensureToday();
  if (!id) return false;
  const doc = getState().docs[id] ?? { type: 'doc', content: [] };
  const time = new Date().toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  const blocks = clean.split(/\n{2,}/).map((part, index) => {
    const task = /^\[( |x)\]\s*/i.exec(part);
    const body = task ? part.slice(task[0].length) : part;
    const lines = body
      .split('\n')
      .flatMap((line, i) => [
        ...(i > 0 ? [{ type: 'hardBreak' }] : []),
        ...(line ? [{ type: 'text', text: line }] : []),
      ]);
    const content =
      index === 0 && !task
        ? [{ type: 'text', text: `${time} `, marks: [{ type: 'bold' }] }, ...lines]
        : lines;
    return task
      ? {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: task[1] !== ' ' },
              content: [{ type: 'paragraph', content }],
            },
          ],
        }
      : { type: 'paragraph', content };
  });
  const existing = (doc.content ?? []).filter(
    (node, _index, all) => !(all.length === 1 && node.type === 'paragraph' && !node.content?.length),
  );
  const result = run({
    type: 'page.setDoc',
    id,
    now: Date.now(),
    doc: { ...doc, content: [...existing, ...blocks] },
  });
  return result.ok;
}

export function createTemplatesPage(): PageId | null {
  const existing = findTemplatesPage(getState());
  if (existing) {
    openPage(existing.id);
    return existing.id;
  }
  const id = createPage({ title: TEMPLATES_TITLE, kind: 'templates', open: false });
  if (!id) return null;
  expandPage(id);
  openPage(id);
  return id;
}

// a new page that starts as a copy of a template, with its date and title fields filled in
export function createFromTemplate(templateId: PageId, parentId: PageId | null): PageId | null {
  const state = getState();
  const template = state.pages[templateId];
  if (!template) return null;
  const id = newId();
  const now = new Date();
  // the new page starts untitled, {{title}} reads as Untitled until the page is named. a template called
  // "Standup {{date}}" names its pages with the date filled in
  const title = hasPlaceholder(template.title)
    ? fillTemplate(template.title, { title: '', date: now }).trim()
    : '';
  const doc = applyTemplate(state.docs[templateId] ?? { type: 'doc', content: [{ type: 'paragraph' }] }, {
    title: displayTitle({ title }),
    date: now,
  });
  const result = run({
    type: 'page.create',
    id,
    parentId,
    now: now.getTime(),
    title,
    icon: template.icon,
    tags: template.tags,
    doc,
    ...(template.kind === 'database' && template.database
      ? { kind: 'database' as const, database: template.database }
      : {}),
  });
  if (!result.ok) return null;
  expandPage(parentId);
  setUi({ focusTitle: id, mobileSidebar: false });
  openPage(id);
  return id;
}

// copies a page into the templates page so new pages can start from it
export function saveAsTemplate(id: PageId): void {
  const state = getState();
  const page = state.pages[id];
  if (!page) return;
  const container = findTemplatesPage(state)?.id ?? createTemplatesPageQuietly();
  if (!container) return;
  const copy = newId();
  const result = run({
    type: 'page.create',
    id: copy,
    parentId: container,
    now: Date.now(),
    title: displayTitle(page),
    icon: page.icon,
    tags: page.tags,
    doc: state.docs[id] ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  });
  if (result.ok)
    toast(t('toasts.savedAsTemplate', { title: displayTitle(page) }), {
      action: { label: t('toasts.open'), run: () => openPage(copy) },
    });
}

function createTemplatesPageQuietly(): PageId | null {
  return createPage({ title: TEMPLATES_TITLE, kind: 'templates', open: false });
}

export function revealPage(id: PageId): void {
  const path = getSession().pathOf(id);
  if (path !== null) void desktop?.vault?.reveal(path);
}

// the sides of the open tab that show something, a split tab has two
function panesShowing(match: (route: Route) => boolean): PaneId[] {
  const { tabs, active } = getTabs();
  const side = tabs.find((tab) => tab.id === active)?.side;
  const panes: PaneId[] = [];
  if (match(parseRoute(window.location.hash))) panes.push('main');
  if (side && match(parseRoute(side.hash))) panes.push('side');
  return panes;
}

export function trashPage(id: PageId): void {
  const state = getState();
  const page = state.pages[id];
  if (!page) return;
  const affected = panesShowing(
    (route) =>
      route.name === 'page' &&
      (route.id === id || descendantsOf(state.pages, id).some((child) => child.id === route.id)),
  );
  const result = run({ type: 'page.trash', id, now: Date.now() });
  if (!result.ok) return;
  for (const pane of affected) {
    if (page.parentId && !isEffectivelyTrashed(result.value.pages, page.parentId))
      navigate({ name: 'page', id: page.parentId, find: null }, { pane });
    else navigate({ name: 'home' }, { pane });
  }
  toast(t('toasts.movedToTrash', { title: displayTitle(page) }), {
    action: {
      label: t('toasts.undo'),
      run: () => {
        const restored = run({ type: 'page.restore', id });
        if (restored.ok) for (const pane of affected) navigate({ name: 'page', id, find: null }, { pane });
      },
    },
  });
}

export function restorePage(id: PageId): void {
  const page = getState().pages[id];
  if (!page) return;
  const result = run({ type: 'page.restore', id });
  if (result.ok)
    toast(t('toasts.restoredPage', { title: displayTitle(page) }), {
      action: { label: t('toasts.open'), run: () => openPage(id) },
    });
}

export function deleteForever(id: PageId): void {
  const state = getState();
  const page = state.pages[id];
  if (!page) return;
  const count = descendantsOf(state.pages, id).length;
  confirmAction({
    title: t('dialogs.confirmDelete.title', { title: displayTitle(page) }),
    body:
      count > 0
        ? count === 1
          ? t('dialogs.confirmDelete.bodySubpagesSingle')
          : t('dialogs.confirmDelete.bodySubpagesPlural', { count })
        : t('dialogs.confirmDelete.bodyNoSubpages'),
    confirmLabel: t('dialogs.confirmDelete.confirmButton'),
    danger: true,
    onConfirm: () => {
      const result = run({ type: 'page.deleteForever', id });
      if (result.ok)
        for (const pane of panesShowing((route) => route.name === 'page' && !result.value.pages[route.id]))
          navigate({ name: 'trash' }, { pane });
    },
  });
}

export function emptyTrash(count: number): void {
  confirmAction({
    title: t('dialogs.emptyTrash.title'),
    body: count === 1 ? t('dialogs.emptyTrash.bodySingle') : t('dialogs.emptyTrash.bodyPlural', { count }),
    confirmLabel: t('dialogs.emptyTrash.confirmButton'),
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
  if (page.encrypted) {
    toast(t('toasts.encryptedNotExported'), {
      tone: 'error',
    });
    return;
  }
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

// the open page exactly as it looks, through the system's pdf printer
export async function exportPagePdf(id: PageId): Promise<void> {
  commitEditors();
  const page = getState().pages[id];
  if (!page || !desktop) return;
  const showing = panesShowing((route) => route.name === 'page' && route.id === id);
  if (showing.length === 0) openPage(id);
  // pictures and diagrams get a moment to finish drawing
  await new Promise((resolve) => setTimeout(resolve, 400));
  // a split tab prints only the side with the page on it
  const pane = showing[0] ?? (getTabs().pane === 'side' ? 'side' : 'main');
  const root = document.documentElement;
  root.dataset.printPane = pane;
  root.classList.add('is-printing');
  // paper is white, so a dark theme prints in the light one, with dark text
  const theme = root.dataset.theme;
  const scheme = root.style.colorScheme;
  root.dataset.theme = 'light';
  root.style.colorScheme = 'light';
  // nothing selected or focused shows up on paper
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  window.getSelection()?.removeAllRanges();
  try {
    const result = await desktop.exportPdf(displayTitle(page));
    if (result.ok) toast(t('toasts.pdfSaved', { filename: result.path.split(/[\\/]/).pop() ?? 'PDF' }));
    else if (result.error) toast(t('toasts.pdfExportFailed', { error: result.error }), { tone: 'error' });
  } finally {
    root.classList.remove('is-printing');
    delete root.dataset.printPane;
    if (theme) root.dataset.theme = theme;
    root.style.colorScheme = scheme;
  }
}

async function backupFiles(includeAttachments = true): Promise<BackupFile[]> {
  if (!includeAttachments) return [];
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

async function backupJson(includeAttachments = true): Promise<string> {
  commitEditors();
  await getSession().flush();
  return JSON.stringify(createBackup(getState(), new Date(), await backupFiles(includeAttachments)));
}

export async function exportBackup(): Promise<void> {
  try {
    saveFile(`morrow-backup-${stamp()}.json`, await backupJson(), 'application/json');
    toast(t('toasts.backupSaved'));
  } catch (error) {
    toast(t('toasts.backupFailed', { error: message(error) }), { tone: 'error' });
  }
}

export async function exportAllMarkdown(): Promise<void> {
  commitEditors();
  const { files, attachments } = workspaceMarkdownFiles(getState(), await fileIndex());
  if (files.length === 0) {
    toast(t('toasts.noPagesToExport'));
    return;
  }
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[`Morrow/${file.path}`] = strToU8(file.content);
  await zipAttachments(attachments, entries, 'Morrow/');
  saveFile(`morrow-markdown-${stamp()}.zip`, zipBytes(entries), 'application/zip');
}

// a folder of plain html pages to put on any web host, a free alternative to paid publishing services
export async function publishSite(rootId: PageId | null = null): Promise<void> {
  commitEditors();
  const state = getState();
  const root = rootId ? state.pages[rootId] : undefined;
  const location = getSession().location;
  const title = root
    ? displayTitle(root)
    : location
      ? (location.split(/[\\/]/).filter(Boolean).pop() ?? 'Morrow')
      : 'Morrow';
  try {
    const site = buildSite(state, {
      rootId,
      title,
      // mathml shows formulas in every current browser without shipping fonts
      renderMath: (latex, display) =>
        katex.renderToString(latex, { output: 'mathml', displayMode: display, throwOnError: false }),
    });
    const folder = safeFileName(title);
    const entries: Record<string, Uint8Array> = {};
    for (const file of site.files) entries[`${folder}/${file.path}`] = strToU8(file.content);
    for (const [fileId, path] of site.assets) {
      const file = await getSession().getFile(fileId);
      if (file) entries[`${folder}/${path}`] = new Uint8Array(file.data);
    }
    saveFile(`${folder}-website-${stamp()}.zip`, zipBytes(entries), 'application/zip');
    const pages = site.files.filter((file) => file.path.endsWith('.html')).length;
    toast(
      pages === 1 ? t('toasts.websiteCreatedSingle') : t('toasts.websiteCreatedPlural', { count: pages }),
      { durationMs: 10_000 },
    );
  } catch (error) {
    toast(t('toasts.websiteFailed', { error: message(error) }), { tone: 'error' });
  }
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
    if (entries.length === 0 && texts.length === 0) throw new Error(t('toasts.importTooLarge'));
    const state = getState();
    const now = Date.now();
    const archive = entries.length ? planArchiveImport(state, entries, parentId, newId, now) : null;
    const loose = texts.length ? planMarkdownImport(state, texts, parentId, newId, now) : null;
    // attachments are saved first so no imported page points at a file that is not stored
    const fileIds = new Map<string, string>();
    if (archive && archive.files.length > 0) {
      const stored = await getSession().addFiles(
        archive.files.map((file) => ({ meta: file.meta, data: file.data.slice().buffer as ArrayBuffer })),
      );
      if (!stored.ok) throw new Error(stored.error);
      archive.files.forEach((file, index) => fileIds.set(file.meta.id, stored.value[index]!.id));
    }
    const pages = [...(archive?.pages ?? []), ...(loose?.pages ?? [])];
    if (pages.length === 0) throw new Error(t('toasts.noMarkdownFound'));
    const docs = Object.fromEntries(
      Object.entries({ ...archive?.docs, ...loose?.docs }).map(([id, doc]) => [
        id,
        remapFileIds(doc, fileIds),
      ]),
    );
    const result = run({ type: 'pages.insert', pages, docs });
    if (!result.ok) return;
    expandPage(parentId);
    const notes = [
      tooLarge.length ? `${plural(tooLarge.length, 'file')} too large` : '',
      archive?.files.length ? plural(archive.files.length, 'attachment') : '',
      ...(archive?.problems ?? []),
    ].filter(Boolean);
    const notesStr = notes.length ? ` (${notes.join(', ')})` : '';
    toast(
      pages.length === 1
        ? t('toasts.importedSingle', { notes: notesStr })
        : t('toasts.importedPlural', { count: pages.length, notes: notesStr }),
    );
    const top = pages.filter((page) => page.parentId === parentId);
    if (top.length === 1) openPage(top[0]!.id);
  } catch (error) {
    toast(t('toasts.importFailed', { error: message(error) }), { tone: 'error' });
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
      toast(t('toasts.backupAlreadyPresent'));
      return;
    }
    // files go first, so no restored page ever points at something that is not saved yet
    const fileIds = new Map<string, string>();
    if (missing.length > 0) {
      const stored = await getSession().addFiles(
        missing.map(({ data, ...meta }) => ({ meta, data: base64ToBytes(data).buffer as ArrayBuffer })),
      );
      if (!stored.ok) throw new Error(stored.error);
      missing.forEach((backupFile, index) => fileIds.set(backupFile.id, stored.value[index]!.id));
    }
    if (plan.pages.length > 0) {
      const docs = Object.fromEntries(
        Object.entries(plan.docs).map(([id, doc]) => [id, remapFileIds(doc, fileIds)]),
      );
      const result = run({ type: 'pages.insert', pages: plan.pages, docs });
      if (!result.ok) return;
    }
    const notes = [
      plan.skipped ? t('toasts.alreadyPresent', { count: plan.skipped }) : '',
      plan.problems.length ? t('toasts.couldNotRead', { count: plan.problems.length }) : '',
    ].filter(Boolean);
    const notesStr = notes.length ? ` (${notes.join(', ')})` : '';
    toast(
      plan.pages.length === 1
        ? t('toasts.restoredBackupSingle', { notes: notesStr })
        : t('toasts.restoredBackupPlural', { count: plan.pages.length, notes: notesStr }),
    );
  } catch (error) {
    toast(t('toasts.restoreFailed', { error: message(error) }), { tone: 'error' });
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
    toast(t('toasts.noUnusedFiles'));
    return;
  }
  await getSession().deleteFiles(unused.map((file) => file.id));
  toast(
    unused.length === 1
      ? t('toasts.removedUnusedFilesSingle')
      : t('toasts.removedUnusedFilesPlural', { count: unused.length }),
  );
}

export async function restoreVersion(snapshot: Snapshot): Promise<boolean> {
  commitEditors();
  const result = await getSession().restoreSnapshot(snapshot);
  if (!result.ok) {
    toast(result.error, { tone: 'error' });
    return false;
  }
  toast(t('toasts.versionRestored'));
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
    // files in a vault are already on disk as they are, automatic backups only need the pages
    const result = await desktop.writeAutoBackup(await backupJson(getSession().location === null));
    if (result.ok) lastAutoBackup = latest;
    else toast(t('toasts.autoBackupFailed', { error: result.error }), { tone: 'error' });
  } catch (error) {
    toast(t('toasts.autoBackupFailed', { error: message(error) }), { tone: 'error' });
  }
}
