import { Extension, mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CALLOUT_TONES } from '../../core/model';
import { calloutNodeView } from './Extras';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: 'note',
        parseHTML: (element) => {
          const tone = element.getAttribute('data-tone');
          return (CALLOUT_TONES as readonly string[]).includes(tone ?? '') ? tone : 'note';
        },
        renderHTML: (attributes) => ({ 'data-tone': attributes.tone }),
      },
      // the obsidian callout type, such as info or todo, kept so the file reads the same
      kind: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-kind'),
        renderHTML: (attributes) => (attributes.kind ? { 'data-kind': attributes.kind } : {}),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-title'),
        renderHTML: (attributes) => (attributes.title ? { 'data-title': attributes.title } : {}),
      },
      // the emoji shown beside it, null for the one its type has and 'none' for no icon at all
      icon: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-icon'),
        renderHTML: (attributes) => (attributes.icon ? { 'data-icon': attributes.icon } : {}),
      },
      // the rest of the obsidian metadata after a | in [!type|metadata], kept as written
      meta: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-meta'),
        renderHTML: (attributes) => (attributes.meta ? { 'data-meta': attributes.meta } : {}),
      },
      // + starts open and - starts folded, null cannot fold
      fold: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-fold'),
        renderHTML: (attributes) => (attributes.fold ? { 'data-fold': attributes.fold } : {}),
      },
    };
  },

  addNodeView() {
    return calloutNodeView();
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'callout' }), 0];
  },

  addCommands() {
    return {
      setCallout:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name),
    };
  },
});

export interface FindState {
  query: string;
  // the query is a regular expression, and a replacement can use its groups as $1, $2 and so on
  regex: boolean;
  // capitals and small letters have to match as typed
  caseSensitive?: boolean;
  matches: Array<{ from: number; to: number }>;
  current: number;
  // the matches from one number to another, counted from 1 as the find bar shows them. while set, only
  // they are lit, stepped through and replaced
  range?: { first: number; last: number } | null;
}

// the indexes, from 0, of the matches a search works on: those in its range, or all of them
function workingIndexes(find: FindState): number[] {
  const count = find.matches.length;
  const first = find.range ? Math.max(1, find.range.first) : 1;
  const last = find.range ? Math.min(count, find.range.last) : count;
  const indexes: number[] = [];
  for (let index = first - 1; index < last; index++) indexes.push(index);
  return indexes;
}

export function inFindRange(find: FindState, index: number): boolean {
  return !find.range || (index + 1 >= find.range.first && index + 1 <= find.range.last);
}

const findKey = new PluginKey<FindState>('findReplace');

// null when a regular expression is still being typed and isn't valid yet
function findPattern(query: string, regex: boolean, caseSensitive = false): RegExp | null {
  if (!query) return null;
  const flags = caseSensitive ? 'g' : 'gi';
  if (!regex) return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  try {
    return new RegExp(query, flags);
  } catch {
    return null;
  }
}

export function findMatches(
  state: EditorState,
  query: string,
  regex: boolean,
  caseSensitive = false,
): FindState['matches'] {
  const pattern = findPattern(query, regex, caseSensitive);
  if (!pattern) return [];
  const matches: FindState['matches'] = [];
  state.doc.descendants((node, pos) => {
    if (matches.length >= 10_000) return false;
    // lists, toggles, callouts, columns and tables are looked inside, their text is in the blocks they hold
    if (!node.isTextblock) return true;
    // atoms count as one character so positions stay aligned with the document
    const text = node.textBetween(0, node.content.size, undefined, '\ufffc');
    for (const match of text.matchAll(pattern)) {
      // a pattern that can match nothing, like a*, only counts where it matched something
      if (!match[0]) continue;
      matches.push({ from: pos + 1 + match.index, to: pos + 1 + match.index + match[0].length });
      if (matches.length >= 10_000) break;
    }
    return false;
  });
  return matches;
}

// what a match is replaced with. a regular expression fills in its groups
function replacementFor(
  state: EditorState,
  find: FindState,
  match: FindState['matches'][number],
  text: string,
) {
  if (!find.regex) return text;
  const pattern = findPattern(find.query, true, find.caseSensitive);
  const found = state.doc.textBetween(match.from, match.to, undefined, '\ufffc');
  return pattern ? found.replace(new RegExp(pattern.source, find.caseSensitive ? '' : 'i'), text) : text;
}

// opens every folded toggle around a position, so a match found inside one can be seen
export function revealAt(tr: Transaction, pos: number): Transaction {
  const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'details' && !node.attrs.open)
      tr.setNodeMarkup($pos.before(depth), undefined, { ...node.attrs, open: true });
  }
  return tr;
}

export function getFindState(state: EditorState): FindState {
  return findKey.getState(state) ?? { query: '', regex: false, matches: [], current: 0 };
}

