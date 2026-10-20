import { parse, parseDocument, stringify } from 'yaml';
import { isRecord } from '../doc';

// frontmatter keys morrow reads and writes, every other key is kept exactly as it was
export const MANAGED_KEYS = new Set(['title', 'icon', 'kind', 'tags', 'tag', 'database', 'cover']);
const MAX_KEY_LENGTH = 200;
const MAX_EXTRA_KEYS = 200;

// the frontmatter key matching a property name, its exact spelling first, then ignoring case like obsidian
export function findKey(data: Record<string, unknown>, name: string): string | undefined {
  if (Object.hasOwn(data, name)) return name;
  const lower = name.toLowerCase();
  return Object.keys(data).find((key) => key.toLowerCase() === lower);
}

// keeps only plain values under usable keys, so a hostile backup or command can not put anything odd in a file
export function normalizeExtra(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_EXTRA_KEYS) break;
    const clean = key.trim();
    if (!clean || clean !== key || key.length > MAX_KEY_LENGTH || MANAGED_KEYS.has(key)) continue;
    const plain = plainValue(value, 0);
    if (plain !== undefined) out[key] = plain;
  }
  return out;
}

function plainValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (depth >= 8) return undefined;
  if (Array.isArray(value))
    return value.slice(0, 1000).flatMap((item) => {
      const plain = plainValue(item, depth + 1);
      return plain === undefined ? [] : [plain];
    });
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const plain = plainValue(item, depth + 1);
      if (plain !== undefined) out[key] = plain;
    }
    return out;
  }
  return undefined;
}

