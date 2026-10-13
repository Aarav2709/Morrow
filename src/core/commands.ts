// every workspace change goes through here, pure and never throwing
import { validateDoc } from './doc';
import { emptyDoc, MAX_ICON_LENGTH, MAX_TITLE_LENGTH } from './model';
import type { DocNode, PageId, PageKind, PageMeta, WorkspaceState } from './model';
import { errorMessage, fail, ok } from './result';
import type { Result } from './result';
import { setTaskChecked } from './tasks';
import { childrenOf, descendantsOf, isDescendantOf, isEffectivelyTrashed, livePages } from './tree';

export type Command =
  | {
      type: 'page.create';
      id: PageId;
      parentId: PageId | null;
      now: number;
      title?: string;
      icon?: string | null;
      kind?: PageKind;
      dailyDate?: string | null;
      doc?: DocNode;
      index?: number;
    }
  | { type: 'page.rename'; id: PageId; title: string; now: number }
  | { type: 'page.setIcon'; id: PageId; icon: string | null; now: number }
  | { type: 'page.move'; id: PageId; parentId: PageId | null; index?: number }
  | { type: 'page.duplicate'; id: PageId; newId: PageId; now: number }
  | { type: 'page.setDoc'; id: PageId; doc: DocNode; now: number }
  | { type: 'page.setFavorite'; id: PageId; favorite: boolean }
  | { type: 'page.markOpened'; id: PageId; now: number }
  | { type: 'page.trash'; id: PageId; now: number }
  | { type: 'page.restore'; id: PageId }
  | { type: 'page.deleteForever'; id: PageId }
  | { type: 'trash.empty' }
  | { type: 'task.setChecked'; pageId: PageId; index: number; checked: boolean; now: number }
  | { type: 'pages.insert'; pages: PageMeta[]; docs: Record<PageId, DocNode> };

export type CommandType = Command['type'];

// records touched by a command, storage writes exactly these
export interface Changes {
  pages: Set<PageId>;
  docs: Set<PageId>;
  removed: Set<PageId>;
}

