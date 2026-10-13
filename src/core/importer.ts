import { markdownToPage } from './markdown/parse';
import { emptyDoc } from './model';
import type { DocNode, FileMeta, PageId, PageMeta, WorkspaceState } from './model';
import { pageIdByTitle } from './search';
import { childrenOf } from './tree';

export interface ArchiveEntry {
  path: string;
  data: Uint8Array;
}

export interface ArchivePlan {
  pages: PageMeta[];
  docs: Record<PageId, DocNode>;
  files: Array<{ meta: FileMeta; data: Uint8Array }>;
  problems: string[];
}

const MAX_TABLE_ROWS = 1000;
// notion appends a 32 character hex id to every exported name
const NOTION_ID = /\s+[0-9a-f]{32}$/i;
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function mimeType(name: string): string {
  return MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

// turns a notion export or any folder of markdown files into pages, keeping the folder tree
export function planArchiveImport(
  state: WorkspaceState,
  entries: ArchiveEntry[],
  parentId: PageId | null,
  newId: () => string,
  now: number,
): ArchivePlan {
  const decoder = new TextDecoder();
  const usable = entries
    .map((entry) => ({ ...entry, path: normalizePath(entry.path) }))
    .filter(
      (entry) =>
        entry.path && !entry.path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX'),
    );
  const root = commonWrapper(usable.map((entry) => entry.path));
  const files = usable
    .map((entry) => ({ ...entry, path: entry.path.slice(root.length) }))
    .filter((entry) => entry.path);

  const markdown = files.filter((entry) => /\.(md|markdown)$/i.test(entry.path));
  const tables = pickTables(files.filter((entry) => /\.csv$/i.test(entry.path)));
  const assets = new Map(
    files.filter((entry) => !/\.(md|markdown|csv)$/i.test(entry.path)).map((e) => [e.path, e]),
  );

  // every page is keyed by its path without the extension, which is also the folder holding its subpages
  const keys = new Map<string, { id: PageId; title: string }>();
  for (const entry of markdown)
    keys.set(stripExtension(entry.path), { id: newId(), title: cleanName(entry.path) });
  for (const entry of tables) {
    const key = stripExtension(entry.path).replace(/_all$/, '');
    if (!keys.has(key)) keys.set(key, { id: newId(), title: cleanName(key) });
  }
  const folders = new Map<string, { id: PageId; title: string }>();
  for (const key of [...keys.keys()]) {
    for (let dir = dirname(key); dir; dir = dirname(dir)) {
      if (keys.has(dir) || folders.has(dir)) continue;
      folders.set(dir, { id: newId(), title: cleanName(dir) });
    }
  }
  const pageAt = (key: string) => keys.get(key) ?? folders.get(key);

  const referenced = new Map<string, FileMeta>();
  const problems: string[] = [];
  const docs: Record<PageId, DocNode> = {};
  const titles = new Map<PageId, string>();

  for (const entry of markdown) {
    const key = stripExtension(entry.path);
    const page = keys.get(key)!;
    const base = dirname(entry.path);
    const parsed = markdownToPage(decoder.decode(entry.data), page.title, {
      resolvePage: (title) => findByTitle(keys, title) ?? pageIdByTitle(state, title),
      resolveLink: (href) => {
        const target = resolveHref(base, href);
        return target ? (keys.get(stripExtension(target))?.id ?? null) : null;
      },
      resolveFile: (href) => {
        const target = resolveHref(base, href);
        const asset = target ? assets.get(target) : undefined;
        if (!asset) return null;
        let meta = referenced.get(asset.path);
        if (!meta) {
          const name = asset.path.split('/').pop()!;
          meta = { id: newId(), name, type: mimeType(name), size: asset.data.byteLength, createdAt: now };
          referenced.set(asset.path, meta);
        }
        return { fileId: meta.id, name: meta.name, image: meta.type.startsWith('image/') };
      },
    });
    docs[page.id] = parsed.doc;
    titles.set(page.id, parsed.title.replace(NOTION_ID, '') || page.title);
  }

  for (const entry of tables) {
    const page = keys.get(stripExtension(entry.path).replace(/_all$/, ''))!;
    if (docs[page.id]) continue;
    const rows = parseCsv(decoder.decode(entry.data));
    if (rows.length > MAX_TABLE_ROWS + 1)
      problems.push(`Only the first ${MAX_TABLE_ROWS} rows of ${page.title} were imported.`);
    docs[page.id] = tableDoc(rows.slice(0, MAX_TABLE_ROWS + 1));
  }
  for (const folder of folders.values()) docs[folder.id] = emptyDoc();

  const all = [...keys.entries(), ...folders.entries()].sort(([a], [b]) => a.localeCompare(b));
  const counters = new Map<PageId | null, number>();
  const base = childrenOf(state.pages, parentId).length;
  const pages: PageMeta[] = all.map(([key, page]) => {
    const parent = pageAt(dirname(key))?.id ?? parentId;
    const order = counters.get(parent) ?? (parent === parentId ? base : 0);
    counters.set(parent, order + 1);
    return {
      id: page.id,
      parentId: parent,
      title: titles.get(page.id) ?? page.title,
      icon: null,
      kind: 'page',
      order,
      createdAt: now,
      updatedAt: now,
      trashedAt: null,
      favorite: false,
      dailyDate: null,
      lastOpenedAt: null,
    };
  });

  return {
    pages,
    docs,
    files: [...referenced.entries()].map(([path, meta]) => ({ meta, data: assets.get(path)!.data })),
    problems,
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
}

// a single folder wrapping everything, like notion's export folder, is not a page
function commonWrapper(paths: string[]): string {
  let prefix = '';
  for (;;) {
    const first = paths[0]?.slice(prefix.length).split('/')[0];
    if (!first || paths.some((path) => !path.startsWith(`${prefix}${first}/`))) return prefix;
    if (paths.some((path) => path === `${prefix}${first}.md` || path === `${prefix}${first}.csv`))
      return prefix;
    prefix = `${prefix}${first}/`;
  }
}

function pickTables(entries: ArchiveEntry[]): ArchiveEntry[] {
  const byKey = new Map<string, ArchiveEntry>();
  for (const entry of entries) {
    const key = stripExtension(entry.path).replace(/_all$/, '');
    const current = byKey.get(key);
    // notion writes both name.csv and name_all.csv, the second has every row
    if (!current || /_all\.csv$/i.test(entry.path)) byKey.set(key, entry);
  }
  return [...byKey.values()];
}

function stripExtension(path: string): string {
  return path.replace(/\.(md|markdown|csv)$/i, '');
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function cleanName(path: string): string {
  const name = stripExtension(path.split('/').pop() ?? '').replace(/_all$/, '');
  return name.replace(NOTION_ID, '').trim() || 'Untitled';
}

function findByTitle(keys: Map<string, { id: PageId; title: string }>, title: string): PageId | null {
  const folded = title.trim().toLowerCase();
  for (const page of keys.values()) if (page.title.toLowerCase() === folded) return page.id;
  return null;
}

// resolves a relative href against the folder of the file that contains it
function resolveHref(base: string, href: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return null;
  let decoded = href.split(/[?#]/)[0]!;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep the raw text when it is not valid percent encoding
  }
  const parts = (base ? `${base}/${decoded}` : decoded).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

function tableDoc(rows: string[][]): DocNode {
  if (rows.length === 0) return emptyDoc();
  const width = Math.max(...rows.map((row) => row.length));
  const cell = (type: string, text: string): DocNode => ({
    type,
    content: [
      { type: 'paragraph', ...(text.trim() ? { content: [{ type: 'text', text: text.trim() }] } : {}) },
    ],
  });
  const row = (cells: string[], type: string): DocNode => ({
    type: 'tableRow',
    content: Array.from({ length: width }, (_, i) => cell(type, cells[i] ?? '')),
  });
  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [row(rows[0]!, 'tableHeader'), ...rows.slice(1).map((r) => row(r, 'tableCell'))],
      },
    ],
  };
}
