// how one page maps to its markdown file: frontmatter for metadata, the body for content
import { dailyTitle, parseDateKey } from '../daily';
import { isRecord } from '../doc';
import { normalizeDatabase } from '../migrations';
import { COLORS, displayTitle, MAX_ICON_LENGTH, MAX_TITLE_LENGTH, validCover } from '../model';
import type { DatabaseDef, PageKind, PageMeta, PropDef, PropValue, SelectOption } from '../model';
import { joinFrontmatter, readTags, splitFrontmatter } from './frontmatter';

// frontmatter keys morrow reads and writes, every other key is kept exactly as it was
export const MANAGED_KEYS = new Set(['title', 'icon', 'kind', 'tags', 'tag', 'database', 'cover']);
const FILE_KINDS = new Set<PageKind>(['journal', 'templates', 'database']);
// a database property can not use a name morrow already gives a meaning to
export function reservedPropertyName(name: string): boolean {
  return MANAGED_KEYS.has(name.trim()) || name.trim() === 'aliases';
}

export interface PageSource {
  // frontmatter keys in the order the file had them
  keyOrder: string[];
  // frontmatter values morrow does not manage
  extra: Record<string, unknown>;
  // the frontmatter as it was read, and its exact text, reused when nothing in it changed
  rawData: Record<string, unknown> | null;
  rawHead: string;
  // the body as read from disk, kept while the page has not been edited in morrow
  body: string | null;
  // other names the page answers to in [[links]], from obsidian's aliases property
  aliases: string[];
}

export interface ReadPage {
  title: string | null;
  icon: string | null;
  cover: string | null;
  kind: PageKind | null;
  tags: string[];
  database: DatabaseDef | null;
  // every frontmatter value, property values are mapped once the parent database is known
  data: Record<string, unknown>;
  source: PageSource;
  body: string;
  error: string | null;
}

export function readPageText(text: string): ReadPage {
  const split = splitFrontmatter(text);
  const data = split.data ?? {};
  const title =
    typeof data.title === 'string' && data.title.trim()
      ? data.title.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_TITLE_LENGTH)
      : null;
  const icon =
    typeof data.icon === 'string' && data.icon && [...data.icon].length <= MAX_ICON_LENGTH ? data.icon : null;
  const kind = FILE_KINDS.has(data.kind as PageKind) ? (data.kind as PageKind) : null;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) if (!MANAGED_KEYS.has(key)) extra[key] = value;
  const aliases = (
    Array.isArray(data.aliases) ? data.aliases : typeof data.aliases === 'string' ? [data.aliases] : []
  )
    .filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0)
    .map((alias) => alias.trim());
  return {
    title,
    icon,
    cover: validCover(data.cover),
    kind,
    tags: readTags(data.tags ?? data.tag),
    database: kind === 'database' ? normalizeDatabase(data.database) : null,
    data,
    source: {
      keyOrder: Object.keys(data),
      extra,
      rawData: split.data,
      rawHead: split.head,
      body: split.body,
      aliases,
    },
    body: split.body,
    error: split.error,
  };
}

// the title a file implies on its own, so frontmatter only carries a title when it differs
export function impliedTitle(fileBase: string, dailyDate: string | null): string {
  const date = dailyDate ? parseDateKey(dailyDate) : null;
  return date ? dailyTitle(date) : fileBase;
}

export function managedFrontmatter(
  page: PageMeta,
  fileBase: string,
  parentDatabase: DatabaseDef | null,
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const title = displayTitle(page);
  if (title !== impliedTitle(fileBase, page.dailyDate)) out.set('title', title);
  if (page.icon && page.kind !== 'canvas') out.set('icon', page.icon);
  if (page.cover && page.kind !== 'canvas') out.set('cover', page.cover);
  if (FILE_KINDS.has(page.kind)) out.set('kind', page.kind);
  if (page.tags.length > 0) out.set('tags', [...page.tags]);
  for (const prop of parentDatabase?.properties ?? []) {
    const value = writeProperty(prop, page.properties[prop.id]);
    if (value !== undefined) out.set(prop.name, value);
  }
  if (page.kind === 'database' && page.database) out.set('database', databaseToYaml(page.database));
  return out;
}

