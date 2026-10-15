// databases are pages whose subpages are rows, each row keeps its values in its frontmatter
import { COLORS, displayTitle } from './model';
import type {
  ColorName,
  DatabaseDef,
  FilterOp,
  FilterRule,
  PageId,
  PageMeta,
  PropDef,
  PropType,
  PropValue,
  SelectOption,
  SortRule,
  ViewDef,
  ViewType,
  WorkspaceState,
} from './model';
import { childrenOf } from './tree';

// pseudo properties every row has
export const TITLE_PROP = 'title';
export const CREATED_PROP = 'created';
export const UPDATED_PROP = 'updated';

export const PROP_LABELS: Record<PropType, string> = {
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multiSelect: 'Multi-select',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'Link',
};

export const VIEW_LABELS: Record<ViewType, string> = {
  table: 'Table',
  board: 'Board',
  calendar: 'Calendar',
  list: 'List',
  gallery: 'Gallery',
};

export const FILTER_LABELS: Record<FilterOp, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  is: 'is',
  isNot: 'is not',
  empty: 'is empty',
  notEmpty: 'is not empty',
  gt: 'is greater than',
  lt: 'is less than',
  checked: 'is checked',
  unchecked: 'is not checked',
};

export function filterOpsFor(type: PropType | 'title'): FilterOp[] {
  switch (type) {
    case 'number':
    case 'date':
      return ['is', 'isNot', 'gt', 'lt', 'empty', 'notEmpty'];
    case 'checkbox':
      return ['checked', 'unchecked'];
    case 'select':
    case 'multiSelect':
      return ['is', 'isNot', 'empty', 'notEmpty'];
    default:
      return ['contains', 'notContains', 'is', 'isNot', 'empty', 'notEmpty'];
  }
}

export function newOption(name: string, index: number, newId: () => string): SelectOption {
  return { id: newId(), name, color: COLORS[index % COLORS.length]! };
}

export function newView(type: ViewType, database: DatabaseDef, newId: () => string): ViewDef {
  const select = database.properties.find((prop) => prop.type === 'select');
  const date = database.properties.find((prop) => prop.type === 'date');
  return {
    id: newId(),
    name: VIEW_LABELS[type],
    type,
    filters: [],
    sorts: [],
    groupBy: type === 'board' ? (select?.id ?? null) : null,
    dateProp: type === 'calendar' ? (date?.id ?? null) : null,
    hidden: [],
  };
}

export function defaultDatabase(newId: () => string): DatabaseDef {
  const status: PropDef = {
    id: newId(),
    name: 'Status',
    type: 'select',
    options: ['To do', 'Doing', 'Done'].map((name, index) => ({
      id: newId(),
      name,
      color: (['gray', 'blue', 'green'] as ColorName[])[index]!,
    })),
  };
  const date: PropDef = { id: newId(), name: 'Date', type: 'date', options: [] };
  const database: DatabaseDef = { properties: [status, date], views: [] };
  database.views = [
    newView('table', database, newId),
    newView('board', database, newId),
    newView('calendar', database, newId),
  ];
  return database;
}

export function rowsOf(state: WorkspaceState, databaseId: PageId): PageMeta[] {
  return childrenOf(state.pages, databaseId);
}

export function findDatabaseOf(state: WorkspaceState, page: PageMeta): PageMeta | null {
  const parent = page.parentId ? state.pages[page.parentId] : undefined;
  return parent?.kind === 'database' && parent.database ? parent : null;
}

export function valueOf(page: PageMeta, propId: string): PropValue {
  if (propId === TITLE_PROP) return displayTitle(page);
  if (propId === CREATED_PROP) return page.createdAt;
  if (propId === UPDATED_PROP) return page.updatedAt;
  return page.properties[propId] ?? null;
}

export function propType(database: DatabaseDef, propId: string): PropType | 'title' | null {
  if (propId === TITLE_PROP) return 'title';
  if (propId === CREATED_PROP || propId === UPDATED_PROP) return 'number';
  return database.properties.find((prop) => prop.id === propId)?.type ?? null;
}

// plain text for searching, sorting and exporting
export function formatValue(prop: PropDef | undefined, value: PropValue): string {
  if (value === null || value === undefined) return '';
  if (!prop) return Array.isArray(value) ? value.join(', ') : String(value);
  switch (prop.type) {
    case 'select':
      return prop.options.find((option) => option.id === value)?.name ?? '';
    case 'multiSelect':
      return (Array.isArray(value) ? value : [])
        .map((id) => prop.options.find((option) => option.id === id)?.name)
        .filter(Boolean)
        .join(', ');
    case 'checkbox':
      return value === true ? 'Yes' : 'No';
    default:
      return String(value);
  }
}

function isEmpty(value: PropValue): boolean {
  return value === null || value === '' || value === false || (Array.isArray(value) && value.length === 0);
}

