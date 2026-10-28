// workspace data model, plain json shared by storage, search, export and the editor

// bump when the persisted shape changes and add a migration in migrations.ts
export const SCHEMA_VERSION = 3;

export const MAX_TITLE_LENGTH = 500;
export const MAX_ICON_LENGTH = 16;
// limits that keep hostile or corrupted documents from hanging the app
export const MAX_DOC_DEPTH = 64;
export const MAX_DOC_NODES = 200_000;
export const MAX_TREE_DEPTH = 256;

export type PageId = string;

// journal holds daily notes, templates holds reusable pages, databases and canvases have their own views
export type PageKind = 'page' | 'journal' | 'templates' | 'database' | 'canvas';
export const PAGE_KINDS: readonly PageKind[] = ['page', 'journal', 'templates', 'database', 'canvas'];

export type PropType =
  'text' | 'number' | 'select' | 'multiSelect' | 'date' | 'checkbox' | 'url' | 'relation' | 'formula';
export const PROP_TYPES: readonly PropType[] = [
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
  'relation',
  'formula',
];
export const COLORS = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type ColorName = (typeof COLORS)[number];

export interface SelectOption {
  id: string;
  name: string;
  color: ColorName;
}

export interface PropDef {
  id: string;
  name: string;
  type: PropType;
  options: SelectOption[];
  // the expression a formula property computes, see core/formula
  formula?: string;
  // a number or formula shown as a progress bar filled to value out of max, 100 when not set
  display?: 'bar';
  max?: number;
}

export type FilterOp =
  'contains' | 'notContains' | 'is' | 'isNot' | 'empty' | 'notEmpty' | 'gt' | 'lt' | 'checked' | 'unchecked';

export interface FilterRule {
  id: string;
  // a property id, or title
  prop: string;
  op: FilterOp;
  value: PropValue;
}

export interface SortRule {
  // a property id, or title, created or updated
  prop: string;
  dir: 'asc' | 'desc';
}

export type ViewType = 'table' | 'board' | 'calendar' | 'list' | 'gallery';
export const VIEW_TYPES: readonly ViewType[] = ['table', 'board', 'calendar', 'list', 'gallery'];

export interface ViewDef {
  id: string;
  name: string;
  type: ViewType;
  filters: FilterRule[];
  sorts: SortRule[];
  groupBy: string | null;
  dateProp: string | null;
  hidden: string[];
  // table column widths in pixels, by property id or title, missing means the default width
  widths?: Record<string, number>;
}

export interface DatabaseDef {
  properties: PropDef[];
  views: ViewDef[];
}

// option ids for selects, yyyy mm dd for dates
export type PropValue = string | number | boolean | string[] | null;

export interface PageMeta {
  id: PageId;
  parentId: PageId | null;
  title: string;
  icon: string | null;
  kind: PageKind;
  order: number;
  createdAt: number;
  updatedAt: number;
  // set only on the page that was trashed, its subpages are hidden with it
  trashedAt: number | null;
  // archived pages leave the sidebar but stay searchable and linkable
  archivedAt: number | null;
  favorite: boolean;
  dailyDate: string | null;
  lastOpenedAt: number | null;
  tags: string[];
  // values for the properties of the database this page is a row of, keyed by property id
  properties: Record<string, PropValue>;
  // frontmatter keys morrow gives no meaning to, such as obsidian properties, shown and edited as they are
  extra: Record<string, unknown>;
  database: DatabaseDef | null;
  // a gradient such as gradient-3, or the path of an image in the vault
  cover: string | null;
  // the page file is encrypted with a password, its content is only in memory while it is unlocked
  encrypted: boolean;
}

export const COVER_GRADIENTS = 12;

export function validCover(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cover = value.trim();
  if (/^gradient-([1-9]|1[0-2])$/.test(cover)) return cover;
  // images are vault paths, never web addresses, so a cover never loads anything from elsewhere
  if (cover.length <= 500 && !/^[a-z][a-z0-9+.-]*:/i.test(cover) && !cover.includes('..')) return cover;
  return null;
}

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}

export interface WorkspaceState {
  pages: Readonly<Record<PageId, PageMeta>>;
  docs: Readonly<Record<PageId, DocNode>>;
}