// the frontmatter most notes have, keys with plain values and simple lists, read without the full yaml
// parser, which is most of the time spent opening a big vault. anything else, or anything this can't
// be sure reads the same as yaml would, returns null and goes to the real parser
const SIMPLE_KEY = /^([A-Za-z_][\w -]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const SIMPLE_ITEM = /^([ \t]*)-[ \t]+(.*?)[ \t]*$/;
// a plain scalar with no character yaml gives a meaning to
const PLAIN = /^[A-Za-z0-9_+-][\w ./+,-]*$/;
const INT = /^[-+]?[0-9]+$/;
const FLOAT = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const UNSURE = undefined;

function plainScalar(text: string, inList: boolean): unknown {
  if (text === '' || text === '~' || /^(?:null|Null|NULL)$/.test(text)) return null;
  if (/^(?:true|True|TRUE)$/.test(text)) return true;
  if (/^(?:false|False|FALSE)$/.test(text)) return false;
  if (!PLAIN.test(text) || (inList && text.includes(',')) || /^-[ \t]/.test(text)) return UNSURE;
  // hex and octal numbers
  if (/^[-+]?0[xXoO]/.test(text)) return UNSURE;
  if (INT.test(text) || FLOAT.test(text)) return Number(text);
  return text;
}

export function parseSimple(yaml: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  // the key a block list can still follow, and the indent its items use
  let open: { key: string; indent: string | null } | null = null;
  for (const line of yaml.split('\n')) {
    if (!line.trim()) continue;
    const item = open ? SIMPLE_ITEM.exec(line) : null;
    if (open && item) {
      if (open.indent !== null && item[1] !== open.indent) return null;
      open.indent = item[1]!;
      const value = plainScalar(item[2]!, false);
      if (value === UNSURE || value === null) return null;
      const list = out[open.key];
      if (Array.isArray(list)) list.push(value);
      else out[open.key] = [value];
      continue;
    }
    open = null;
    if (line.startsWith(' ') || line.startsWith('\t')) return null;
    const pair = SIMPLE_KEY.exec(line);
    if (!pair) return null;
    const key = pair[1]!;
    if (Object.hasOwn(out, key)) return null;
    const raw = pair[2] ?? '';
    if (raw === '') {
      // a key alone is null, unless a list follows on the next lines
      out[key] = null;
      open = { key, indent: null };
      continue;
    }
    const flow = /^\[(.*)\]$/.exec(raw);
    if (flow) {
      const inner = flow[1]!.trim();
      const items = inner ? inner.split(',').map((part) => plainScalar(part.trim(), true)) : [];
      if (items.some((value) => value === UNSURE || value === null)) return null;
      out[key] = items;
      continue;
    }
    const value = plainScalar(raw, false);
    if (value === UNSURE) return null;
    out[key] = value;
  }
  return out;
}

export interface SplitFile {
  // null when the file has no frontmatter
  data: Record<string, unknown> | null;
  // the frontmatter block exactly as written, reused when its values did not change
  head: string;
  // the yaml inside it
  yaml: string;
  body: string;
  // set when frontmatter exists but is not valid yaml, the file is then left alone
  error: string | null;
}

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text: string): SplitFile {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const open = OPEN.exec(source);
  if (!open) return { data: null, head: '', yaml: '', body: source, error: null };
  // the leading newline lets an empty block close on the very next line
  const rest = `\n${source.slice(open[0].length)}`;
  const match = CLOSE.exec(rest);
  if (!match) return { data: null, head: '', yaml: '', body: source, error: null };
  const yaml = rest.slice(1, Math.max(1, match.index));
  const body = rest.slice(match.index + match[0].length);
  const head = source.slice(0, source.length - body.length);
  if (!yaml.trim()) return { data: {}, head, yaml, body, error: null };
  try {
    const data: unknown = parseSimple(yaml) ?? parse(yaml, { maxAliasCount: 100, uniqueKeys: false });
    if (data === null || data === undefined) return { data: {}, head, yaml, body, error: null };
    if (!isRecord(data))
      return {
        data: null,
        head,
        yaml,
        body,
        error: 'The properties at the top of the file are not a list of keys.',
      };
    return { data, head, yaml, body, error: null };
  } catch (error) {
    return {
      data: null,
      head,
      yaml,
      body,
      error: `The properties at the top of the file could not be read: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    };
  }
}

// the body is kept byte for byte, so a file only changes where its properties changed
export function joinFrontmatter(data: Record<string, unknown> | null, body: string): string {
  if (!data || Object.keys(data).length === 0) return body;
  const yaml = stringify(data, { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' });
  return `---\n${yaml}---\n${body}`;
}

// changes only the keys whose values changed, so every other line keeps its exact formatting and comments.
// null when the yaml can not be edited that way, then the whole block is written again
export function updateFrontmatter(
  yaml: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  body: string,
): string | null {
  if (Object.keys(after).length === 0) return body;
  const order = Object.keys(after);
  const kept = Object.keys(before).filter((key) => Object.hasOwn(after, key));
  // a key that moved, such as one renamed into another's place, is easier to get right by writing it all
  if (kept.some((key, index) => order[index] !== key)) return null;
  try {
    const document = parseDocument(yaml, { uniqueKeys: false });
    if (document.errors.length > 0 || !document.contents) return null;
    for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) document.delete(key);
    for (const [key, value] of Object.entries(after)) {
      if (Object.hasOwn(before, key) && same(before[key], value)) continue;
      // a changed value keeps its quoting, except an empty one, whose quotes only meant empty
      const blank = before[key] === '' || before[key] === null;
      document.set(key, blank ? document.createNode(value) : value);
    }
    const text = document.toString({
      lineWidth: 0,
      defaultStringType: 'PLAIN',
      defaultKeyType: 'PLAIN',
      flowCollectionPadding: false,
    });
    return `---\n${text}${text.endsWith('\n') ? '' : '\n'}---\n${body}`;
  } catch {
    return null;
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// tags may be a list, a single string or a comma separated string, with or without the leading #
export function readTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [];
  const tags = raw
    .filter((tag): tag is string | number => typeof tag === 'string' || typeof tag === 'number')
    .map((tag) => normalizeTag(String(tag)))
    .filter((tag): tag is string => tag !== null);
  return [...new Set(tags)];
}

const TAG = /^[\p{L}\p{N}_\-/]+$/u;

export function normalizeTag(tag: string): string | null {
  const cleaned = tag.trim().replace(/^#/, '');
  if (!cleaned || cleaned.length > 100 || !TAG.test(cleaned) || /^\d+$/.test(cleaned)) return null;
  return cleaned;
}
