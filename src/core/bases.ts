// obsidian bases: a view of the pages in a vault, filtered, sorted and laid out as a table or cards, written
// as yaml. morrow reads the same yaml in a ```base block, so a base written in obsidian shows here too.
// this covers the common part of the language: filters, formulas, sorting, limits and the usual functions
import { parse as parseYaml } from 'yaml';
import { displayTitle } from './model';
import type { DocNode, PageId, PageMeta, WorkspaceState } from './model';
import { linksInDoc } from './links';
import { tagMatches, tagsOf } from './tags';
import { isEffectivelyTrashed } from './tree';

export interface BaseContext {
  // the page's file in the vault, like Reading/Dune.md, null when it has none yet
  pathOf(id: PageId): string | null;
  now?: number;
}

export interface BaseColumn {
  id: string;
  label: string;
}

export interface BaseRow {
  pageId: PageId;
  values: Record<string, Value>;
}

export interface BaseView {
  name: string;
  type: 'table' | 'cards' | 'list';
  columns: BaseColumn[];
  rows: BaseRow[];
  error: string | null;
}

export type Value = string | number | boolean | null | Value[] | { date: number };

export class BaseError extends Error {}

// ---- reading the yaml

interface Definition {
  filters: unknown;
  formulas: Record<string, string>;
  displayNames: Record<string, string>;
  views: Array<{
    type: string;
    name: string;
    filters: unknown;
    order: string[];
    sort: Array<{ property: string; direction: 'ASC' | 'DESC' }>;
    limit: number | null;
  }>;
}

