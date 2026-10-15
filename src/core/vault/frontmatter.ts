import { parse, stringify } from 'yaml';
import { isRecord } from '../doc';

export interface SplitFile {
  // null when the file has no frontmatter
  data: Record<string, unknown> | null;
  // the frontmatter block exactly as written, reused when its values did not change
  head: string;
  body: string;
  // set when frontmatter exists but is not valid yaml, the file is then left alone
  error: string | null;
}

const OPEN = /^---[ \t]*\r?\n/;
const CLOSE = /\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text: string): SplitFile {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const open = OPEN.exec(source);
  if (!open) return { data: null, head: '', body: source, error: null };
  // the leading newline lets an empty block close on the very next line
  const rest = `\n${source.slice(open[0].length)}`;
  const match = CLOSE.exec(rest);
  if (!match) return { data: null, head: '', body: source, error: null };
  const yaml = rest.slice(1, Math.max(1, match.index));
  const body = rest.slice(match.index + match[0].length);
  const head = source.slice(0, source.length - body.length);
  if (!yaml.trim()) return { data: {}, head, body, error: null };
  try {
    const data: unknown = parse(yaml, { maxAliasCount: 100, uniqueKeys: false });
    if (data === null || data === undefined) return { data: {}, head, body, error: null };
    if (!isRecord(data))
      return {
        data: null,
        head,
        body,
        error: 'The properties at the top of the file are not a list of keys.',
      };
    return { data, head, body, error: null };
  } catch (error) {
    return {
      data: null,
      head,
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
