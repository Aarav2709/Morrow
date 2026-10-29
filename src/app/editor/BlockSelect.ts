import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

// whole blocks picked by dragging in the page's margin, from the start of the first to the end of the last
export interface BlockRange {
  from: number;
  to: number;
}

const key = new PluginKey<BlockRange | null>('blockSelect');

export function selectedBlocks(state: EditorState): BlockRange | null {
  return key.getState(state) ?? null;
}

// the selected blocks with the cursor's selection spread over them, so copy and typing take them all
function select(view: EditorView, range: BlockRange | null): void {
  const { tr, doc } = view.state;
  tr.setMeta(key, range);
  if (range) {
    const selection = TextSelection.between(doc.resolve(range.from), doc.resolve(range.to));
    if (selection.from >= range.from && selection.to <= range.to) tr.setSelection(selection);
  }
  view.dispatch(tr);
}

export function clearBlockSelection(editor: Editor): void {
  if (selectedBlocks(editor.state)) select(editor.view, null);
}

// the top level blocks a stretch of the page from one height to another passes over
function blocksBetween(view: EditorView, top: number, bottom: number): BlockRange | null {
  let from = -1;
  let to = -1;
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const rect = dom.getBoundingClientRect();
    if (rect.bottom < top || rect.top > bottom) return;
    if (from < 0) from = offset;
    to = offset + node.nodeSize;
  });
  return from < 0 ? null : { from, to };
}

// things in the margin that keep their own clicks
const OWN_CLICKS = 'button, a, input, textarea, select, label, .block-handle, .page-outline, .page-icon-row';

function marginDrag(view: EditorView) {
  const onDown = (event: MouseEvent) => {
    if (event.button !== 0 || !view.editable || !(event.target instanceof Element)) return;
    const scroller = view.dom.closest('.page-scroll');
    if (!scroller?.contains(event.target) || event.target.closest(OWN_CLICKS)) return;
    if (view.dom.contains(event.target)) return;
    const content = view.dom.getBoundingClientRect();
    // only beside the text, not above the title or below the last line
    if (event.clientX >= content.left && event.clientX <= content.right) return;
    if (event.clientY < content.top || event.clientY > content.bottom) return;
    event.preventDefault();
    const startY = event.clientY + scroller.scrollTop;
    let lastY = event.clientY;
    let frame = 0;
    const update = () => {
      const y = lastY + scroller.scrollTop;
      const range = blocksBetween(
        view,
        Math.min(startY, y) - scroller.scrollTop,
        Math.max(startY, y) - scroller.scrollTop,
      );
      const now = selectedBlocks(view.state);
      if (range && (now?.from !== range.from || now?.to !== range.to)) select(view, range);
    };
    // near the top or bottom of the page it keeps scrolling, so long stretches can be picked
    const scroll = () => {
      const box = scroller.getBoundingClientRect();
      const speed = lastY < box.top + 40 ? -12 : lastY > box.bottom - 40 ? 12 : 0;
      if (speed) {
        scroller.scrollTop += speed;
        update();
      }
      frame = requestAnimationFrame(scroll);
    };
    const onMove = (move: MouseEvent) => {
      lastY = move.clientY;
      if (Math.abs(lastY + scroller.scrollTop - startY) > 4 || selectedBlocks(view.state)) update();
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (selectedBlocks(view.state)) view.focus();
    };
    if (selectedBlocks(view.state)) select(view, null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    frame = requestAnimationFrame(scroll);
  };
  document.addEventListener('mousedown', onDown);
  return { destroy: () => document.removeEventListener('mousedown', onDown) };
}

// dragging up or down in the margin beside the text picks whole blocks, the way notion does, so they can
// be turned into something else, copied, moved to the trash or deleted together
export const BlockSelect = Extension.create({
  name: 'blockSelect',
  // ahead of the other backspace keys, which would only take one character
  priority: 1100,
  addKeyboardShortcuts() {
    const remove = ({ editor }: { editor: Editor }) => {
      const range = selectedBlocks(editor.state);
      if (!range) return false;
      return editor.chain().deleteRange(range).run();
    };
    return {
      Backspace: remove,
      Delete: remove,
      Escape: ({ editor }) => {
        if (!selectedBlocks(editor.state)) return false;
        clearBlockSelection(editor);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<BlockRange | null>({
        key,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(key) as BlockRange | null | undefined;
            if (meta !== undefined) return meta;
            // typing, a click or any other change of the selection lets the blocks go
            if (!value || tr.docChanged || tr.selectionSet) return null;
            return value;
          },
        },
        props: {
          decorations(state) {
            const range = key.getState(state);
            if (!range) return null;
            const decorations: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (offset >= range.from && offset + node.nodeSize <= range.to)
                decorations.push(
                  Decoration.node(offset, offset + node.nodeSize, { class: 'is-block-selected' }),
                );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
        view: marginDrag,
      }),
    ];
  },
});