function readDefinition(source: string): Definition {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new BaseError(
      `The base is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const top = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const formulas: Record<string, string> = {};
  if (top.formulas && typeof top.formulas === 'object')
    for (const [name, expression] of Object.entries(top.formulas as Record<string, unknown>))
      if (typeof expression === 'string') formulas[name] = expression;
  const displayNames: Record<string, string> = {};
  if (top.properties && typeof top.properties === 'object')
    for (const [name, config] of Object.entries(top.properties as Record<string, unknown>)) {
      const label = (config as { displayName?: unknown } | null)?.displayName;
      if (typeof label === 'string') displayNames[name] = label;
    }
  const views = (Array.isArray(top.views) ? top.views : [{ type: 'table', name: 'Table' }]).map(
    (item, index) => {
      const view = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const sort = Array.isArray(view.sort)
        ? view.sort.flatMap((entry) => {
            const value = entry as { property?: unknown; direction?: unknown };
            return typeof value?.property === 'string'
              ? [
                  {
                    property: value.property,
                    direction: value.direction === 'DESC' ? ('DESC' as const) : ('ASC' as const),
                  },
                ]
              : [];
          })
        : [];
      return {
        type: typeof view.type === 'string' ? view.type : 'table',
        name: typeof view.name === 'string' ? view.name : `View ${index + 1}`,
        filters: view.filters ?? null,
        order: Array.isArray(view.order)
          ? view.order.filter((key): key is string => typeof key === 'string')
          : [],
        sort,
        limit: typeof view.limit === 'number' && view.limit > 0 ? Math.floor(view.limit) : null,
      };
    },
  );
  return { filters: top.filters ?? null, formulas, displayNames, views };
}

// ---- expressions

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      let value = '';
      i++;
      while (i < source.length && source[i] !== char) {
        if (source[i] === '\\' && i + 1 < source.length) i++;
        value += source[i];
        i++;
      }
      if (i >= source.length) throw new BaseError('A text in quotes is not closed.');
      i++;
      tokens.push({ kind: 'string', value });
      continue;
    }
    const number = /^\d+(\.\d+)?/.exec(source.slice(i));
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_À-￿][\wÀ-￿-]*/.exec(source.slice(i));
    if (name) {
      tokens.push({ kind: 'name', value: name[0] });
      i += name[0].length;
      continue;
    }
    const op = /^(==|!=|>=|<=|&&|\|\||[-+*/%<>!().,[\]])/.exec(source.slice(i));
    if (!op) throw new BaseError(`Morrow does not understand “${char}” in “${source}”.`);
    tokens.push({ kind: 'op', value: op[0] });
    i += op[0].length;
  }
  return tokens;
}

type Expr =
  | { type: 'literal'; value: Value }
  | { type: 'name'; name: string }
  | { type: 'member'; object: Expr; name: string }
  | { type: 'call'; callee: Expr; args: Expr[] }
  | { type: 'index'; object: Expr; index: Expr }
  | { type: 'unary'; op: string; value: Expr }
  | { type: 'binary'; op: string; left: Expr; right: Expr }
  | { type: 'list'; items: Expr[] };

const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

const parsed = new Map<string, Expr>();

export function parseExpression(source: string): Expr {
  const cached = parsed.get(source);
  if (cached) return cached;
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const isOp = (value: string) => peek()?.kind === 'op' && peek()!.value === value;
  const expect = (value: string) => {
    if (!isOp(value)) throw new BaseError(`Expected “${value}” in “${source}”.`);
    position++;
  };
  const primary = (): Expr => {
    const token = tokens[position++];
    if (!token) throw new BaseError(`“${source}” ends too soon.`);
    if (token.kind === 'number' || token.kind === 'string') return { type: 'literal', value: token.value };
    if (token.kind === 'name') {
      if (token.value === 'true' || token.value === 'false')
        return { type: 'literal', value: token.value === 'true' };
      if (token.value === 'null') return { type: 'literal', value: null };
      return { type: 'name', name: token.value };
    }
    if (token.value === '(') {
      const inner = expression(0);
      expect(')');
      return inner;
    }
    if (token.value === '[') {
      const items: Expr[] = [];
      while (!isOp(']')) {
        items.push(expression(0));
        if (!isOp(']')) expect(',');
      }
      position++;
      return { type: 'list', items };
    }
    if (token.value === '!' || token.value === '-')
      return { type: 'unary', op: token.value, value: postfix(primary()) };
    throw new BaseError(`Morrow did not expect “${token.value}” in “${source}”.`);
  };
  const postfix = (start: Expr): Expr => {
    let node = start;
    for (;;) {
      if (isOp('.')) {
        position++;
        const name = tokens[position++];
        if (name?.kind !== 'name') throw new BaseError(`A name should follow the dot in “${source}”.`);
        node = { type: 'member', object: node, name: name.value };
      } else if (isOp('(')) {
        position++;
        const args: Expr[] = [];
        while (!isOp(')')) {
          args.push(expression(0));
          if (!isOp(')')) expect(',');
        }
        position++;
        node = { type: 'call', callee: node, args };
      } else if (isOp('[')) {
        position++;
        const index = expression(0);
        expect(']');
        node = { type: 'index', object: node, index };
      } else return node;
    }
  };
  const expression = (minimum: number): Expr => {
    let left = postfix(primary());
    for (;;) {
      const token = peek();
      const op = token?.kind === 'op' ? token.value : null;
      const precedence = op ? PRECEDENCE[op] : undefined;
      if (!op || precedence === undefined || precedence < minimum) return left;
      position++;
      const right = expression(precedence + 1);
      left = { type: 'binary', op, left, right };
    }
  };
  const result = expression(0);
  if (position < tokens.length)
    throw new BaseError(`Morrow did not expect “${String(peek()!.value)}” in “${source}”.`);
  parsed.set(source, result);
  return result;
}

// ---- values

const DAY = 86_400_000;
const UNITS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  s: 1000,
  second: 1000,
  m: 60_000,
  minute: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  d: DAY,
  day: DAY,
  w: 7 * DAY,
  week: 7 * DAY,
  M: 30 * DAY,
  month: 30 * DAY,
  y: 365 * DAY,
  year: 365 * DAY,
};

// "1 week", "3d", "2 months"
function duration(text: string): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+?)s?\s*$/.exec(text);
  if (!match) return null;
  const unit = UNITS[match[2]!] ?? UNITS[match[2]!.toLowerCase()];
  return unit === undefined ? null : Number(match[1]) * unit;
}

function toDate(value: Value): number | null {
  if (value && typeof value === 'object' && 'date' in value) return value.date;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const time = Date.parse(value.length === 10 ? `${value}T00:00:00` : value);
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

const isDate = (value: Value): value is { date: number } =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'date' in value);

export function display(value: Value): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join(', ');
  if (isDate(value)) {
    const date = new Date(value.date);
    const pad = (n: number) => String(n).padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return date.getHours() || date.getMinutes()
      ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
      : day;
  }
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  return String(value);
}

function truthy(value: Value): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value) && value !== 0;
}

function compare(a: Value, b: Value): number {
  const da = toDate(a);
  const db = toDate(b);
  if (da !== null && db !== null) return da - db;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  const na = Number(a);
  const nb = Number(b);
  if (
    typeof a !== 'boolean' &&
    typeof b !== 'boolean' &&
    !Number.isNaN(na) &&
    !Number.isNaN(nb) &&
    display(a) !== '' &&
    display(b) !== ''
  )
    return na - nb;
  return display(a).localeCompare(display(b), undefined, { numeric: true, sensitivity: 'base' });
}

function equal(a: Value, b: Value): boolean {
  if (Array.isArray(a) && !Array.isArray(b)) return a.some((item) => equal(item, b));
  if ((a === null || a === '') && (b === null || b === '')) return true;
  if (a === null || b === null) return false;
  return compare(a, b) === 0;
}

function fromUnknown(value: unknown): Value {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return { date: value.getTime() };
  if (Array.isArray(value)) return value.map(fromUnknown);
  return JSON.stringify(value);
}

// ---- a page as bases sees it

class Note {
  private cachedTags: string[] | null = null;
  private cachedLinks: Set<PageId> | null = null;
  constructor(
    readonly page: PageMeta,
    readonly doc: DocNode | undefined,
    readonly path: string,
    readonly state: WorkspaceState,
  ) {}

  tags(): string[] {
    return (this.cachedTags ??= tagsOf(this.page, this.doc));
  }

  links(): Set<PageId> {
    return (this.cachedLinks ??= new Set(this.doc ? linksInDoc(this.doc).map((link) => link.targetId) : []));
  }

  property(name: string): Value {
    if (name in this.page.extra) return fromUnknown(this.page.extra[name]);
    if (name === 'tags') return this.tags();
    // a database row's values are kept by property id, the base names them
    const parent = this.page.parentId ? this.state.pages[this.page.parentId] : undefined;
    const property = parent?.database?.properties.find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );
    if (property) return fromUnknown(this.page.properties[property.id]);
    return null;
  }
}

interface Scope {
  note: Note;
  formulas: Record<string, string>;
  now: number;
  // formulas being worked out, so one that uses itself stops
  evaluating: Set<string>;
  findPage: (reference: string) => PageId | null;
}

function fileField(scope: Scope, name: string): Value {
  const { note } = scope;
  const path = note.path;
  const slash = path.lastIndexOf('/');
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = file.lastIndexOf('.');
  switch (name) {
    case 'name':
      return file || displayTitle(note.page);
    case 'basename':
      return dot > 0 ? file.slice(0, dot) : displayTitle(note.page);
    case 'path':
      return path;
    case 'folder':
      return slash >= 0 ? path.slice(0, slash) : '';
    case 'ext':
      return dot > 0 ? file.slice(dot + 1) : 'md';
    case 'ctime':
      return { date: note.page.createdAt };
    case 'mtime':
      return { date: note.page.updatedAt };
    case 'tags':
      return note.tags();
    case 'links':
      return [...note.links()].map((id) => displayTitle(scope.note.state.pages[id] ?? note.page));
    default:
      return null;
  }
}

type Callable = (args: Value[], scope: Scope) => Value;

const GLOBALS: Record<string, Callable> = {
  now: (_args, scope) => ({ date: scope.now }),
  today: (_args, scope) => {
    const day = new Date(scope.now);
    day.setHours(0, 0, 0, 0);
    return { date: day.getTime() };
  },
  date: ([value]) => {
    const time = toDate(value ?? null);
    return time === null ? null : { date: time };
  },
  if: ([condition, yes, no]) => (truthy(condition ?? null) ? (yes ?? null) : (no ?? null)),
  number: ([value]) => {
    const number = Number(display(value ?? null));
    return Number.isNaN(number) ? null : number;
  },
  min: (args) =>
    args.reduce<Value>((low, value) => (low === null || compare(value, low) < 0 ? value : low), null),
  max: (args) =>
    args.reduce<Value>((high, value) => (high === null || compare(value, high) > 0 ? value : high), null),
  list: (args) => args,
  link: ([value]) => value ?? null,
};

function fileMethod(scope: Scope, name: string, args: Value[]): Value {
  const { note } = scope;
  switch (name) {
    case 'hasTag':
      return args.some((wanted) =>
        note.tags().some((tag) => tagMatches(tag, display(wanted).replace(/^#/, ''))),
      );
    case 'inFolder': {
      const folder = display(args[0] ?? '').replace(/^\/+|\/+$/g, '');
      const own = fileField(scope, 'folder') as string;
      return folder === '' || own === folder || own.startsWith(`${folder}/`);
    }
    case 'hasLink': {
      const target = scope.findPage(display(args[0] ?? '').replace(/^\[\[|\]\]$/g, ''));
      return target !== null && note.links().has(target);
    }
    case 'hasProperty':
      return note.property(display(args[0] ?? '')) !== null;
    default:
      throw new BaseError(`Morrow does not know file.${name}() yet.`);
  }
}

function method(target: Value, name: string, args: Value[]): Value {
  const text = display(target);
  const arg = (index: number) => display(args[index] ?? '');
  switch (name) {
    case 'contains':
      return Array.isArray(target)
        ? target.some((item) => equal(item, args[0] ?? null))
        : text.toLowerCase().includes(arg(0).toLowerCase());
    case 'containsAny':
      return args.some((value) => method(target, 'contains', [value]) === true);
    case 'containsAll':
      return args.every((value) => method(target, 'contains', [value]) === true);
    case 'startsWith':
      return text.toLowerCase().startsWith(arg(0).toLowerCase());
    case 'endsWith':
      return text.toLowerCase().endsWith(arg(0).toLowerCase());
    case 'isEmpty':
      return target === null || text === '' || (Array.isArray(target) && target.length === 0);
    case 'isTruthy':
      return truthy(target);
    case 'lower':
      return text.toLowerCase();
    case 'upper':
      return text.toUpperCase();
    case 'title':
      return text.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
    case 'trim':
      return text.trim();
    case 'replace':
      return text.split(arg(0)).join(arg(1));
    case 'split':
      return text.split(arg(0));
    case 'slice':
      return Array.isArray(target)
        ? target.slice(Number(args[0] ?? 0), args[1] === undefined ? undefined : Number(args[1]))
        : text.slice(Number(args[0] ?? 0), args[1] === undefined ? undefined : Number(args[1]));
    case 'join':
      return Array.isArray(target) ? target.map(display).join(args.length ? arg(0) : ', ') : text;
    case 'round': {
      const places = Number(args[0] ?? 0);
      const factor = 10 ** places;
      return Math.round(Number(target) * factor) / factor;
    }
    case 'floor':
      return Math.floor(Number(target));
    case 'ceil':
      return Math.ceil(Number(target));
    case 'abs':
      return Math.abs(Number(target));
    case 'toFixed':
      return Number(target).toFixed(Number(args[0] ?? 0));
    case 'toString':
      return text;
    case 'format':
      return text;
    case 'date': {
      const time = toDate(target);
      if (time === null) return null;
      const day = new Date(time);
      day.setHours(0, 0, 0, 0);
      return { date: day.getTime() };
    }
    case 'year':
    case 'month':
    case 'day': {
      const time = toDate(target);
      if (time === null) return null;
      const date = new Date(time);
      return name === 'year' ? date.getFullYear() : name === 'month' ? date.getMonth() + 1 : date.getDate();
    }
    default:
      throw new BaseError(`Morrow does not know .${name}() yet.`);
  }
}

function field(target: Value, name: string): Value {
  if (name === 'length') return Array.isArray(target) ? target.length : display(target).length;
  const time = toDate(target);
  if (time !== null && (name === 'year' || name === 'month' || name === 'day'))
    return method(target, name, []);
  return null;
}

function arithmetic(op: string, left: Value, right: Value): Value {
  const leftDate = toDate(left);
  const rightDate = toDate(right);
  // dates move by durations, and two dates apart are a number of milliseconds
  if (leftDate !== null && (op === '+' || op === '-')) {
    if (rightDate !== null && op === '-' && isDate(right)) return leftDate - rightDate;
    const span = typeof right === 'number' ? right : duration(display(right));
    if (span !== null) return { date: op === '+' ? leftDate + span : leftDate - span };
  }
  if (
    op === '+' &&
    (typeof left === 'string' || typeof right === 'string') &&
    !(typeof left === 'number' && typeof right === 'number')
  )
    return display(left) + display(right);
  const a = Number(Array.isArray(left) ? NaN : left);
  const b = Number(Array.isArray(right) ? NaN : right);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? null : a / b;
    default:
      return b === 0 ? null : a % b;
  }
}

function evaluate(node: Expr, scope: Scope): Value {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'list':
      return node.items.map((item) => evaluate(item, scope));
    case 'name':
      if (node.name === 'file' || node.name === 'note' || node.name === 'formula' || node.name === 'this')
        return node.name;
      return scope.note.property(node.name);
    case 'member': {
      if (node.object.type === 'name') {
        if (node.object.name === 'file') return fileField(scope, node.name);
        if (node.object.name === 'note') return scope.note.property(node.name);
        if (node.object.name === 'formula') return formula(scope, node.name);
      }
      return field(evaluate(node.object, scope), node.name);
    }
    case 'index': {
      const target = evaluate(node.object, scope);
      const index = evaluate(node.index, scope);
      if (node.object.type === 'name' && node.object.name === 'note')
        return scope.note.property(display(index));
      return Array.isArray(target) ? (target[Number(index)] ?? null) : null;
    }
    case 'call': {
      const args = node.args.map((arg) => evaluate(arg, scope));
      if (node.callee.type === 'name') {
        const global = GLOBALS[node.callee.name];
        if (!global) throw new BaseError(`Morrow does not know ${node.callee.name}() yet.`);
        return global(args, scope);
      }
      if (node.callee.type === 'member') {
        if (node.callee.object.type === 'name' && node.callee.object.name === 'file')
          return fileMethod(scope, node.callee.name, args);
        return method(evaluate(node.callee.object, scope), node.callee.name, args);
      }
      throw new BaseError('That can not be called.');
    }
    case 'unary': {
      const value = evaluate(node.value, scope);
      return node.op === '!' ? !truthy(value) : arithmetic('-', 0, value);
    }
    case 'binary': {
      if (node.op === '&&') return truthy(evaluate(node.left, scope)) && truthy(evaluate(node.right, scope));
      if (node.op === '||') return truthy(evaluate(node.left, scope)) || truthy(evaluate(node.right, scope));
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      switch (node.op) {
        case '==':
          return equal(left, right);
        case '!=':
          return !equal(left, right);
        case '<':
          return left !== null && right !== null && compare(left, right) < 0;
        case '>':
          return left !== null && right !== null && compare(left, right) > 0;
        case '<=':
          return left !== null && right !== null && compare(left, right) <= 0;
        case '>=':
          return left !== null && right !== null && compare(left, right) >= 0;
        default:
          return arithmetic(node.op, left, right);
      }
    }
  }
}

function formula(scope: Scope, name: string): Value {
  const source = scope.formulas[name];
  if (source === undefined || scope.evaluating.has(name)) return null;
  scope.evaluating.add(name);
  try {
    return evaluate(parseExpression(source), scope);
  } finally {
    scope.evaluating.delete(name);
  }
}

// a filter is an expression, or and/or/not of a list of them
function passes(filter: unknown, scope: Scope): boolean {
  if (filter === null || filter === undefined) return true;
  if (typeof filter === 'string') return truthy(evaluate(parseExpression(filter), scope));
  if (Array.isArray(filter)) return filter.every((item) => passes(item, scope));
  if (typeof filter === 'object') {
    const group = filter as { and?: unknown; or?: unknown; not?: unknown };
    if (Array.isArray(group.and)) return group.and.every((item) => passes(item, scope));
    if (Array.isArray(group.or)) return group.or.some((item) => passes(item, scope));
    if (Array.isArray(group.not)) return !group.not.some((item) => passes(item, scope));
  }
  throw new BaseError('A filter should be an expression, or and, or or not with a list.');
}

function columnLabel(id: string, definition: Definition): string {
  if (definition.displayNames[id]) return definition.displayNames[id]!;
  if (id === 'file.name' || id === 'file.basename') return 'Name';
  const [prefix, ...rest] = id.split('.');
  const name = rest.length && ['file', 'note', 'formula'].includes(prefix!) ? rest.join('.') : id;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function valueOf(id: string, scope: Scope): Value {
  if (id === 'file.name') return fileField(scope, 'basename');
  return evaluate(
    parseExpression(id.includes('.') || /^[\w-]+$/.test(id) ? id : `note[${JSON.stringify(id)}]`),
    scope,
  );
}

// every view of a base, worked out over the pages of the vault
export function runBase(source: string, state: WorkspaceState, context: BaseContext): BaseView[] {
  const definition = readDefinition(source);
  const now = context.now ?? Date.now();
  const byTitle = new Map<string, PageId>();
  for (const page of Object.values(state.pages)) byTitle.set(displayTitle(page).toLowerCase(), page.id);
  const findPage = (reference: string) => byTitle.get(reference.toLowerCase()) ?? null;
  const notes = Object.values(state.pages)
    .filter(
      (page) => page.kind !== 'database' && !page.encrypted && !isEffectivelyTrashed(state.pages, page.id),
    )
    .map(
      (page) =>
        new Note(page, state.docs[page.id], context.pathOf(page.id) ?? `${displayTitle(page)}.md`, state),
    );
  return definition.views.map((view) => {
    const type = view.type === 'cards' || view.type === 'list' ? view.type : 'table';
    const order = view.order.length ? view.order : ['file.name'];
    const columns = order.map((id) => ({ id, label: columnLabel(id, definition) }));
    try {
      const rows: Array<BaseRow & { scope: Scope }> = [];
      for (const note of notes) {
        const scope: Scope = { note, formulas: definition.formulas, now, evaluating: new Set(), findPage };
        if (!passes(definition.filters, scope) || !passes(view.filters, scope)) continue;
        const values: Record<string, Value> = {};
        for (const column of columns) values[column.id] = valueOf(column.id, scope);
        rows.push({ pageId: note.page.id, values, scope });
      }
      if (view.sort.length)
        rows.sort((a, b) => {
          for (const { property, direction } of view.sort) {
            const difference = compare(valueOf(property, a.scope), valueOf(property, b.scope));
            if (difference !== 0) return direction === 'DESC' ? -difference : difference;
          }
          return 0;
        });
      const limited = view.limit ? rows.slice(0, view.limit) : rows;
      return {
        name: view.name,
        type,
        columns,
        rows: limited.map(({ pageId, values }) => ({ pageId, values })),
        error: null,
      };
    } catch (error) {
      return {
        name: view.name,
        type,
        columns,
        rows: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
