import { newOption } from '../../../core/database';
import type { DatabaseDef, PageId, PropDef, PropValue, SelectOption, ViewDef } from '../../../core/model';
import { newId } from '../../platform/files';
import { getState, run } from '../../workspace';

export function databaseOf(id: PageId): DatabaseDef | null {
  return getState().pages[id]?.database ?? null;
}

// every change to a database's properties and views goes through here as one command
export function updateDatabase(id: PageId, change: (database: DatabaseDef) => DatabaseDef): boolean {
  const current = databaseOf(id);
  if (!current) return false;
  return run({ type: 'database.set', id, database: change(current), now: Date.now() }).ok;
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