function compareValues(a: PropValue, b: PropValue, prop: PropDef | undefined): number {
  if (isEmpty(a) && isEmpty(b)) return 0;
  // empty values sort last whichever way the column is sorted
  if (isEmpty(a)) return 1;
  if (isEmpty(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(b) - Number(a);
  if (prop?.type === 'select') {
    return (
      prop.options.findIndex((option) => option.id === a) -
      prop.options.findIndex((option) => option.id === b)
    );
  }
  return formatValue(prop, a).localeCompare(formatValue(prop, b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function matchesFilter(page: PageMeta, rule: FilterRule, database: DatabaseDef): boolean {
  const prop = database.properties.find((candidate) => candidate.id === rule.prop);
  const value = valueOf(page, rule.prop);
  const text = formatValue(prop, value).toLowerCase();
  const wanted = rule.value;
  switch (rule.op) {
    case 'empty':
      return isEmpty(value);
    case 'notEmpty':
      return !isEmpty(value);
    case 'checked':
      return value === true;
    case 'unchecked':
      return value !== true;
    case 'contains':
      return text.includes(String(wanted ?? '').toLowerCase());
    case 'notContains':
      return !text.includes(String(wanted ?? '').toLowerCase());
    case 'gt':
    case 'lt': {
      if (isEmpty(value) || wanted === null || wanted === '') return false;
      const order =
        typeof value === 'number' ? value - Number(wanted) : String(value).localeCompare(String(wanted));
      return rule.op === 'gt' ? order > 0 : order < 0;
    }
    case 'is':
    case 'isNot': {
      let same: boolean;
      if (wanted === null || wanted === '') same = isEmpty(value);
      else if (Array.isArray(value)) same = value.includes(String(wanted));
      else if (typeof value === 'number') same = value === Number(wanted);
      else if (prop?.type === 'select' || rule.prop === TITLE_PROP || prop?.type === 'date')
        same = String(value ?? '').toLowerCase() === String(wanted).toLowerCase();
      else same = text === String(wanted).toLowerCase();
      return rule.op === 'is' ? same : !same;
    }
    default:
      return true;
  }
}

export function sortRows(rows: PageMeta[], sorts: SortRule[], database: DatabaseDef): PageMeta[] {
  if (sorts.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const sort of sorts) {
      const prop = database.properties.find((candidate) => candidate.id === sort.prop);
      const va = valueOf(a, sort.prop);
      const vb = valueOf(b, sort.prop);
      let order = compareValues(va, vb, prop);
      if (sort.dir === 'desc' && !isEmpty(va) && !isEmpty(vb)) order = -order;
      if (order !== 0) return order;
    }
    return a.order - b.order;
  });
}

export function visibleRows(rows: PageMeta[], view: ViewDef, database: DatabaseDef): PageMeta[] {
  const filtered = rows.filter((row) => view.filters.every((rule) => matchesFilter(row, rule, database)));
  return sortRows(filtered, view.sorts, database);
}

export interface RowGroup {
  // the option id, or null for rows without a value
  key: string | null;
  label: string;
  color: ColorName;
  rows: PageMeta[];
}

// board columns: one per option in order, rows without a value come first
export function groupRows(rows: PageMeta[], propId: string | null, database: DatabaseDef): RowGroup[] {
  const prop = database.properties.find((candidate) => candidate.id === propId);
  if (!prop) return [{ key: null, label: 'All', color: 'gray', rows }];
  if (prop.type === 'checkbox') {
    return [
      {
        key: 'false',
        label: 'Not checked',
        color: 'gray',
        rows: rows.filter((row) => row.properties[prop.id] !== true),
      },
      {
        key: 'true',
        label: 'Checked',
        color: 'green',
        rows: rows.filter((row) => row.properties[prop.id] === true),
      },
    ];
  }
  const groups: RowGroup[] = [
    { key: null, label: `No ${prop.name.toLowerCase() || 'value'}`, color: 'gray', rows: [] },
    ...prop.options.map((option) => ({
      key: option.id,
      label: option.name,
      color: option.color,
      rows: [] as PageMeta[],
    })),
  ];
  for (const row of rows) {
    const value = row.properties[prop.id];
    const keys = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const matched = groups.filter((group) => group.key !== null && keys.includes(group.key));
    if (matched.length === 0) groups[0]!.rows.push(row);
    else for (const group of matched) group.rows.push(row);
  }
  return groups;
}

// keeps what still makes sense when a property changes type
export function convertValue(from: PropDef, to: PropDef, value: PropValue): PropValue {
  if (value === null || value === undefined) return null;
  const text = formatValue(from, value);
  switch (to.type) {
    case 'number': {
      const match = /-?\d+(?:\.\d+)?/.exec(text.replace(/,/g, ''));
      const number = typeof value === 'number' ? value : match ? Number(match[0]) : NaN;
      return Number.isFinite(number) ? number : null;
    }
    case 'checkbox':
      return value === true || /^(yes|true|x|1)$/i.test(text.trim());
    case 'date':
      return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
    case 'select': {
      const first = text.split(',')[0]!.trim().toLowerCase();
      return to.options.find((option) => option.name.toLowerCase() === first)?.id ?? null;
    }
    case 'multiSelect': {
      const names = text.split(',').map((name) => name.trim().toLowerCase());
      const ids = to.options
        .filter((option) => names.includes(option.name.toLowerCase()))
        .map((option) => option.id);
      return ids.length ? ids : null;
    }
    default:
      return text || null;
  }
}

// options a converted select needs, made from the values the rows already have
export function optionsFromValues(from: PropDef, values: PropValue[], newId: () => string): SelectOption[] {
  const names = new Map<string, string>();
  for (const value of values) {
    for (const part of formatValue(from, value).split(',')) {
      const name = part.trim();
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
  }
  return [...names.values()].slice(0, 200).map((name, index) => newOption(name, index, newId));
}

// picks the most fitting type for a column of text values, used when importing csv files
export function inferType(values: string[]): PropType {
  const filled = values.map((value) => value.trim()).filter(Boolean);
  if (filled.length === 0) return 'text';
  if (filled.every((value) => /^(yes|no|true|false)$/i.test(value))) return 'checkbox';
  if (filled.every((value) => /^-?\d+(\.\d+)?$/.test(value.replace(/,/g, '')))) return 'number';
  if (
    filled.every(
      (value) =>
        !Number.isNaN(Date.parse(value)) && /\d{4}|\d{1,2} \w+ \d{2,4}|\w+ \d{1,2}, \d{4}/.test(value),
    )
  )
    return 'date';
  if (filled.every((value) => /^https?:\/\/\S+$/i.test(value))) return 'url';
  const distinct = new Set(filled.map((value) => value.toLowerCase()));
  if (filled.some((value) => value.includes(', ')) && distinct.size < Math.max(4, filled.length)) {
    const parts = new Set(
      filled.flatMap((value) => value.split(',').map((part) => part.trim().toLowerCase())),
    );
    if (parts.size <= 30) return 'multiSelect';
  }
  // a few short values that repeat look like a status or a category
  if (
    distinct.size <= 12 &&
    distinct.size <= Math.max(2, filled.length * 0.75) &&
    filled.every((value) => value.length <= 40 && value.split(/\s+/).length <= 3)
  )
    return 'select';
  return 'text';
}

export function parseCellValue(prop: PropDef, raw: string): PropValue {
  const value = raw.trim();
  if (!value) return null;
  switch (prop.type) {
    case 'number': {
      const number = Number(value.replace(/,/g, ''));
      return Number.isFinite(number) ? number : null;
    }
    case 'checkbox':
      return /^(yes|true)$/i.test(value);
    case 'date': {
      const time = Date.parse(value);
      if (Number.isNaN(time)) return null;
      const date = new Date(time);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
    case 'select':
      return prop.options.find((option) => option.name.toLowerCase() === value.toLowerCase())?.id ?? null;
    case 'multiSelect': {
      const names = value.split(',').map((part) => part.trim().toLowerCase());
      const ids = prop.options
        .filter((option) => names.includes(option.name.toLowerCase()))
        .map((option) => option.id);
      return ids.length ? ids : null;
    }
    default:
      return value;
  }
}

// builds a database schema for csv columns, the first column is the row title
export function databaseFromTable(header: string[], rows: string[][], newId: () => string): DatabaseDef {
  // frontmatter keys are case sensitive, so Tags is a property while tags stays morrow's own
  const reserved = new Set(['title', 'icon', 'kind', 'tags', 'tag', 'database', 'aliases']);
  const used = new Set<string>();
  const properties: PropDef[] = [];
  header.slice(1).forEach((rawName, offset) => {
    const column = offset + 1;
    let name = rawName.trim() || `Column ${column + 1}`;
    for (let n = 2; used.has(name.toLowerCase()) || reserved.has(name); n++)
      name = `${rawName.trim() || 'Column'} ${n}`;
    used.add(name.toLowerCase());
    const values = rows.map((row) => row[column] ?? '');
    const type = inferType(values);
    const prop: PropDef = { id: newId(), name, type, options: [] };
    if (type === 'select' || type === 'multiSelect') {
      const names = new Map<string, string>();
      for (const value of values) {
        for (const part of type === 'multiSelect' ? value.split(',') : [value]) {
          const cleaned = part.trim();
          if (cleaned && !names.has(cleaned.toLowerCase())) names.set(cleaned.toLowerCase(), cleaned);
        }
      }
      prop.options = [...names.values()].map((optionName, index) => newOption(optionName, index, newId));
    }
    properties.push(prop);
  });
  const database: DatabaseDef = { properties, views: [] };
  database.views = [newView('table', database, newId)];
  if (properties.some((prop) => prop.type === 'select'))
    database.views.push(newView('board', database, newId));
  if (properties.some((prop) => prop.type === 'date'))
    database.views.push(newView('calendar', database, newId));
  return database;
}
