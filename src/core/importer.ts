import { databaseFromTable, parseCellValue } from './database';
import { inlineText } from './doc';
import { markdownToDoc } from './markdown/parse';
import type { ParseOptions } from './markdown/parse';
import { emptyDoc, newPageMeta } from './model';
import { readPageText, takeProperties } from './vault/pageFile';
import type { DocNode, FileMeta, PageId, PageMeta, PropValue, WorkspaceState } from './model';
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

export interface ImportedFile {
  title: string;
  doc: DocNode;
  fields: Partial<PageMeta>;
}

// an imported note's frontmatter becomes its title, icon, tags and properties rather than text on the page
export function readImportedFile(text: string, fallbackTitle: string, options: ParseOptions): ImportedFile {
  const read = readPageText(text);
  // frontmatter that is not valid yaml stays on the page as text, so nothing is lost
  const doc = markdownToDoc(read.error ? text : read.body, options);
  const first = doc.content?.[0];
  const heading =
    first?.type === 'heading' && first.attrs?.level === 1 ? inlineText(first).trim() || null : null;
  const title = (read.error ? null : read.title) ?? heading ?? fallbackTitle;
  // the first heading is the title when it says the same, otherwise it stays in the text
  if (heading !== null && heading === title)
    doc.content = doc.content!.length > 1 ? doc.content!.slice(1) : emptyDoc().content!;
  const blocks = doc.content!;
  doc.content = blocks.map((node, index) =>
    isContentsList(node) || listsHeadingsBelow(node, blocks.slice(index + 1))
      ? { type: 'tableOfContents' }
      : node,
  );
  if (read.error) return { title, doc, fields: {} };
  const fields: Partial<PageMeta> = { tags: read.tags, extra: read.extra };
  if (read.icon) fields.icon = read.icon;
  if (read.kind === 'database' && read.database)
    Object.assign(fields, { kind: 'database', database: read.database });
  return { title, doc, fields };
}