// keeps the order and unknown keys of the existing frontmatter, adds new keys at the end
export function composeFrontmatter(
  managed: Map<string, unknown>,
  source: PageSource | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of source?.keyOrder ?? []) {
    if (managed.has(key)) out[key] = managed.get(key);
    else if (source && Object.hasOwn(source.extra, key)) out[key] = source.extra[key];
  }
  for (const [key, value] of managed) if (!Object.hasOwn(out, key)) out[key] = value;
  return out;
}

export function renderPageText(
  frontmatter: Record<string, unknown>,
  source: PageSource | null,
  body: string,
): string {
  if (source?.rawData && source.rawHead && sameValue(frontmatter, source.rawData))
    return source.rawHead + body;
  return joinFrontmatter(frontmatter, body);
}

export function writeProperty(prop: PropDef, value: PropValue | undefined): unknown {
  if (value === null || value === undefined || value === '') return undefined;
  switch (prop.type) {
    case 'number':
      return typeof value === 'number' ? value : undefined;
    case 'checkbox':
      return value === true ? true : undefined;
    case 'select': {
      const option = prop.options.find((candidate) => candidate.id === value);
      return option?.name;
    }
    case 'multiSelect': {
      const names = (Array.isArray(value) ? value : [])
        .map((id) => prop.options.find((option) => option.id === id)?.name)
        .filter((name): name is string => typeof name === 'string');
      return names.length > 0 ? names : undefined;
    }
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

// reads a frontmatter value as the property's type, adding select options it has not seen yet
export function readProperty(
  prop: PropDef,
  raw: unknown,
  newOptionId: () => string,
): { value: PropValue; added: SelectOption[] } {
  const added: SelectOption[] = [];
  const optionFor = (name: string): string => {
    const known = [...prop.options, ...added].find(
      (option) => option.name.toLowerCase() === name.toLowerCase(),
    );
    if (known) return known.id;
    const option: SelectOption = {
      id: newOptionId(),
      name: name.slice(0, 200),
      color: COLORS[(prop.options.length + added.length) % COLORS.length]!,
    };
    added.push(option);
    return option.id;
  };
  switch (prop.type) {
    case 'number': {
      const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
      return { value: Number.isFinite(value) && raw !== '' ? value : null, added };
    }
    case 'checkbox':
      return {
        value: raw === true || (typeof raw === 'string' && /^(true|yes|x)$/i.test(raw.trim())),
        added,
      };
    case 'select': {
      const name = scalarText(Array.isArray(raw) ? raw[0] : raw);
      return { value: name ? optionFor(name) : null, added };
    }
    case 'multiSelect': {
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
      const ids = list
        .map(scalarText)
        .filter((name): name is string => !!name)
        .map(optionFor);
      return { value: ids.length ? [...new Set(ids)] : null, added };
    }
    case 'date': {
      const text = raw instanceof Date ? raw.toISOString() : scalarText(raw);
      const match = text ? /^\d{4}-\d{2}-\d{2}/.exec(text) : null;
      return { value: match ? match[0] : null, added };
    }
    default: {
      const text = scalarText(raw);
      return { value: text || null, added };
    }
  }
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function databaseToYaml(database: DatabaseDef): Record<string, unknown> {
  return {
    properties: database.properties.map((prop) => ({
      id: prop.id,
      name: prop.name,
      type: prop.type,
      ...(prop.options.length ? { options: prop.options.map((option) => ({ ...option })) } : {}),
    })),
    views: database.views.map((view) => ({
      id: view.id,
      name: view.name,
      type: view.type,
      ...(view.filters.length ? { filters: view.filters.map((filter) => ({ ...filter })) } : {}),
      ...(view.sorts.length ? { sorts: view.sorts.map((sort) => ({ ...sort })) } : {}),
      ...(view.groupBy ? { groupBy: view.groupBy } : {}),
      ...(view.dateProp ? { dateProp: view.dateProp } : {}),
      ...(view.hidden.length ? { hidden: [...view.hidden] } : {}),
    })),
  };
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
    );
  }
  return false;
}
