// workspace data model, plain json shared by storage, search, export and the editor

// bump when the persisted shape changes and add a migration in migrations.ts
export const SCHEMA_VERSION = 2;

export const MAX_TITLE_LENGTH = 500;
export const MAX_ICON_LENGTH = 16;
// limits that keep hostile or corrupted documents from hanging the app
export const MAX_DOC_DEPTH = 64;
export const MAX_DOC_NODES = 200_000;
export const MAX_TREE_DEPTH = 256;

export type PageId = string;

// journal is the container page for daily notes
export type PageKind = 'page' | 'journal';

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

// anything outside these sets is preserved but opened read only
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
]);

export const KNOWN_MARK_TYPES = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link']);

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

export const CALLOUT_TONES = ['note', 'tip', 'warning'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

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