export interface Applied {
  state: WorkspaceState;
  changes: Changes;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function emptyChanges(): Changes {
  return { pages: new Set(), docs: new Set(), removed: new Set() };
}

export function applyCommand(state: WorkspaceState, command: Command): Result<Applied> {
  try {
    return dispatch(state, command);
  } catch (error) {
    return fail(`Unexpected error in ${describe(command)}: ${errorMessage(error)}`);
  }
}

function describe(command: unknown): string {
  return typeof command === 'object' && command !== null && 'type' in command
    ? String((command as { type: unknown }).type)
    : 'command';
}

function dispatch(state: WorkspaceState, command: Command): Result<Applied> {
  switch (command.type) {
    case 'page.create':
      return createPage(state, command);
    case 'page.rename': {
      const page = requirePage(state, command.id);
      if (!page.ok) return page;
      const title = normalizeTitle(command.title);
      if (title === page.value.title) return unchanged(state);
      return updatePage(state, { ...page.value, title, updatedAt: command.now });
    }
    case 'page.setIcon': {
      const page = requirePage(state, command.id);
      if (!page.ok) return page;
      const icon = normalizeIcon(command.icon);
      if (!icon.ok) return icon;
      return updatePage(state, { ...page.value, icon: icon.value, updatedAt: command.now });
    }
    case 'page.move':
      return movePage(state, command.id, command.parentId, command.index);
    case 'page.duplicate':
      return duplicatePage(state, command);
    case 'page.setDoc': {
      const page = requirePage(state, command.id);
      if (!page.ok) return page;
      const doc = validateDoc(command.doc);
      if (!doc.ok) return doc;
      const next = withChanges(state, { pages: [{ ...page.value, updatedAt: command.now }] });
      return setDocs(next, { [command.id]: doc.value });
    }
    case 'page.setFavorite': {
      const page = requirePage(state, command.id);
      if (!page.ok) return page;
      if (page.value.favorite === command.favorite) return unchanged(state);
      return updatePage(state, { ...page.value, favorite: command.favorite === true });
    }
    case 'page.markOpened': {
      const page = requirePage(state, command.id);
      if (!page.ok) return page;
      return updatePage(state, { ...page.value, lastOpenedAt: command.now });
    }
    case 'page.trash': {
      const page = requirePage(state, command.id);
      if (!page.ok) return page;
      if (page.value.trashedAt !== null) return unchanged(state);
      return updatePage(state, { ...page.value, trashedAt: command.now });
    }
    case 'page.restore':
      return restorePage(state, command.id);
    case 'page.deleteForever': {
      const page = requirePage(state, command.id);
      if (!page.ok) return page;
      if (!isEffectivelyTrashed(state.pages, command.id)) {
        return fail('Only pages in the trash can be deleted permanently.');
      }
      return removePages(state, [command.id, ...descendantsOf(state.pages, command.id).map((p) => p.id)]);
    }
    case 'trash.empty': {
      const live = new Set(livePages(state.pages).map((page) => page.id));
      return removePages(
        state,
        Object.keys(state.pages).filter((id) => !live.has(id)),
      );
    }
    case 'task.setChecked': {
      const page = requirePage(state, command.pageId);
      if (!page.ok) return page;
      const doc = state.docs[command.pageId];
      const next = doc ? setTaskChecked(doc, command.index, command.checked === true) : null;
      if (!next) return fail('That checklist item no longer exists.');
      const withPage = withChanges(state, { pages: [{ ...page.value, updatedAt: command.now }] });
      return setDocs(withPage, { [command.pageId]: next });
    }
    case 'pages.insert':
      return insertPages(state, command.pages, command.docs);
    default: {
      const unknown: never = command;
      return fail(`Unknown command: ${describe(unknown)}`);
    }
  }
}

function createPage(
  state: WorkspaceState,
  command: Extract<Command, { type: 'page.create' }>,
): Result<Applied> {
  if (!ID_PATTERN.test(command.id)) return fail('Invalid page id.');
  if (state.pages[command.id]) return fail('A page with this id already exists.');
  const parent = checkParent(state, command.parentId);
  if (!parent.ok) return parent;
  const icon = normalizeIcon(command.icon ?? null);
  if (!icon.ok) return icon;
  if (command.dailyDate != null && !DATE_PATTERN.test(command.dailyDate)) return fail('Invalid daily date.');
  const doc = validateDoc(command.doc ?? emptyDoc());
  if (!doc.ok) return doc;
  const page: PageMeta = {
    id: command.id,
    parentId: command.parentId,
    title: normalizeTitle(command.title ?? ''),
    icon: icon.value,
    kind: command.kind === 'journal' ? 'journal' : 'page',
    order: 0,
    createdAt: command.now,
    updatedAt: command.now,
    trashedAt: null,
    favorite: false,
    dailyDate: command.dailyDate ?? null,
    lastOpenedAt: null,
  };
  const siblings = childrenOf(state.pages, command.parentId);
  const placed = placeAmong(siblings, page, command.index);
  return setDocs(withChanges(state, { pages: placed }), { [page.id]: doc.value });
}

function movePage(
  state: WorkspaceState,
  id: PageId,
  parentId: PageId | null,
  index: number | undefined,
): Result<Applied> {
  const page = requirePage(state, id);
  if (!page.ok) return page;
  if (parentId === id) return fail('A page cannot be moved inside itself.');
  const parent = checkParent(state, parentId);
  if (!parent.ok) return parent;
  if (parentId !== null && isDescendantOf(state.pages, parentId, id)) {
    return fail('A page cannot be moved inside one of its own subpages.');
  }
  const siblings = childrenOf(state.pages, parentId).filter((sibling) => sibling.id !== id);
  return ok(withChanges(state, { pages: placeAmong(siblings, { ...page.value, parentId }, index) }));
}

function duplicatePage(
  state: WorkspaceState,
  command: Extract<Command, { type: 'page.duplicate' }>,
): Result<Applied> {
  const page = requirePage(state, command.id);
  if (!page.ok) return page;
  if (!ID_PATTERN.test(command.newId) || state.pages[command.newId]) return fail('Invalid id for the copy.');
  const source = page.value;
  const siblings = childrenOf(state.pages, source.parentId);
  const copy: PageMeta = {
    ...source,
    id: command.newId,
    title: normalizeTitle(source.title ? `${source.title} (copy)` : ''),
    kind: 'page',
    dailyDate: null,
    favorite: false,
    createdAt: command.now,
    updatedAt: command.now,
    lastOpenedAt: null,
    trashedAt: null,
  };
  const index = siblings.findIndex((sibling) => sibling.id === source.id) + 1;
  const doc = state.docs[source.id] ?? emptyDoc();
  return setDocs(withChanges(state, { pages: placeAmong(siblings, copy, index) }), {
    [copy.id]: JSON.parse(JSON.stringify(doc)) as DocNode,
  });
}

function restorePage(state: WorkspaceState, id: PageId): Result<Applied> {
  const page = requirePage(state, id);
  if (!page.ok) return page;
  const restored: PageMeta = { ...page.value, trashedAt: null };
  // a parent that is gone or still trashed sends the page to the top level
  if (restored.parentId !== null && isEffectivelyTrashed(state.pages, restored.parentId)) {
    restored.parentId = null;
  }
  const siblings = childrenOf(state.pages, restored.parentId).filter((sibling) => sibling.id !== id);
  return ok(withChanges(state, { pages: placeAmong(siblings, restored, undefined) }));
}

function insertPages(
  state: WorkspaceState,
  pages: PageMeta[],
  docs: Record<PageId, DocNode>,
): Result<Applied> {
  if (!Array.isArray(pages) || pages.length === 0) return fail('Nothing to insert.');
  const incoming = new Map<PageId, PageMeta>();
  for (const page of pages) {
    if (!ID_PATTERN.test(page.id)) return fail('Invalid page id in import.');
    if (state.pages[page.id] || incoming.has(page.id)) return fail(`Duplicate page id: ${page.id}`);
    incoming.set(page.id, { ...page, title: normalizeTitle(page.title) });
  }
  const combined = { ...state.pages, ...Object.fromEntries(incoming) };
  for (const page of incoming.values()) {
    if (page.parentId !== null && !combined[page.parentId])
      return fail('Imported page has a missing parent.');
    if (page.parentId !== null && isDescendantOf(combined, page.parentId, page.id)) {
      return fail('Imported pages contain a cycle.');
    }
  }
  const validDocs: Record<PageId, DocNode> = {};
  for (const id of incoming.keys()) {
    const doc = validateDoc(docs[id] ?? emptyDoc());
    if (!doc.ok) return fail(`Page ${id}: ${doc.error}`);
    validDocs[id] = doc.value;
  }
  return setDocs(withChanges(state, { pages: [...incoming.values()] }), validDocs);
}

function removePages(state: WorkspaceState, ids: PageId[]): Result<Applied> {
  if (ids.length === 0) return unchanged(state);
  const pages = { ...state.pages };
  const docs = { ...state.docs };
  const changes = emptyChanges();
  for (const id of ids) {
    delete pages[id];
    delete docs[id];
    changes.removed.add(id);
  }
  return ok({ state: { pages, docs }, changes });
}

// inserts the page at index and renumbers only the siblings that moved
function placeAmong(siblings: PageMeta[], page: PageMeta, index: number | undefined): PageMeta[] {
  const list = [...siblings];
  const at =
    index === undefined || !Number.isFinite(index) ? list.length : clamp(Math.floor(index), 0, list.length);
  list.splice(at, 0, page);
  const updated: PageMeta[] = [];
  list.forEach((item, position) => {
    if (item === page) updated.push({ ...page, order: position });
    else if (item.order !== position) updated.push({ ...item, order: position });
  });
  return updated;
}

function checkParent(state: WorkspaceState, parentId: PageId | null): Result<null> {
  if (parentId === null) return ok(null);
  if (!state.pages[parentId]) return fail('The parent page does not exist.');
  if (isEffectivelyTrashed(state.pages, parentId))
    return fail('Pages cannot be added inside a page in the trash.');
  return ok(null);
}

function requirePage(state: WorkspaceState, id: PageId): Result<PageMeta> {
  const page = typeof id === 'string' ? state.pages[id] : undefined;
  return page ? ok(page) : fail('That page no longer exists.');
}

function updatePage(state: WorkspaceState, page: PageMeta): Result<Applied> {
  return ok(withChanges(state, { pages: [page] }));
}

function unchanged(state: WorkspaceState): Result<Applied> {
  return ok({ state, changes: emptyChanges() });
}

function withChanges(state: WorkspaceState, update: { pages: PageMeta[] }): Applied {
  const pages = { ...state.pages };
  const changes = emptyChanges();
  for (const page of update.pages) {
    pages[page.id] = page;
    changes.pages.add(page.id);
  }
  return { state: { pages, docs: state.docs }, changes };
}

function setDocs(applied: Applied, docs: Record<PageId, DocNode>): Result<Applied> {
  const next = { ...applied.state.docs, ...docs };
  for (const id of Object.keys(docs)) applied.changes.docs.add(id);
  return ok({ state: { pages: applied.state.pages, docs: next }, changes: applied.changes });
}

export function normalizeTitle(title: unknown): string {
  if (typeof title !== 'string') return '';
  return title.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_TITLE_LENGTH);
}

function normalizeIcon(icon: unknown): Result<string | null> {
  if (icon === null || icon === undefined || icon === '') return ok(null);
  if (typeof icon !== 'string' || [...icon].length > MAX_ICON_LENGTH) return fail('Invalid page icon.');
  return ok(icon);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
