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

export type PropType = 'text' | 'number' | 'select' | 'multiSelect' | 'date' | 'checkbox' | 'url';
export const PROP_TYPES: readonly PropType[] = [
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
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
  favorite: boolean;
  dailyDate: string | null;
  lastOpenedAt: number | null;
  tags: string[];
  // values for the properties of the database this page is a row of, keyed by property id
  properties: Record<string, PropValue>;
  database: DatabaseDef | null;
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
]);

export const KNOWN_MARK_TYPES = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
  'highlight',
]);

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
    favorite: false,
    dailyDate: null,
    lastOpenedAt: null,
    tags: [],
    properties: {},
    database: null,
    ...fields,
  };
}
