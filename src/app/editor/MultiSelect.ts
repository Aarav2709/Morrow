import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { isMac } from '../platform/desktop';

// words picked in several places at once: ctrl, or cmd on a mac, held while dragging over more words keeps
// what was picked before, the way a word processor does. a copy then takes every piece, in page order, each
// on a line of its own. a plain click, or any change to the page, lets the pieces go
export interface Piece {
  from: number;
  to: number;
}

const key = new PluginKey<Piece[]>('multiSelect');

export function extraPieces(state: EditorState): Piece[] {
  return key.getState(state) ?? [];
}

// every piece, the ones kept and the selection, in page order with overlaps joined
export function allPieces(state: EditorState): Piece[] {
  const { from, to, empty } = state.selection;
  const pieces = [...extraPieces(state), ...(empty ? [] : [{ from, to }])].sort((a, b) => a.from - b.from);
  const joined: Piece[] = [];
  for (const piece of pieces) {
    const last = joined[joined.length - 1];
    if (last && piece.from <= last.to) last.to = Math.max(last.to, piece.to);
    else joined.push({ ...piece });
  }
  return joined;
}

export function keepPiece(tr: Transaction, piece: Piece | null, state: EditorState): Transaction {
  return tr.setMeta(key, piece ? [...extraPieces(state), piece] : []);
}

// the pieces as what a copy puts on the clipboard: words for other apps, and morrow's own copy of each
// piece's blocks one after another for pasting back into a page
export function piecesForClipboard(view: EditorView, pieces: Piece[]): { html: string; text: string } {
  const html: string[] = [];
  const text: string[] = [];
  for (const piece of pieces) {
    const slice = view.state.doc.slice(piece.from, piece.to);
    const serialized = view.serializeForClipboard(new Slice(Fragment.from(slice.content), 0, 0));
    html.push(serialized.dom.innerHTML);
    text.push(view.state.doc.textBetween(piece.from, piece.to, '\n', '\n'));
  }
  return { html: html.join(''), text: text.join('\n') };
}

const modifier = (event: MouseEvent | KeyboardEvent) => (isMac ? event.metaKey : event.ctrlKey);

export const MultiSelect = Extension.create({
  name: 'multiSelect',
  // ahead of the other copy handlers, which only know the one selection
  priority: 1150,
  addProseMirrorPlugins() {
    // the words picked when the modifier went down, kept once the drag picks more
    let pending: Piece | null = null;
    return [
      new Plugin<Piece[]>({
        key,
        state: {
          init: () => [],
          apply(tr, value) {
            const meta = tr.getMeta(key) as Piece[] | undefined;
            if (meta !== undefined) return meta;
            if (!value.length) return value;
            // an edit moves everything around, the pieces go. so does a selection made without the modifier,
            // which the mouse handlers below mark
            if (tr.docChanged || tr.getMeta('multiSelectClear')) return [];
            return value;
          },
        },
        props: {
          decorations(state) {
            const pieces = extraPieces(state);
            if (!pieces.length) return null;
            return DecorationSet.create(
              state.doc,
              pieces.map((piece) => Decoration.inline(piece.from, piece.to, { class: 'is-extra-selection' })),
            );
          },
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (event.button !== 0) return false;
              const { from, to, empty } = view.state.selection;
              if (modifier(event) && !empty && view.state.selection instanceof TextSelection) {
                pending = { from, to };
                return false;
              }
              pending = null;
              if (extraPieces(view.state).length)
                view.dispatch(view.state.tr.setMeta(key, []).setMeta('addToHistory', false));
              return false;
            },
            mouseup: (view) => {
              const kept = pending;
              pending = null;
              if (!kept) return false;
              // the drag picked more words, what was picked before stays. a click that picked nothing, such
              // as ctrl clicking a link, leaves the selection as it was
              setTimeout(() => {
                if (view.isDestroyed) return;
                const { state } = view;
                if (!state.selection.empty) view.dispatch(keepPiece(state.tr, kept, state));
                else {
                  const restore = TextSelection.create(
                    state.doc,
                    kept.from,
                    Math.min(kept.to, state.doc.content.size),
                  );
                  view.dispatch(state.tr.setSelection(restore));
                }
              }, 0);
              return false;
            },
            copy: (view, event) => copyPieces(view, event, false),
            cut: (view, event) => copyPieces(view, event, true),
            keydown: (view, event) => {
              if (event.key !== 'Escape' || !extraPieces(view.state).length) return false;
              view.dispatch(view.state.tr.setMeta(key, []));
              return true;
            },
          },
        },
      }),
    ];
  },
});

function copyPieces(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  if (!extraPieces(view.state).length || !event.clipboardData) return false;
  const pieces = allPieces(view.state);
  const { html, text } = piecesForClipboard(view, pieces);
  event.clipboardData.clearData();
  event.clipboardData.setData('text/html', html);
  event.clipboardData.setData('text/plain', text);
  event.preventDefault();
  if (cut) {
    const tr = view.state.tr;
    for (const piece of [...pieces].reverse()) tr.delete(piece.from, piece.to);
    view.dispatch(tr.scrollIntoView());
  }
  return true;
}
