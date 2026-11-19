// spelling checked by morrow itself where the web view can only check one language, as on windows. the
// words no language picked knows get a red line, a right click on one offers what it might have meant
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { desktop } from '../platform/desktop';
import { getPreferences, subscribePreferences } from '../platform/preferences';

// what each word was found to be, kept for every page so a word is asked about once
const verdicts = new Map<string, boolean>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();
let batch: Set<string> | null = null;

export function ownSpelling(): boolean {
  return !!desktop?.spellCheck && getPreferences().spellcheck;
}

// a word worth checking: letters, with an apostrophe or a hyphen inside. words with digits, all in capitals
// like NASA, and anything shorter than two letters are left alone
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
function checkable(word: string): boolean {
  if (word.length < 2 || word.length > 60) return false;
  if (word === word.toUpperCase() && word !== word.toLowerCase()) return false;
  return true;
}

// the words in a page's text, where each is. code, links, maths and the like are skipped
export function wordsIn(doc: PMNode): Array<{ word: string; from: number; to: number }> {
  const out: Array<{ word: string; from: number; to: number }> = [];
  doc.descendants((node, pos, parent) => {
    if (node.type.spec.code) return false;
    if (!node.isText) return true;
    if (parent?.type.spec.code) return false;
    if (node.marks.some((mark) => mark.type.name === 'code' || mark.type.name === 'link')) return false;
    const text = node.text ?? '';
    for (const match of text.matchAll(WORD)) {
      const word = match[0].replace(/’/g, "'");
      const at = match.index ?? 0;
      // a word right next to # or @ is a tag or a mention, not a word
      const before = text[at - 1];
      if (before === '#' || before === '@' || before === '/' || before === '\\') continue;
      if (!checkable(word)) continue;
      out.push({ word, from: pos + at, to: pos + at + match[0].length });
    }
    return false;
  });
  return out;
}

// words not asked about yet go together in one question a moment later
function ask(words: Iterable<string>): void {
  const fresh = [...words].filter((word) => !verdicts.has(word) && !waiting.has(word));
  if (fresh.length === 0 || !desktop?.spellCheck) return;
  for (const word of fresh) waiting.add(word);
  if (batch) {
    for (const word of fresh) batch.add(word);
    return;
  }
  batch = new Set(fresh);
  setTimeout(() => {
    const words = [...(batch ?? [])];
    batch = null;
    void desktop!.spellCheck!(words)
      .then(({ wrong }) => {
        const bad = new Set(wrong);
        for (const word of words) {
          verdicts.set(word, !bad.has(word));
          waiting.delete(word);
        }
        for (const listener of listeners) listener();
      })
      .catch(() => {
        for (const word of words) waiting.delete(word);
      });
  }, 120);
}

// a word added to the dictionary or the languages changing are checked again everywhere
export function forgetSpelling(word?: string): void {
  if (word) verdicts.set(word, true);
  else verdicts.clear();
  for (const listener of listeners) listener();
}

const key = new PluginKey<DecorationSet>('spelling');

function decorate(state: EditorState): DecorationSet {
  if (!ownSpelling()) return DecorationSet.empty;
  const found = wordsIn(state.doc);
  ask(found.map((item) => item.word));
  const marks = found
    .filter((item) => verdicts.get(item.word) === false)
    .map((item) => Decoration.inline(item.from, item.to, { class: 'spell-error', 'data-word': item.word }));
  return DecorationSet.create(state.doc, marks);
}

// the word under a right click, when it is one marked as misspelled
export function misspelledAt(
  view: EditorView,
  event: MouseEvent,
): { word: string; from: number; to: number } | null {
  const target = (event.target as Element | null)?.closest?.('.spell-error');
  if (!target || !view.dom.contains(target)) return null;
  const word = target.getAttribute('data-word') ?? '';
  try {
    const from = view.posAtDOM(target, 0);
    return { word, from, to: from + (target.textContent?.length ?? word.length) };
  } catch {
    return null;
  }
}

export const Spelling = Extension.create({
  name: 'spelling',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => decorate(state),
          // while typing the marks move with the words and the page is read again once typing pauses, so a
          // long page never slows the keys down
          apply(tr: Transaction, value, _old, next) {
            if (tr.getMeta(key)) return decorate(next);
            return value.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => key.getState(state),
          // the web view's own check stays off where morrow checks, or each word would be marked twice
          attributes: (): Record<string, string> => (ownSpelling() ? { spellcheck: 'false' } : {}),
        },
        view: () => {
          // answers arriving, a word added or the setting changing draw the marks again
          const refresh = () => {
            if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, true));
          };
          listeners.add(refresh);
          const stop = subscribePreferences(refresh);
          let timer: ReturnType<typeof setTimeout> | null = null;
          return {
            update: (view, previous) => {
              if (view.state.doc.eq(previous.doc) || !ownSpelling()) return;
              if (timer) clearTimeout(timer);
              timer = setTimeout(refresh, 450);
            },
            destroy: () => {
              if (timer) clearTimeout(timer);
              listeners.delete(refresh);
              stop();
            },
          };
        },
      }),
    ];
  },
});
