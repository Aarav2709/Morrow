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
  matches: Array<{ from: number; to: number }>;
  current: number;
}

const findKey = new PluginKey<FindState>('findReplace');

function findMatches(state: EditorState, query: string): FindState['matches'] {
  const term = query.toLowerCase();
  if (!term) return [];
  const matches: FindState['matches'] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // atoms count as one character so positions stay aligned with the document
    const text = node.textBetween(0, node.content.size, undefined, '￼').toLowerCase();
    for (
      let index = text.indexOf(term);
      index !== -1 && matches.length < 10_000;
      index = text.indexOf(term, index + term.length)
    ) {
      matches.push({ from: pos + 1 + index, to: pos + 1 + index + term.length });
    }
    return false;
  });
  return matches;
}

export function getFindState(state: EditorState): FindState {
  return findKey.getState(state) ?? { query: '', matches: [], current: 0 };
}

export function setFindQuery(state: EditorState, dispatch: (tr: Transaction) => void, query: string): void {
  const matches = findMatches(state, query);
  const from = state.selection.from;
  const current = Math.max(
    0,
    matches.findIndex((match) => match.from >= from),
  );
  dispatch(state.tr.setMeta(findKey, { query, matches, current }));
}

export function stepFind(state: EditorState, dispatch: (tr: Transaction) => void, direction: 1 | -1): void {
  const find = getFindState(state);
  if (find.matches.length === 0) return;
  const current = (find.current + direction + find.matches.length) % find.matches.length;
  const match = find.matches[current]!;
  dispatch(
    state.tr
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
  if (!match) return;
  const tr = state.tr.insertText(replacement, match.from, match.to);
  const matches = findMatches(state.apply(tr), find.query);
  dispatch(
    tr.setMeta(findKey, {
      ...find,
      matches,
      current: Math.min(find.current, Math.max(0, matches.length - 1)),
    }),
  );
}

// one transaction, so a single undo brings every replaced match back
export function replaceAll(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  replacement: string,
): number {
  const find = getFindState(state);
  if (find.matches.length === 0) return 0;
  const tr = state.tr;
  for (const match of [...find.matches].reverse()) tr.insertText(replacement, match.from, match.to);
  dispatch(tr.setMeta(findKey, { ...find, matches: findMatches(state.apply(tr), find.query), current: 0 }));
  return find.matches.length;
}

export const FindReplace = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: '', matches: [], current: 0 }),
          apply(tr, value, _old, next) {
            const meta = tr.getMeta(findKey) as FindState | undefined;
            if (meta) return meta;
            if (!tr.docChanged || !value.query) return value;
            const matches = findMatches(next, value.query);
            return { ...value, matches, current: Math.min(value.current, Math.max(0, matches.length - 1)) };
          },
        },
        props: {
          decorations(state) {
            const find = findKey.getState(state);
            if (!find || find.matches.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              find.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: index === find.current ? 'find-match is-current' : 'find-match',
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
