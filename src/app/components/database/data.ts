import type { Command } from '../../../core/commands';
import { newOption, rowsOf } from '../../../core/database';
import type { DatabaseDef, PageId, PropDef, PropValue, SelectOption, ViewDef } from '../../../core/model';
import { adoptRows } from '../../../core/properties';
import { newId } from '../../platform/files';
import { getState, run, runAll } from '../../workspace';

export function databaseOf(id: PageId): DatabaseDef | null {
  return getState().pages[id]?.database ?? null;
}

// every change to a database's properties and views goes through here as one step. rows whose frontmatter
// has a key named like a property, such as one just added, get that value in it
export function updateDatabase(
  id: PageId,
  change: (database: DatabaseDef) => DatabaseDef,
  addKeys: string[] = [],
): boolean {
  const current = databaseOf(id);
  if (!current) return false;
  const adopted = adoptRows(change(current), rowsOf(getState(), id), newId, addKeys);
  const now = Date.now();
  return runAll([
    { type: 'database.set', id, database: adopted.database, now },
    ...adopted.rows.map((row): Command => ({
      type: 'page.setFields',
      id: row.id,
      properties: row.properties,
      extra: row.extra,
      now,
    })),
  ]).ok;
}

// turns frontmatter keys the rows already have into columns, with a type that fits their values
export function addColumnsFromPages(id: PageId, keys: string[]): boolean {
  return updateDatabase(id, (database) => database, keys);
}

export function updateProp(dbId: PageId, propId: string, change: (prop: PropDef) => PropDef): void {
  updateDatabase(dbId, (database) => ({
    ...database,
    properties: database.properties.map((prop) => (prop.id === propId ? change(prop) : prop)),
  }));
}

export function updateView(dbId: PageId, viewId: string, change: (view: ViewDef) => ViewDef): void {
  updateDatabase(dbId, (database) => ({
    ...database,
    views: database.views.map((view) => (view.id === viewId ? change(view) : view)),
  }));
}

export function setValue(rowId: PageId, propId: string, value: PropValue): void {
  run({ type: 'page.setProperties', id: rowId, values: { [propId]: value }, now: Date.now() });
}

// adds an option to a select property and returns it, or the existing one with that name
export function ensureOption(dbId: PageId, propId: string, name: string): SelectOption | null {
  const prop = databaseOf(dbId)?.properties.find((candidate) => candidate.id === propId);
  const clean = name.trim();
  if (!prop || !clean) return null;
  const existing = prop.options.find((option) => option.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const option = newOption(clean, prop.options.length, newId);
  updateProp(dbId, propId, (current) => ({ ...current, options: [...current.options, option] }));
  return option;
}

export function createRow(dbId: PageId, values: Record<string, PropValue> = {}, title = ''): PageId | null {
  const id = newId();
  const result = run({ type: 'page.create', id, parentId: dbId, now: Date.now(), title, properties: values });
  return result.ok ? id : null;
}
