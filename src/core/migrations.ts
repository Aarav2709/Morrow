import { isRecord, validateDoc } from './doc';
import { MAX_ICON_LENGTH, MAX_TITLE_LENGTH, SCHEMA_VERSION } from './model';
import type { DocNode, PageId, PageMeta } from './model';
import { fail, ok } from './result';
import type { Result } from './result';

export interface RawWorkspace {
  pages: unknown[];
  docs: Record<string, unknown>;
}

export interface LoadedWorkspace {
  pages: PageMeta[];
  docs: Record<PageId, DocNode>;
  // records that could not be read, reported to the user and left untouched in storage
  problems: string[];
  // pages whose stored content failed validation, opened read only so nothing overwrites it
  unreadable: PageId[];
}

// each entry upgrades data from version n to n + 1
const MIGRATIONS: Record<number, (data: RawWorkspace) => RawWorkspace> = {};

export function migrate(version: number, data: RawWorkspace): Result<RawWorkspace> {
  if (!Number.isInteger(version) || version < 1) return fail('The data has an unknown format version.');
  if (version > SCHEMA_VERSION) {
    return fail(
      `This data was written by a newer version of Morrow (format ${version}). Please update Morrow.`,
    );
  }
  let current = data;
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return fail(`No migration from format ${v}.`);
    current = step(current);
  }
  return ok(current);
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// fills safe defaults for missing optional fields, rejects records without a usable id
export function normalizePage(raw: unknown): PageMeta | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return null;
  const num = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const updatedAt = num(raw.updatedAt, num(raw.createdAt, 0));
  const icon =
    typeof raw.icon === 'string' && raw.icon && [...raw.icon].length <= MAX_ICON_LENGTH ? raw.icon : null;
  return {
    id: raw.id,
    parentId:
      typeof raw.parentId === 'string' && ID_PATTERN.test(raw.parentId) && raw.parentId !== raw.id
        ? raw.parentId
        : null,
    title:
      typeof raw.title === 'string' ? raw.title.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_TITLE_LENGTH) : '',
    icon,
    kind: raw.kind === 'journal' ? 'journal' : 'page',
    order: num(raw.order, 0),
    createdAt: num(raw.createdAt, updatedAt),
    updatedAt,
    trashedAt: typeof raw.trashedAt === 'number' && Number.isFinite(raw.trashedAt) ? raw.trashedAt : null,
    favorite: raw.favorite === true,
    dailyDate:
      typeof raw.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dailyDate) ? raw.dailyDate : null,
    lastOpenedAt:
      typeof raw.lastOpenedAt === 'number' && Number.isFinite(raw.lastOpenedAt) ? raw.lastOpenedAt : null,
  };
}

// validates every record independently so one bad record never blocks the rest
export function readWorkspace(version: number, raw: RawWorkspace): Result<LoadedWorkspace> {
  const migrated = migrate(version, raw);
  if (!migrated.ok) return migrated;
  const problems: string[] = [];
  const pages: PageMeta[] = [];
  const docs: Record<PageId, DocNode> = {};
  const unreadable: PageId[] = [];
  const seen = new Set<PageId>();
  for (const record of migrated.value.pages) {
    const page = normalizePage(record);
    if (!page) {
      problems.push('A page record could not be read and was skipped.');
      continue;
    }
    if (seen.has(page.id)) continue;
    seen.add(page.id);
    pages.push(page);
    const doc = migrated.value.docs[page.id];
    if (doc === undefined) continue;
    const valid = validateDoc(doc);
    if (valid.ok) docs[page.id] = valid.value;
    else {
      unreadable.push(page.id);
      problems.push(`The content of "${page.title || 'Untitled'}" could not be read: ${valid.error}`);
    }
  }
  return ok({ pages, docs, problems, unreadable });
}
