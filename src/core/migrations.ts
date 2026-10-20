import { isRecord, validateDoc } from './doc';
import { normalizeExtra } from './vault/frontmatter';
import {
  COLORS,
  MAX_ICON_LENGTH,
  MAX_TITLE_LENGTH,
  PAGE_KINDS,
  PROP_TYPES,
  SCHEMA_VERSION,
  validCover,
  VIEW_TYPES,
} from './model';
import type {
  ColorName,
  DatabaseDef,
  DocNode,
  FilterOp,
  PageId,
  PageKind,
  PageMeta,
  PropDef,
  PropType,
  PropValue,
  ViewDef,
  ViewType,
} from './model';
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
const MIGRATIONS: Record<number, (data: RawWorkspace) => RawWorkspace> = {
  // version 2 added stored files and page history, pages and documents kept their shape
  1: (data) => data,
  // version 3 added tags, database properties and new page kinds, normalizePage fills their defaults
  2: (data) => data,
};

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
    kind: PAGE_KINDS.includes(raw.kind as PageKind) ? (raw.kind as PageKind) : 'page',
    order: num(raw.order, 0),
    createdAt: num(raw.createdAt, updatedAt),
    updatedAt,
    trashedAt: typeof raw.trashedAt === 'number' && Number.isFinite(raw.trashedAt) ? raw.trashedAt : null,
    favorite: raw.favorite === true,
    dailyDate:
      typeof raw.dailyDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dailyDate) ? raw.dailyDate : null,
    lastOpenedAt:
      typeof raw.lastOpenedAt === 'number' && Number.isFinite(raw.lastOpenedAt) ? raw.lastOpenedAt : null,
    tags: Array.isArray(raw.tags)
      ? [...new Set(raw.tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0))]
      : [],
    properties: normalizeProperties(raw.properties),
    extra: normalizeExtra(raw.extra),
    database: normalizeDatabase(raw.database),
    cover: validCover(raw.cover),
    encrypted: raw.encrypted === true,
  };
}

const MAX_NAME_LENGTH = 200;
const FILTER_OPS = new Set<FilterOp>([
  'contains',
  'notContains',
  'is',
  'isNot',
  'empty',
  'notEmpty',
  'gt',
  'lt',
  'checked',
  'unchecked',
]);

const nameOf = (value: unknown, fallback: string) =>
  typeof value === 'string' ? value.slice(0, MAX_NAME_LENGTH) : fallback;
const validId = (value: unknown): value is string => typeof value === 'string' && ID_PATTERN.test(value);
const records = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);

function normalizeValue(value: unknown): PropValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value as string[];
  return undefined;
}

function normalizeProperties(raw: unknown): Record<string, PropValue> {
  if (!isRecord(raw)) return {};
  const result: Record<string, PropValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalized = normalizeValue(value);
    if (ID_PATTERN.test(key) && normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function normalizeProp(raw: Record<string, unknown>): PropDef | null {
  if (!validId(raw.id) || !PROP_TYPES.includes(raw.type as PropType)) return null;
  return {
    id: raw.id,
    name: nameOf(raw.name, ''),
    type: raw.type as PropType,
    options: records(raw.options)
      .filter((option) => validId(option.id))
      .map((option) => ({
        id: option.id as string,
        name: nameOf(option.name, ''),
        color: COLORS.includes(option.color as ColorName) ? (option.color as ColorName) : 'gray',
      })),
    ...(raw.type === 'formula' && typeof raw.formula === 'string'
      ? { formula: raw.formula.slice(0, 2000) }
      : {}),
    ...(raw.display === 'bar' ? { display: 'bar' as const } : {}),
    ...(typeof raw.max === 'number' && Number.isFinite(raw.max) && raw.max > 0 ? { max: raw.max } : {}),
  };
}

function normalizeView(raw: Record<string, unknown>): ViewDef | null {
  if (!validId(raw.id) || !VIEW_TYPES.includes(raw.type as ViewType)) return null;
  const propRef = (value: unknown) => (typeof value === 'string' && value.length <= 64 ? value : null);
  return {
    id: raw.id,
    name: nameOf(raw.name, ''),
    type: raw.type as ViewType,
    filters: records(raw.filters).flatMap((filter) => {
      const prop = propRef(filter.prop);
      const value = normalizeValue(filter.value);
      if (!validId(filter.id) || !prop || !FILTER_OPS.has(filter.op as FilterOp) || value === undefined)
        return [];
      return [{ id: filter.id, prop, op: filter.op as FilterOp, value }];
    }),
    sorts: records(raw.sorts).flatMap((sort) => {
      const prop = propRef(sort.prop);
      return prop ? [{ prop, dir: sort.dir === 'desc' ? ('desc' as const) : ('asc' as const) }] : [];
    }),
    groupBy: propRef(raw.groupBy),
    dateProp: propRef(raw.dateProp),
    hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((id): id is string => propRef(id) !== null) : [],
    ...(isRecord(raw.widths) ? { widths: normalizeWidths(raw.widths) } : {}),
  };
}

export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 1200;

function normalizeWidths(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw).slice(0, 200)) {
    if (key.length > 64 || typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[key] = Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, value)));
  }
  return out;
}

export function normalizeDatabase(raw: unknown): DatabaseDef | null {
  if (!isRecord(raw)) return null;
  return {
    properties: records(raw.properties).flatMap((prop) => normalizeProp(prop) ?? []),
    views: records(raw.views).flatMap((view) => normalizeView(view) ?? []),
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