export function setFindQuery(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  query: string,
  regex = getFindState(state).regex,
  caseSensitive = getFindState(state).caseSensitive ?? false,
): void {
  const matches = findMatches(state, query, regex, caseSensitive);
  const from = state.selection.from;
  const current = Math.max(
    0,
    matches.findIndex((match) => match.from >= from),
  );
  // a new search numbers its matches again, so a range picked for the last one goes
  const tr = state.tr.setMeta(findKey, { query, regex, caseSensitive, matches, current, range: null });
  const match = matches[current];
  dispatch(match ? revealAt(tr, match.from) : tr);
}

// narrows the search to matches first to last, or back to all of them with null. the first of them is the
// one looked at
export function setFindRange(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  range: { first: number; last: number } | null,
): void {
  const find = getFindState(state);
  const next: FindState = { ...find, range };
  const indexes = workingIndexes(next);
  if (range && indexes.length === 0) return;
  const current = indexes.includes(find.current) ? find.current : (indexes[0] ?? 0);
  const tr = state.tr.setMeta(findKey, { ...next, current });
  const match = find.matches[current];
  dispatch(match ? revealAt(tr, match.from) : tr);
}

export function stepFind(state: EditorState, dispatch: (tr: Transaction) => void, direction: 1 | -1): void {
  const find = getFindState(state);
  const indexes = workingIndexes(find);
  if (indexes.length === 0) return;
  const at = indexes.indexOf(find.current);
  const current =
    at === -1
      ? indexes[direction === 1 ? 0 : indexes.length - 1]!
      : indexes[(at + direction + indexes.length) % indexes.length]!;
  const match = find.matches[current]!;
  dispatch(
    revealAt(state.tr, match.from)
      .setMeta(findKey, { ...find, current })
      .setSelection(TextSelection.create(state.doc, match.from, match.to))
      .scrollIntoView(),
  );
}

export function replaceCurrent(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  replacement: string,
): void {
  const find = getFindState(state);
  const match = find.matches[find.current];
  if (!match || !inFindRange(find, find.current)) return;
  const tr = state.tr.insertText(replacementFor(state, find, match, replacement), match.from, match.to);
  const matches = findMatches(state.apply(tr), find.query, find.regex, find.caseSensitive);
  // a match that went away shortens the range by one, so it still ends on the same words
  const removed = matches.length < find.matches.length;
  const range = find.range && removed ? { ...find.range, last: find.range.last - 1 } : (find.range ?? null);
  dispatch(
    tr.setMeta(findKey, {
      ...find,
      matches,
      range: range && range.last >= range.first ? range : null,
      current: Math.min(find.current, Math.max(0, matches.length - 1)),
    }),
  );
}

// one transaction, so a single undo brings every replaced match back. first and last, counted from 1 as the
// find bar shows them, replace only the matches from one to the other, 4 to 7 say. without them it is the
// search's range when it has one
export function replaceAll(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  replacement: string,
  first = getFindState(state).range?.first ?? 1,
  last = getFindState(state).range?.last ?? Number.POSITIVE_INFINITY,
): number {
  const find = getFindState(state);
  const picked = find.matches.slice(Math.max(0, first - 1), Math.max(0, last));
  if (picked.length === 0) return 0;
  const tr = state.tr;
  for (const match of [...picked].reverse())
    tr.insertText(replacementFor(state, find, match, replacement), match.from, match.to);
  dispatch(
    tr.setMeta(findKey, {
      ...find,
      matches: findMatches(state.apply(tr), find.query, find.regex, find.caseSensitive),
      current: 0,
      range: null,
    }),
  );
  return picked.length;
}

export const FindReplace = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: '', regex: false, matches: [], current: 0 }),
          apply(tr, value, _old, next) {
            const meta = tr.getMeta(findKey) as FindState | undefined;
            if (meta) return meta;
            if (!tr.docChanged || !value.query) return value;
            const matches = findMatches(next, value.query, value.regex, value.caseSensitive);
            // typing in the page can change how many matches there are, the range then no longer means
            // the same words
            const range = matches.length === value.matches.length ? (value.range ?? null) : null;
            return {
              ...value,
              matches,
              range,
              current: Math.min(value.current, Math.max(0, matches.length - 1)),
            };
          },
        },
        props: {
          decorations(state) {
            const find = findKey.getState(state);
            if (!find || find.matches.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              // only the matches in the range are lit while there is one
              find.matches.flatMap((match, index) =>
                inFindRange(find, index)
                  ? [
                      Decoration.inline(match.from, match.to, {
                        class: index === find.current ? 'find-match is-current' : 'find-match',
                      }),
                    ]
                  : [],
              ),
            );
          },
        },
      }),
    ];
  },
});