// anything outside these sets is preserved but opened read only, so a type belongs here only
// once the editor registers it, otherwise the editor would drop it on load and the next save loses it
export const KNOWN_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'pageLink',
  'image',
  'fileAttachment',
  'callout',
  'details',
  'detailsSummary',
  'detailsContent',
  'inlineMath',
  'blockMath',
  'rawBlock',
  'columns',
  'column',
  'tableOfContents',
  'dateMention',
]);

export const KNOWN_MARK_TYPES = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
  'highlight',
  'textColor',
]);

// the colours text and highlights are written with in files, readable by any markdown app that shows html
export const TEXT_HEX: Record<ColorName, string> = {
  gray: '#787774',
  brown: '#9f6b53',
  orange: '#d9730d',
  yellow: '#cb912f',
  green: '#448361',
  blue: '#337ea9',
  purple: '#9065b0',
  pink: '#c14c8a',
  red: '#d44c47',
};
export const BACKGROUND_HEX: Record<ColorName, string> = {
  gray: '#f1f1ef',
  brown: '#f4eeee',
  orange: '#fbecdd',
  yellow: '#fbf3db',
  green: '#edf3ec',
  blue: '#e7f3f8',
  purple: '#f6f3f9',
  pink: '#faf1f5',
  red: '#fdebec',
};

// the palette colour closest to any css colour written as #rgb or #rrggbb
export function nearestColor(hex: string, palette: Record<ColorName, string>): ColorName | null {
  const parse = (value: string) => {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (!match) return null;
    const digits = match[1]!.length === 3 ? [...match[1]!].map((d) => d + d).join('') : match[1]!;
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  };
  const wanted = parse(hex);
  if (!wanted) return null;
  let best: ColorName | null = null;
  let distance = Infinity;
  for (const [name, value] of Object.entries(palette) as Array<[ColorName, string]>) {
    const rgb = parse(value)!;
    const d = rgb.reduce((sum, channel, i) => sum + (channel - wanted[i]!) ** 2, 0);
    if (d < distance) {
      distance = d;
      best = name;
    }
  }
  return best;
}

export type FileId = string;

// metadata of a stored image or attachment, the bytes live next to it in storage
export interface FileMeta {
  id: FileId;
  name: string;
  type: string;
  size: number;
  createdAt: number;
}

export interface Snapshot {
  id: string;
  pageId: PageId;
  title: string;
  doc: DocNode;
  createdAt: number;
  // the page's database values and other frontmatter, missing from versions kept before they were
  properties?: Record<string, PropValue>;
  extra?: Record<string, unknown>;
}

export const CALLOUT_TONES = ['note', 'tip', 'warning', 'danger'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

// obsidian and github callout types, each drawn in one of the four tones
const CALLOUT_KIND_TONES: Record<string, CalloutTone> = {
  tip: 'tip',
  hint: 'tip',
  important: 'tip',
  success: 'tip',
  check: 'tip',
  done: 'tip',
  warning: 'warning',
  caution: 'warning',
  attention: 'warning',
  question: 'warning',
  help: 'warning',
  faq: 'warning',
  danger: 'danger',
  error: 'danger',
  failure: 'danger',
  fail: 'danger',
  missing: 'danger',
  bug: 'danger',
};

export function calloutTone(kind: string): CalloutTone {
  return CALLOUT_KIND_TONES[kind.toLowerCase()] ?? 'note';
}

export function emptyDoc(): DocNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function emptyWorkspace(): WorkspaceState {
  return { pages: {}, docs: {} };
}

export const UNTITLED = 'Untitled';

export function displayTitle(page: Pick<PageMeta, 'title'> | undefined): string {
  const title = page?.title.trim();
  return title ? title : UNTITLED;
}

// every new page record goes through here so added fields always get safe defaults
export function newPageMeta(fields: Pick<PageMeta, 'id' | 'parentId'> & Partial<PageMeta>): PageMeta {
  const now = fields.createdAt ?? 0;
  return {
    title: '',
    icon: null,
    kind: 'page',
    order: 0,
    createdAt: now,
    updatedAt: fields.updatedAt ?? now,
    trashedAt: null,
    archivedAt: null,
    favorite: false,
    dailyDate: null,
    lastOpenedAt: null,
    tags: [],
    properties: {},
    extra: {},
    database: null,
    cover: null,
    encrypted: false,
    ...fields,
  };
}
