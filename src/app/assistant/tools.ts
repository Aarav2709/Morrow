// what the assistant can do with your pages. reading is free, every change is proposed first,
// kept in page history before it happens, and can be undone from the chat
import { findDatabaseOf } from '../../core/database';
import { dateKey } from '../../core/daily';
import { validateDoc } from '../../core/doc';
import { markdownToDoc } from '../../core/markdown/parse';
import { docToMarkdown } from '../../core/markdown/serialize';
import { displayTitle, emptyDoc } from '../../core/model';
import type { DocNode, PageId, PageMeta, WorkspaceState } from '../../core/model';
import { pageIdByTitle, resolveLinkTarget, searchWorkspace } from '../../core/search';
import { ancestorsOf, childrenOf, isEffectivelyTrashed } from '../../core/tree';
import { ensureToday, expandPage } from '../operations';
import type { AssistantToolSpec } from '../platform/desktop';
import { newId } from '../platform/files';
import { activeRoute, openPage } from '../router';
import { getSession, getState, run } from '../workspace';

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// a change the assistant wants to make, shown to you before it happens
export interface Proposal {
  title: string;
  pageId: PageId | null;
  before: string;
  after: string;
  apply: () => Promise<AppliedChange>;
}

export interface AppliedChange {
  pageId: PageId;
  message: string;
  undo: () => void;
}

export type ToolOutcome =
  { kind: 'result'; content: string; isError?: boolean } | { kind: 'proposal'; proposal: Proposal };

const page = (description: string) => ({ type: 'string', description });

export const TOOL_SPECS: AssistantToolSpec[] = [
  {
    name: 'search_pages',
    description:
      'Search the text and titles of every page. Supports "exact phrases", -word to leave pages out and #tag to keep pages with a tag. Returns matching pages with their ids and the lines that matched.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for.' },
        limit: {
          type: 'integer',
          description: 'Most pages to return, 10 when left out.',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_pages',
    description:
      'List the pages inside a page, or the top level of the vault when no parent is given, with ids, kinds and how many subpages each has.',
    parameters: {
      type: 'object',
      properties: { parent: page('Id or title of the parent page. Leave out for the top level.') },
    },
  },
  {
    name: 'read_page',
    description:
      'Read a page: its title, place in the vault, tags, properties and its whole content as Morrow Markdown. A database page also lists its rows.',
    parameters: {
      type: 'object',
      properties: { page: page('Id or exact title of the page.') },
      required: ['page'],
    },
  },
  {
    name: 'current_page',
    description: 'The page the user has open right now, if any, with its id and title.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'todays_note',
    description: "Find today's daily note, making it if it doesn't exist yet. Returns its id and title.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'open_page',
    description: 'Show a page to the user in Morrow.',
    parameters: {
      type: 'object',
      properties: { page: page('Id or exact title of the page.') },
      required: ['page'],
    },
  },
  {
    name: 'create_page',
    description: 'Make a new page with content written in Morrow Markdown. The user approves it first.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The title of the new page.' },
        markdown: {
          type: 'string',
          description: 'The body of the page in Morrow Markdown, without the title.',
        },
        parent: page('Id or title of the page to put it inside. Leave out for the top level.'),
      },
      required: ['title', 'markdown'],
    },
  },
  {
    name: 'edit_page',
    description:
      'Change part of a page: the exact text in find, copied from read_page, is replaced by replace. find must appear exactly once; include more of the surrounding text when it is not unique. The user approves it first.',
    parameters: {
      type: 'object',
      properties: {
        page: page('Id or exact title of the page.'),
        find: {
          type: 'string',
          description: 'Text currently in the page, exactly as read_page returned it.',
        },
        replace: { type: 'string', description: 'The new text, in Morrow Markdown. Empty to remove it.' },
      },
      required: ['page', 'find', 'replace'],
    },
  },
  {
    name: 'append_to_page',
    description: 'Add Morrow Markdown to the end of a page. The user approves it first.',
    parameters: {
      type: 'object',
      properties: {
        page: page('Id or exact title of the page.'),
        markdown: { type: 'string', description: 'What to add, in Morrow Markdown.' },
      },
      required: ['page', 'markdown'],
    },
  },
  {
    name: 'replace_page',
    description:
      "Replace a page's whole content. Only for rewriting most of a page, prefer edit_page for smaller changes. The user approves it first.",
    parameters: {
      type: 'object',
      properties: {
        page: page('Id or exact title of the page.'),
        markdown: {
          type: 'string',
          description: 'The new body of the page in Morrow Markdown, without the title.',
        },
      },
      required: ['page', 'markdown'],
    },
  },
];