// notion writes its table of contents as a list of links to the page's own headings, it becomes one again
function isContentsList(node: DocNode): boolean {
  if (node.type !== 'bulletList' || !node.content?.length) return false;
  return node.content.every((item) => {
    const [first, ...rest] = item.content ?? [];
    const parts = first?.type === 'paragraph' ? (first.content ?? []) : [];
    const href =
      parts.length === 1 ? parts[0]!.marks?.find((mark) => mark.type === 'link')?.attrs?.href : null;
    return (
      typeof href === 'string' &&
      /^((about:blank)?#.|https?:\/\/(www\.)?notion\.so\/[^#]*#.)/.test(href) &&
      rest.every((child) => isContentsList(child))
    );
  });
}

// notion can also write its table of contents as plain bullets, each one the text of a heading further down
function listsHeadingsBelow(node: DocNode, below: DocNode[]): boolean {
  if (node.type !== 'bulletList') return false;
  const fold = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
  const headings = new Set(
    below.filter((block) => block.type === 'heading').map((block) => fold(inlineText(block))),
  );
  if (headings.size < 2) return false;
  let count = 0;
  const matches = (list: DocNode): boolean =>
    (list.content ?? []).every((item) => {
      const [first, ...rest] = item.content ?? [];
      if (first?.type !== 'paragraph' || !headings.has(fold(inlineText(first)))) return false;
      count++;
      return rest.every((child) => child.type === 'bulletList' && matches(child));
    });
  return matches(node) && count >= 2;
}

// rows of an imported database take their values out of their frontmatter, once every page is known
export function claimRowValues(pages: PageMeta[], newId: () => string): void {
  const byId = new Map(pages.map((page) => [page.id, page]));
  for (const page of pages) {
    const parent = page.parentId ? byId.get(page.parentId) : undefined;
    if (parent?.kind === 'database' && parent.database)
      takeProperties(parent.database, page.extra, page.properties, newId);
  }
}

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
  const extras = new Map<PageId, Partial<PageMeta>>();
  const merge = (id: PageId, fields: Partial<PageMeta>) => extras.set(id, { ...extras.get(id), ...fields });
  const problems: string[] = [];
  const docs: Record<PageId, DocNode> = {};
  const titles = new Map<PageId, string>();

  for (const entry of markdown) {
    const key = stripExtension(entry.path);
    const page = keys.get(key)!;
    const base = dirname(entry.path);
    const parsed = readImportedFile(decoder.decode(entry.data), page.title, {
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
    extras.set(page.id, parsed.fields);
  }

  // notion databases arrive as a csv of rows plus a folder with a page per row, they become real databases
  const newRows: PageMeta[] = [];
  for (const entry of tables) {
    const key = stripExtension(entry.path).replace(/_all$/, '');
    const page = keys.get(key)!;
    const rows = parseCsv(decoder.decode(entry.data));
    if (rows.length === 0) continue;
    if (rows.length > MAX_TABLE_ROWS + 1)
      problems.push(`Only the first ${MAX_TABLE_ROWS} rows of ${page.title} were imported.`);
    const [header, ...body] = rows.slice(0, MAX_TABLE_ROWS + 1);
    const database = databaseFromTable(header!, body, newId);
    merge(page.id, { kind: 'database', database });
    docs[page.id] ??= emptyDoc();
    const rowPages = [...keys.entries()].filter(([rowKey]) => dirname(rowKey) === key);
    const claimed = new Set<PageId>();
    body.forEach((cells, index) => {
      const title = (cells[0] ?? '').trim() || 'Untitled';
      const values: Record<string, PropValue> = {};
      database.properties.forEach((prop, column) => {
        const value = parseCellValue(prop, cells[column + 1] ?? '');
        if (value !== null) values[prop.id] = value;
      });
      const match = rowPages.find(
        ([, row]) => !claimed.has(row.id) && (titles.get(row.id) ?? row.title).trim() === title,
      );
      if (match) {
        claimed.add(match[1].id);
        merge(match[1].id, { properties: values });
        const doc = docs[match[1].id];
        if (doc) docs[match[1].id] = withoutPropertyLines(doc, header!.slice(1));
      } else {
        const id = newId();
        newRows.push(
          newPageMeta({ id, parentId: page.id, title, order: index, createdAt: now, properties: values }),
        );
        docs[id] = emptyDoc();
      }
    });
  }
  for (const folder of folders.values()) docs[folder.id] = emptyDoc();

  const all = [...keys.entries(), ...folders.entries()].sort(([a], [b]) => a.localeCompare(b));
  const counters = new Map<PageId | null, number>();
  const base = childrenOf(state.pages, parentId).length;
  const pages: PageMeta[] = all.map(([key, page]) => {
    const parent = pageAt(dirname(key))?.id ?? parentId;
    const order = counters.get(parent) ?? (parent === parentId ? base : 0);
    counters.set(parent, order + 1);
    return newPageMeta({
      id: page.id,
      parentId: parent,
      title: titles.get(page.id) ?? page.title,
      order,
      createdAt: now,
      ...extras.get(page.id),
    });
  });
  for (const row of newRows) row.order += counters.get(row.parentId) ?? 0;
  claimRowValues(pages, newId);

  return {
    pages: [...pages, ...newRows],
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

// notion repeats a row's properties as "Name: value" lines at the top of its page, they now live in the database
function withoutPropertyLines(doc: DocNode, names: string[]): DocNode {
  const prefixes = names.map((name) => `${name.trim()}:`).filter((prefix) => prefix.length > 1);
  const content = [...(doc.content ?? [])];
  while (content.length > 0) {
    const first = content[0]!;
    const text = first.type === 'paragraph' ? inlineText(first).trim() : '';
    if (!text || !prefixes.some((prefix) => text.startsWith(prefix))) break;
    content.shift();
  }
  return content.length ? { ...doc, content } : emptyDoc();
}
