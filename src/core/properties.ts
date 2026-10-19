// pages keep their frontmatter when they join or leave a database: values become columns and back again
import { newView } from './database';
import type { DatabaseDef, PageId, PageMeta, PropDef, PropType, PropValue } from './model';
import { childrenOf } from './tree';
import { findKey } from './vault/frontmatter';
import { reservedPropertyName, takeProperties, writeProperty } from './vault/pageFile';

// obsidian's own settings for a note, never useful as a column
const NOT_COLUMNS = new Set(['aliases', 'cssclasses', 'cssclass', 'position']);
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const LINK = /^\[\[[^\]]+\]\]$/;

export interface RowFields {
  id: PageId;
  properties: Record<string, PropValue>;
  extra: Record<string, unknown>;
}

export interface Adoption {
  database: DatabaseDef;
  // only the rows whose values changed
  rows: RowFields[];
}

// the type a column should have for these frontmatter values, null when they are not plain values
export function inferFrontmatterType(values: unknown[]): PropType | null {
  const filled = values.filter((value) => value !== null && value !== undefined && value !== '');
  if (filled.length === 0) return 'text';
  if (filled.some((value) => typeof value === 'object' && !Array.isArray(value))) return null;
  if (filled.every((value) => typeof value === 'boolean')) return 'checkbox';
  if (filled.every((value) => typeof value === 'number')) return 'number';
  const items = filled.flatMap((value) => (Array.isArray(value) ? value : [value]));
  if (items.some((item) => typeof item === 'object' && item !== null)) return null;
  const texts = items.map((item) => String(item).trim()).filter(Boolean);
  if (texts.length && texts.every((text) => LINK.test(text))) return 'relation';
  if (filled.some(Array.isArray)) return 'multiSelect';
  if (texts.every((text) => DATE.test(text))) return 'date';
  if (texts.every((text) => /^https?:\/\/\S+$/i.test(text))) return 'url';
  // a few short values that repeat across pages look like a status or a category
  const distinct = new Set(texts.map((text) => text.toLowerCase()));
  if (
    texts.length >= 3 &&
    distinct.size < texts.length &&
    distinct.size <= Math.max(2, Math.min(12, texts.length * 0.75)) &&
    texts.every((text) => text.length <= 40 && text.split(/\s+/).length <= 3)
  )
    return 'select';
  return 'text';
}

// frontmatter keys of these rows that no property of the database holds yet, in the order they first appear
export function unclaimedKeys(database: DatabaseDef, rows: Array<Pick<PageMeta, 'extra'>>): string[] {
  const taken = new Set(database.properties.map((prop) => prop.name.toLowerCase()));
  const seen = new Map<string, string>();
  for (const row of rows)
    for (const key of Object.keys(row.extra)) {
      const lower = key.toLowerCase();
      if (taken.has(lower) || seen.has(lower) || NOT_COLUMNS.has(lower) || reservedPropertyName(key))
        continue;
      seen.set(lower, key);
    }
  return [...seen.values()].filter((key) => {
    const values = rows.map((row) => row.extra[findKey(row.extra, key) ?? key]);
    return inferFrontmatterType(values) !== null;
  });
}

// matches the rows' frontmatter to the database's properties, adding columns for the given keys first
export function adoptRows(
  database: DatabaseDef,
  rows: Array<Pick<PageMeta, 'id' | 'properties' | 'extra'>>,
  newId: () => string,
  addKeys: string[] = [],
): Adoption {
  const next = structuredClone(database);
  for (const key of addKeys) {
    if (next.properties.some((prop) => prop.name.toLowerCase() === key.toLowerCase())) continue;
    const values = rows.map((row) => row.extra[findKey(row.extra, key) ?? key]);
    const type = inferFrontmatterType(values);
    if (type === null) continue;
    const prop: PropDef = { id: newId(), name: key.slice(0, 200), type, options: [] };
    next.properties.push(prop);
  }
  const changed: RowFields[] = [];
  for (const row of rows) {
    const extra = { ...row.extra };
    const properties = { ...row.properties };
    takeProperties(next, extra, properties, newId);
    if (Object.keys(extra).length !== Object.keys(row.extra).length)
      changed.push({ id: row.id, properties, extra });
  }
  return { database: next, rows: changed };
}

// a row leaving its database keeps its values as frontmatter under the property names
export function releaseRow(
  page: Pick<PageMeta, 'properties' | 'extra'>,
  database: DatabaseDef,
): Record<string, unknown> {
  const extra = { ...page.extra };
  for (const prop of database.properties) {
    const value = writeProperty(prop, page.properties[prop.id]);
    if (value !== undefined && findKey(extra, prop.name) === undefined) extra[prop.name] = value;
  }
  return extra;
}

// what moving a page under a new parent does to its values, null when nothing about them changes
export function fieldsForMove(
  pages: Readonly<Record<PageId, PageMeta>>,
  id: PageId,
  parentId: PageId | null,
  newId: () => string,
): { fields: RowFields; database: { id: PageId; database: DatabaseDef } | null } | null {
  const page = pages[id];
  if (!page || page.parentId === parentId) return null;
  const from = page.parentId ? pages[page.parentId] : undefined;
  const to = parentId ? pages[parentId] : undefined;
  const fromDb = from?.kind === 'database' ? from.database : null;
  const toDb = to?.kind === 'database' ? to.database : null;
  if (!fromDb && !toDb) return null;
  const released = { id, properties: {}, extra: fromDb ? releaseRow(page, fromDb) : { ...page.extra } };
  if (!toDb) return { fields: released, database: null };
  const adopted = adoptRows(toDb, [released], newId, unclaimedKeys(toDb, [released]));
  return {
    fields: adopted.rows[0] ?? released,
    database:
      adopted.database.properties.length !== toDb.properties.length || adoptedOptions(toDb, adopted.database)
        ? { id: parentId!, database: adopted.database }
        : null,
  };
}

// the database a page with subpages becomes: a column for each frontmatter key they share, and fitting views
export function databaseFromSubpages(
  pages: Readonly<Record<PageId, PageMeta>>,
  id: PageId,
  newId: () => string,
  fallback: () => DatabaseDef,
): Adoption {
  const rows = childrenOf(pages, id);
  const empty: DatabaseDef = { properties: [], views: [] };
  const keys = unclaimedKeys(empty, rows);
  const adopted = keys.length ? adoptRows(empty, rows, newId, keys) : adoptRows(fallback(), rows, newId);
  const database = adopted.database;
  database.views = [newView('table', database, newId)];
  if (database.properties.some((prop) => prop.type === 'select'))
    database.views.push(newView('board', database, newId));
  if (database.properties.some((prop) => prop.type === 'date'))
    database.views.push(newView('calendar', database, newId));
  return { database, rows: adopted.rows };
}

function adoptedOptions(before: DatabaseDef, after: DatabaseDef): boolean {
  return after.properties.some((prop, i) => prop.options.length !== before.properties[i]?.options.length);
}