class ToolError extends Error {}

const text = (input: Record<string, unknown>, name: string, required = true): string => {
  const value = input[name];
  if (typeof value === 'string') return value;
  if (!required && value === undefined) return '';
  throw new ToolError(`"${name}" is missing or not text.`);
};

function findPage(state: WorkspaceState, reference: string): PageMeta {
  const ref = reference.trim().replace(/^\[\[|\]\]$/g, '');
  const id = state.pages[ref] ? ref : (pageIdByTitle(state, ref) ?? resolveLinkTarget(state, ref));
  const found = id ? state.pages[id] : undefined;
  if (!found || isEffectivelyTrashed(state.pages, found.id))
    throw new ToolError(`No page called "${reference}". Search for it first to find its id.`);
  return found;
}

function guarded(found: PageMeta): PageMeta {
  if (found.encrypted || getSession().unreadable.has(found.id))
    throw new ToolError(
      `"${displayTitle(found)}" is locked. Its content is private and can't be read or changed.`,
    );
  return found;
}

function writable(found: PageMeta): PageMeta {
  guarded(found);
  if (found.kind === 'canvas' || found.kind === 'database')
    throw new ToolError(`"${displayTitle(found)}" is a ${found.kind}, only its text pages can be changed.`);
  return found;
}

const pathOf = (state: WorkspaceState, id: PageId) =>
  ancestorsOf(state.pages, id)
    .reverse()
    .map((ancestor) => displayTitle(ancestor))
    .join(' / ');

export function pageMarkdown(state: WorkspaceState, doc: DocNode | undefined): string {
  return docToMarkdown(doc ?? emptyDoc(), {
    titleOf: (id) => (state.pages[id] ? displayTitle(state.pages[id]) : null),
    filePath: (fileId) => fileId,
  });
}

