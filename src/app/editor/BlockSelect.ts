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
export function selectBlockRange(view: EditorView, range: BlockRange | null): void {
  const { tr, doc } = view.state;
  tr.setMeta(key, range);
  if (range) {
    const selection = TextSelection.between(doc.resolve(range.from), doc.resolve(range.to));
    if (selection.from >= range.from && selection.to <= range.to) tr.setSelection(selection);
  }
  view.dispatch(tr);
}

export function clearBlockSelection(editor: Editor): void {
  if (selectedBlocks(editor.state)) selectBlockRange(editor.view, null);
}

interface Band {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// blocks that hold other blocks, which a drag can reach inside to pick some of them
const CONTAINERS = new Set([
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'details',
  'detailsContent',
  'columns',
  'column',
  'blockquote',
  'callout',
]);
// a callout or quote is picked whole once the drag takes in all of it
const BOXES = new Set(['blockquote', 'callout']);
// a list item or toggle is picked whole once the drag takes in its first line, its title
const LED_BY_FIRST = new Set(['listItem', 'taskItem', 'details']);

function crosses(view: EditorView, pos: number, band: Band): boolean {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return false;
  const rect = dom.getBoundingClientRect();
  // thin blocks like dividers get a few pixels of slack so they can be caught, others have to be crossed
  const slack = rect.height < 8 ? 6 : -2;
  return (
    rect.bottom + slack >= band.top &&
    rect.top - slack <= band.bottom &&
    rect.right >= band.left &&
    rect.left <= band.right
  );
}

// the blocks a box drawn from the margin passes over. while it passes over one block that holds others it
// reaches inside, so items of a list, lines in a toggle and blocks in a column can be picked on their own
function blocksIn(view: EditorView, band: Band): BlockRange | null {
  const { doc } = view.state;
  let parent = doc;
  let parentPos = -1;
  for (;;) {
    const hits: Array<{ pos: number; size: number; index: number; node: typeof parent }> = [];
    parent.forEach((child, offset, index) => {
      const pos = parentPos + 1 + offset;
      if (crosses(view, pos, band)) hits.push({ pos, size: child.nodeSize, index, node: child });
    });
    const first = hits[0];
    const last = hits[hits.length - 1];
    if (!first || !last) return null;
    const whole =
      parent !== doc &&
      ((LED_BY_FIRST.has(parent.type.name) && first.index === 0) ||
        (BOXES.has(parent.type.name) && hits.length === parent.childCount));
    if (whole) return { from: parentPos, to: parentPos + parent.nodeSize };
    if (hits.length === 1 && CONTAINERS.has(first.node.type.name)) {
      parent = first.node;
      parentPos = first.pos;
      continue;
    }
    return { from: first.pos, to: last.pos + last.size };
  }
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
    const startX = event.clientX;
    let lastY = event.clientY;
    let lastX = event.clientX;
    let frame = 0;
    // the box being drawn, so it is clear what the drag takes in
    const box = document.createElement('div');
    box.className = 'block-select-box';
    const update = () => {
      const top = Math.min(startY, lastY + scroller.scrollTop) - scroller.scrollTop;
      const bottom = Math.max(startY, lastY + scroller.scrollTop) - scroller.scrollTop;
      const left = Math.min(startX, lastX);
      const right = Math.max(startX, lastX);
      Object.assign(box.style, {
        top: `${top}px`,
        left: `${left}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
      });
      if (!box.isConnected) document.body.append(box);
      const content = view.dom.getBoundingClientRect();
      // a box kept in the margin takes in the whole width of the page, one reaching into the text only
      // what it covers, so it can pick blocks in one column
      const across = right < content.left || left > content.right;
      const range = blocksIn(view, {
        top,
        bottom,
        left: across ? content.left : left,
        right: across ? content.right : right,
      });
      const now = selectedBlocks(view.state);
      if (range && (now?.from !== range.from || now?.to !== range.to)) selectBlockRange(view, range);
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
      lastX = move.clientX;
      if (Math.abs(lastY + scroller.scrollTop - startY) > 4 || selectedBlocks(view.state)) update();
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      box.remove();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (selectedBlocks(view.state)) view.focus();
    };
    if (selectedBlocks(view.state)) selectBlockRange(view, null);
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
            // the outermost blocks inside the range, a picked list item marks the item and not its lines
            state.doc.nodesBetween(range.from, range.to, (node, pos) => {
              if (pos < range.from || pos + node.nodeSize > range.to) return true;
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-block-selected' }));
              return false;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
        view: marginDrag,
      }),
    ];
  },
});