// markdown from the assistant into a page. a whole body it wrote may start with frontmatter, or the
// title again for a new page, both are left out; text inside an existing page is taken as it is
function markdownDoc(
  state: WorkspaceState,
  markdown: string,
  whole: { title?: string } | null = null,
): DocNode {
  let source = markdown;
  if (whole) {
    const front = /^\uFEFF?---\n([\s\S]*?)\n---\n?/.exec(source);
    if (front && front[1]!.split('\n').every((line) => !line.trim() || /^[\w -]+:/.test(line))) {
      source = source.slice(front[0].length);
    }
    if (whole.title)
      source = source.replace(new RegExp(`^#\\s+${escapeRegExp(whole.title.trim())}\\s*\\n+`), '');
  }
  const parsed = validateDoc(
    markdownToDoc(source.trim(), {
      resolvePage: (target) => resolveLinkTarget(state, target),
      resolveFile: () => null,
    }),
  );
  if (!parsed.ok) throw new ToolError('That Markdown could not be read. Try simpler Markdown.');
  return parsed.value;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const describe = (state: WorkspaceState, item: PageMeta) =>
  [
    `- ${displayTitle(item)} (id: ${item.id}`,
    item.kind !== 'page' ? `, ${item.kind}` : '',
    item.dailyDate ? `, daily note for ${item.dailyDate}` : '',
    item.encrypted ? ', locked' : '',
    `, ${childrenOf(state.pages, item.id).length} subpages)`,
  ].join('');

function readPage(state: WorkspaceState, found: PageMeta): string {
  guarded(found);
  const lines = [`Title: ${displayTitle(found)}`, `Id: ${found.id}`];
  const path = pathOf(state, found.id);
  if (path) lines.push(`Inside: ${path}`);
  if (found.kind !== 'page') lines.push(`Kind: ${found.kind}`);
  if (found.dailyDate) lines.push(`Daily note for: ${found.dailyDate}`);
  if (found.tags.length) lines.push(`Tags: ${found.tags.join(', ')}`);
  lines.push(
    `Created: ${new Date(found.createdAt).toISOString()}`,
    `Edited: ${new Date(found.updatedAt).toISOString()}`,
  );
  const database = findDatabaseOf(state, found);
  if (database?.database) {
    for (const prop of database.database.properties) {
      const value = found.properties[prop.id];
      if (value !== undefined && value !== null && value !== '')
        lines.push(`${prop.name}: ${JSON.stringify(value)}`);
    }
  }
  if (found.kind === 'canvas') {
    lines.push('', 'This is a canvas of cards and drawings. Its cards are not readable as text here.');
    return lines.join('\n');
  }
  if (found.kind === 'database') {
    const rows = childrenOf(state.pages, found.id);
    lines.push('', `Rows (${rows.length}):`, ...rows.slice(0, 200).map((row) => describe(state, row)));
  }
  lines.push('', '---', pageMarkdown(state, state.docs[found.id]) || '(empty page)');
  return lines.join('\n');
}

const MAX_RESULT = 60_000;
const clip = (value: string) =>
  value.length > MAX_RESULT ? `${value.slice(0, MAX_RESULT)}\n\n[cut short, the page is longer]` : value;

// runs a tool; reading happens straight away, a change comes back as a proposal to approve
export function runTool(call: ToolCall): ToolOutcome {
  const state = getState();
  const input = call.input;
  try {
    if ('__invalid' in input) throw new ToolError('The tool input was not valid JSON.');
    switch (call.name) {
      case 'search_pages': {
        const limit =
          typeof input.limit === 'number' ? Math.min(50, Math.max(1, Math.floor(input.limit))) : 10;
        const results = searchWorkspace(state, text(input, 'query'), limit, 3).filter(
          (result) => !result.page.encrypted,
        );
        if (results.length === 0) return { kind: 'result', content: 'No pages match.' };
        return {
          kind: 'result',
          content: results
            .map((result) =>
              [
                describe(state, result.page),
                result.path.length ? `  inside: ${result.path.join(' / ')}` : '',
                ...result.snippets.map((snippet) => `  …${snippet.before}${snippet.match}${snippet.after}…`),
              ]
                .filter(Boolean)
                .join('\n'),
            )
            .join('\n'),
        };
      }
      case 'list_pages': {
        const parent = text(input, 'parent', false);
        const parentId = parent ? findPage(state, parent).id : null;
        const children = childrenOf(state.pages, parentId);
        return {
          kind: 'result',
          content: children.length
            ? children.map((child) => describe(state, child)).join('\n')
            : 'No pages here.',
        };
      }
      case 'read_page':
        return { kind: 'result', content: clip(readPage(state, findPage(state, text(input, 'page')))) };
      case 'current_page': {
        const route = activeRoute();
        const open = route.name === 'page' ? state.pages[route.id] : undefined;
        return {
          kind: 'result',
          content: open
            ? `The user has "${displayTitle(open)}" open (id: ${open.id}).`
            : `No page is open, the user is on the ${route.name} view.`,
        };
      }
      case 'todays_note': {
        const id = ensureToday();
        const today = id ? getState().pages[id] : undefined;
        if (!today) throw new ToolError("Today's note could not be made.");
        return {
          kind: 'result',
          content: `Today's note is "${displayTitle(today)}" (id: ${today.id}, ${dateKey(new Date())}).`,
        };
      }
      case 'open_page': {
        const found = findPage(state, text(input, 'page'));
        openPage(found.id);
        return { kind: 'result', content: `Opened "${displayTitle(found)}".` };
      }
      case 'create_page':
        return { kind: 'proposal', proposal: proposeCreate(state, input) };
      case 'edit_page':
      case 'append_to_page':
      case 'replace_page':
        return { kind: 'proposal', proposal: proposeChange(state, call.name, input) };
      default:
        throw new ToolError(`There is no tool called ${call.name}.`);
    }
  } catch (error) {
    return {
      kind: 'result',
      content: error instanceof ToolError ? error.message : `Something went wrong: ${String(error)}`,
      isError: true,
    };
  }
}

function proposeCreate(state: WorkspaceState, input: Record<string, unknown>): Proposal {
  const title = text(input, 'title').trim() || 'Untitled';
  const markdown = text(input, 'markdown');
  const parentRef = text(input, 'parent', false);
  const parent = parentRef ? findPage(state, parentRef) : null;
  if (parent) guarded(parent);
  const doc = markdownDoc(state, markdown, { title });
  return {
    title: `New page “${title}”${parent ? ` inside “${displayTitle(parent)}”` : ''}`,
    pageId: null,
    before: '',
    after: pageMarkdown(state, doc),
    apply: async () => {
      const id = newId();
      const result = run({
        type: 'page.create',
        id,
        parentId: parent?.id ?? null,
        now: Date.now(),
        title,
        doc,
      });
      if (!result.ok) throw new Error(result.error);
      if (parent) expandPage(parent.id);
      return {
        pageId: id,
        message: `Made "${title}" (id: ${id}).`,
        undo: () => run({ type: 'page.trash', id, now: Date.now() }),
      };
    },
  };
}

function proposeChange(state: WorkspaceState, tool: string, input: Record<string, unknown>): Proposal {
  const found = writable(findPage(state, text(input, 'page')));
  const original = state.docs[found.id];
  const before = pageMarkdown(state, original);
  let after: string;
  if (tool === 'edit_page') {
    const find = text(input, 'find');
    if (!find) throw new ToolError('"find" is empty, say which text to change.');
    const count = before.split(find).length - 1;
    if (count === 0)
      throw new ToolError('That text is not in the page. Read the page again and copy the text exactly.');
    if (count > 1)
      throw new ToolError(
        `That text appears ${count} times. Include more of the text around it so it is unique.`,
      );
    after = before.replace(find, () => text(input, 'replace'));
  } else if (tool === 'append_to_page') {
    after = `${before.trimEnd()}${before.trim() ? '\n\n' : ''}${text(input, 'markdown').trim()}`;
  } else after = text(input, 'markdown');
  const doc = markdownDoc(state, after, tool === 'replace_page' ? {} : null);
  const verb = tool === 'append_to_page' ? 'Add to' : tool === 'replace_page' ? 'Rewrite' : 'Edit';
  return {
    title: `${verb} “${displayTitle(found)}”`,
    pageId: found.id,
    before,
    after: pageMarkdown(state, doc),
    apply: async () => {
      // the page changed since this was proposed, so the proposal no longer fits it
      if (getState().docs[found.id] !== original)
        throw new Error('The page changed in the meantime. Read it again before changing it.');
      await getSession().keepVersion(found.id);
      const result = run({ type: 'page.setDoc', id: found.id, doc, now: Date.now() });
      if (!result.ok) throw new Error(result.error);
      return {
        pageId: found.id,
        message: `Changed "${displayTitle(found)}". The earlier version is kept in its page history.`,
        undo: () => {
          if (original) run({ type: 'page.setDoc', id: found.id, doc: original, now: Date.now() });
        },
      };
    },
  };
}
