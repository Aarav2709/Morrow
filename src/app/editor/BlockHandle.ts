import { Extension } from '@tiptap/core';
import { t } from '../i18n';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { dropPoint } from '@tiptap/pm/transform';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { selectedBlocks } from './BlockSelect';

const MOVABLE_ITEMS = new Set(['listItem', 'taskItem']);

export interface BlockMenuRequest {
  pos: number;
  rect: DOMRect;
  // several blocks the selected words run across, which turn together
  range?: { from: number; to: number };
}

// finds the block the selection is in, preferring the nearest list item
function movableBlock(
  state: EditorState,
): { start: number; node: PMNode; parent: PMNode; index: number } | null {
  const { selection } = state;
  // a block picked by its handle, which can be one item of a list or a line inside a toggle
  if (selection instanceof NodeSelection) {
    const { $from } = selection;
    return { start: selection.from, node: selection.node, parent: $from.parent, index: $from.index() };
  }
  const { $from } = selection;
  let depth = 0;
  for (let d = $from.depth; d > 0; d--) {
    if (MOVABLE_ITEMS.has($from.node(d).type.name)) {
      depth = d;
      break;
    }
  }
  if (depth === 0) depth = Math.min(1, $from.depth);
  if (depth === 0) return null;
  return {
    start: $from.before(depth),
    node: $from.node(depth),
    parent: $from.node(depth - 1),
    index: $from.index(depth - 1),
  };
}

export function moveBlock(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  direction: -1 | 1,
): boolean {
  const block = movableBlock(state);
  if (!block) return false;
  const targetIndex = block.index + direction;
  if (targetIndex < 0 || targetIndex >= block.parent.childCount) return false;
  if (!dispatch) return true;
  const { start, node } = block;
  const sibling = block.parent.child(targetIndex);
  const tr = state.tr.delete(start, start + node.nodeSize);
  const insertAt = direction < 0 ? start - sibling.nodeSize : start + sibling.nodeSize;
  tr.insert(insertAt, node);
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    tr.setSelection(NodeSelection.create(tr.doc, insertAt + (selection.from - start)));
  } else {
    const from = insertAt + (selection.from - start);
    const to = insertAt + (selection.to - start);
    tr.setSelection(TextSelection.create(tr.doc, from, to));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

const GRIP = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="currentColor"><circle cx="5" cy="3" r="1.2"/><circle cx="9" cy="3" r="1.2"/><circle cx="5" cy="7" r="1.2"/><circle cx="9" cy="7" r="1.2"/><circle cx="5" cy="11" r="1.2"/><circle cx="9" cy="11" r="1.2"/></g></svg>`;

// position of the block a handle element stands for, at any depth
function blockPosition(view: EditorView, element: Element, topLevel: boolean): number | null {
  try {
    const pos = view.posAtDOM(element, 0);
    if (view.nodeDOM(pos) === element) return pos;
    const $pos = view.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth--)
      if (view.nodeDOM($pos.before(depth)) === element) return $pos.before(depth);
    if (!topLevel) return null;
    return $pos.depth === 0 ? pos : $pos.before(1);
  } catch {
    return null;
  }
}

function contains(element: Element, y: number): boolean {
  const rect = element.getBoundingClientRect();
  return y >= rect.top && y < rect.bottom;
}

// every item of a list, every line inside an open toggle and every block in a column is a block of its own,
// the way notion has it, so the handle picks the innermost one under the pointer rather than the whole
// list, toggle or row of columns
function innerBlock(element: HTMLElement, y: number, x: number): HTMLElement {
  if (element.hasAttribute('data-columns')) {
    const column = Array.from(element.children).find((child): child is HTMLElement => {
      if (!(child instanceof HTMLElement) || !child.hasAttribute('data-column')) return false;
      const rect = child.getBoundingClientRect();
      return x >= rect.left && x <= rect.right;
    });
    if (!column) return element;
    const child = Array.from(column.children).find(
      (candidate): candidate is HTMLElement => candidate instanceof HTMLElement && contains(candidate, y),
    );
    return child ? innerBlock(child, y, x) : element;
  }
  if (element.tagName === 'UL' || element.tagName === 'OL') {
    const item = Array.from(element.children).find(
      (child): child is HTMLElement => child.tagName === 'LI' && contains(child, y),
    );
    if (!item) return element;
    const nested = Array.from(item.querySelectorAll<HTMLElement>('ul, ol')).find(
      (list) => list.parentElement?.closest('li') === item && contains(list, y),
    );
    return nested ? innerBlock(nested, y, x) : item;
  }
  if (element.dataset.type === 'details') {
    const content = Array.from(element.querySelectorAll<HTMLElement>('[data-type="detailsContent"]')).find(
      (candidate) => candidate.parentElement?.closest('[data-type="details"]') === element,
    );
    if (!content || content.hidden || !contains(content, y)) return element;
    const child = Array.from(content.children).find(
      (candidate): candidate is HTMLElement => candidate instanceof HTMLElement && contains(candidate, y),
    );
    return child ? innerBlock(child, y, x) : element;
  }
  return element;
}

const BOXED = '.callout, .code-block';
const BOXED_INSET = 6;

// the middle of a block's first line of text, which sits lower than its top in a callout, quote or
// code block with padding around it. null for a block with no text, such as a picture
function firstTextMiddle(block: HTMLElement): number | null {
  // a database or canvas shown in the page lines up with its title, not the line it sits in
  const head = block.querySelector('.page-embed.is-live .inline-database-head');
  if (head) {
    const rect = head.getBoundingClientRect();
    return rect.top + rect.height / 2;
  }
  // a table lines up with its first row, the header, whatever is written in it
  const row = block.matches('table, .tableWrapper') ? block.querySelector('tr') : null;
  if (row) {
    const rect = row.getBoundingClientRect();
    return rect.top + Math.min(rect.height, 40) / 2;
  }
  // a checklist item lines up with its box
  const checkbox = block.tagName === 'LI' ? block.querySelector(':scope > label') : null;
  if (checkbox) {
    const rect = checkbox.getBoundingClientRect();
    return rect.top + rect.height / 2;
  }
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.textContent?.trim() && !node.parentElement?.closest('select, button, .katex-mathml')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
  });
  const top = block.getBoundingClientRect().top;
  const range = document.createRange();
  // text that isn't drawn, like the hidden link above a database shown in the page, is passed over
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const box = range.getClientRects()[0];
    if (!box) continue;
    // text far down the block belongs to something else, like a caption under a picture
    return box.top - top < 80 ? box.top + box.height / 2 : null;
  }
  return null;
}

// the blocks the selected words run across, when they run across more than one: the items of a list, the
// lines in a toggle, or blocks on the page
export function selectedTextBlocks(state: EditorState): { from: number; to: number } | null {
  const { $from, $to, empty } = state.selection;
  if (empty) return null;
  const range = $from.blockRange($to);
  if (!range || range.endIndex - range.startIndex < 2) return null;
  return { from: range.start, to: range.end };
}

function handlePlugin(onMenu: (request: BlockMenuRequest) => void) {
  return new Plugin({
    key: new PluginKey('blockHandle'),
    view(view) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'block-handle';
      // dragged with the pointer rather than the system's drag and drop, whose picture of the block trailed
      // behind the cursor in the web views morrow runs in
      handle.draggable = false;
      handle.tabIndex = -1;
      handle.setAttribute('aria-label', t('editor.dragToMoveAria'));
      handle.innerHTML = GRIP;
      const host = view.dom.parentElement;
      host?.appendChild(handle);
      let current: { element: HTMLElement; pos: number } | null = null;

      const hide = () => {
        handle.classList.remove('is-visible');
        current = null;
      };

      const onMove = (event: MouseEvent) => {
        if (!view.editable || !host || drag?.started) return;
        // the pointer on its way to the handle stays with the block the handle is for. a block in the second
        // column has its handle over the first, which would otherwise take the handle back to itself
        if (event.target instanceof Node && handle.contains(event.target)) return;
        // and so does the pointer crossing the gap between the block and its handle
        if (current?.element.isConnected && handle.classList.contains('is-visible')) {
          const box = current.element.getBoundingClientRect();
          const grip = handle.getBoundingClientRect();
          if (
            event.clientX >= grip.left - 4 &&
            event.clientX < box.left &&
            event.clientY >= Math.min(box.top, grip.top) - 4 &&
            event.clientY <= Math.max(grip.bottom, Math.min(box.bottom, grip.bottom + 24)) + 4
          )
            return;
        }
        const children = Array.from(view.dom.children) as HTMLElement[];
        const top = children.find((child) => {
          if (child.classList.contains('ProseMirror-gapcursor')) return false;
          const rect = child.getBoundingClientRect();
          return event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4;
        });
        if (!top) return;
        let target = innerBlock(top, event.clientY, event.clientX);
        let pos = blockPosition(view, target, target === top);
        if (pos === null) {
          target = top;
          pos = blockPosition(view, top, true);
        }
        if (pos === null) return;
        current = { element: target, pos };
        const hostRect = host.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(target).lineHeight) || 24;
        // a boxed block, a callout or code, has its handle at the top of the box, where the block begins,
        // whatever the text inside it starts with
        const middle = target.matches(BOXED)
          ? rect.top + BOXED_INSET + 11
          : (firstTextMiddle(target) ?? rect.top + Math.min(rect.height, lineHeight) / 2);
        handle.style.top = `${middle - hostRect.top - 11}px`;
        // a nested block keeps its handle beside it, left of the bullet for a list item
        const anchor = target.tagName === 'LI' ? (target.parentElement ?? target) : target;
        const indent = anchor.getBoundingClientRect().left - top.getBoundingClientRect().left;
        handle.style.transform = indent > 0 ? `translateX(${indent}px)` : '';
        handle.classList.add('is-visible');
      };

      const onLeave = (event: MouseEvent) => {
        if (
          event.relatedTarget instanceof Node &&
          (handle.contains(event.relatedTarget) || host?.contains(event.relatedTarget))
        )
          return;
        hide();
      };

      // the blocks a drag takes: the ones picked in the margin, or the lines the selected words run across,
      // when the handle is on one of them, otherwise the block beside the handle
      const dragRange = (pos: number): { from: number; to: number } | null => {
        const { state } = view;
        const picked = selectedBlocks(state);
        if (picked && pos >= picked.from && pos < picked.to) return picked;
        const range = selectedTextBlocks(state);
        return range && pos >= range.from && pos < range.to ? range : null;
      };

      // a drag of the handle moves the blocks. a light copy follows the pointer and a line shows where they
      // land, both drawn once a frame, and the page scrolls by itself near its top or bottom edge
      let drag: {
        from: number;
        to: number;
        startX: number;
        startY: number;
        x: number;
        y: number;
        started: boolean;
        ghost: HTMLElement | null;
        line: HTMLElement | null;
        frame: number;
        target: { view: EditorView; pos: number } | null;
        sources: HTMLElement[];
      } | null = null;
      // the click that ends a drag is not a click on the handle
      let dragged = false;

      const editorAt = (x: number, y: number): EditorView | null => {
        const element = document.elementFromPoint(x, y)?.closest('.ProseMirror') as
          (HTMLElement & { editor?: { view: EditorView; isEditable: boolean } }) | null;
        const other = element?.editor;
        if (element === view.dom || !other) return element === view.dom ? view : null;
        return other.isEditable ? other.view : null;
      };

      const dropTarget = (x: number, y: number): { view: EditorView; pos: number } | null => {
        if (!drag) return null;
        const over = editorAt(x, y) ?? view;
        const box = over.dom.getBoundingClientRect();
        // beside the text, in the margin, still drops on the line at that height
        const left = Math.min(Math.max(x, box.left + 4), box.right - 4);
        const at = over.posAtCoords({ left, top: y });
        if (!at) return null;
        const slice = view.state.doc.slice(drag.from, drag.to);
        const pos = dropPoint(over.state.doc, at.pos, slice);
        if (pos === null) return null;
        // the blocks dropped on themselves stay where they are
        if (over === view && pos >= drag.from && pos <= drag.to) return null;
        return { view: over, pos };
      };

      // the edge between blocks the drop goes in at, as a line across the block below or above it
      const drawLine = (target: { view: EditorView; pos: number } | null) => {
        if (!drag?.line) return;
        if (!target) {
          drag.line.style.display = 'none';
          return;
        }
        const $pos = target.view.state.doc.resolve(target.pos);
        const after = $pos.nodeAfter ? target.view.nodeDOM(target.pos) : null;
        const before = $pos.nodeBefore ? target.view.nodeDOM(target.pos - $pos.nodeBefore.nodeSize) : null;
        let rect: { left: number; width: number; top: number };
        if (after instanceof HTMLElement) {
          const box = after.getBoundingClientRect();
          rect = { left: box.left, width: box.width, top: box.top - 2 };
        } else if (before instanceof HTMLElement) {
          const box = before.getBoundingClientRect();
          rect = { left: box.left, width: box.width, top: box.bottom + 1 };
        } else {
          const coords = target.view.coordsAtPos(target.pos);
          const box = target.view.dom.getBoundingClientRect();
          rect = { left: box.left, width: box.width, top: coords.top };
        }
        drag.line.style.display = 'block';
        drag.line.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
        drag.line.style.width = `${rect.width}px`;
      };

      const scroller = () => view.dom.closest<HTMLElement>('.page-scroll');

      const frame = () => {
        if (!drag?.started) return;
        drag.frame = 0;
        if (drag.ghost) drag.ghost.style.transform = `translate(${drag.x + 14}px, ${drag.y + 6}px)`;
        // near the top or bottom of the page it scrolls, faster the closer the pointer is to the edge
        const page = scroller();
        let scrolling = false;
        if (page) {
          const box = page.getBoundingClientRect();
          const edge = 48;
          const step =
            drag.y < box.top + edge
              ? -Math.ceil((box.top + edge - drag.y) / 3)
              : drag.y > box.bottom - edge
                ? Math.ceil((drag.y - (box.bottom - edge)) / 3)
                : 0;
          if (step) {
            const before = page.scrollTop;
            page.scrollTop += step;
            scrolling = page.scrollTop !== before;
          }
        }
        drag.target = dropTarget(drag.x, drag.y);
        drawLine(drag.target);
        if (scrolling) drag.frame = requestAnimationFrame(frame);
      };

      const startDrag = () => {
        if (!drag || !current) return;
        drag.started = true;
        dragged = true;
        hide();
        // the blocks being moved fade where they are
        view.state.doc.nodesBetween(drag.from, drag.to, (node, pos) => {
          if (pos < drag!.from || pos + node.nodeSize > drag!.to) return true;
          const dom = view.nodeDOM(pos);
          if (dom instanceof HTMLElement) {
            dom.classList.add('is-drag-source');
            drag!.sources.push(dom);
          }
          return false;
        });
        const ghost = document.createElement('div');
        ghost.className = 'block-drag-ghost';
        const text = view.state.doc.textBetween(drag.from, drag.to, ' ', ' ').trim();
        ghost.textContent = text.length > 90 ? `${text.slice(0, 90)}…` : text || '…';
        const count = drag.sources.length;
        if (count > 1) ghost.dataset.count = String(count);
        const line = document.createElement('div');
        line.className = 'block-drop-line';
        document.body.append(ghost, line);
        drag.ghost = ghost;
        drag.line = line;
        document.documentElement.classList.add('is-dragging-blocks');
      };

      const endDrag = (drop: boolean) => {
        if (!drag) return;
        const state = drag;
        const target = drop && state.started ? dropTarget(state.x, state.y) : null;
        drag = null;
        if (state.frame) cancelAnimationFrame(state.frame);
        state.ghost?.remove();
        state.line?.remove();
        state.sources.forEach((dom) => dom.classList.remove('is-drag-source'));
        document.documentElement.classList.remove('is-dragging-blocks');
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerCancel, true);
        window.removeEventListener('keydown', onDragKey, true);
        if (!target) return;
        const slice = view.state.doc.slice(state.from, state.to);
        if (target.view === view) {
          const tr = view.state.tr.delete(state.from, state.to);
          const at = tr.mapping.map(target.pos);
          tr.replaceRange(at, at, slice);
          const landed = TextSelection.findFrom(
            tr.doc.resolve(Math.min(at + 1, tr.doc.content.size)),
            1,
            true,
          );
          if (landed) tr.setSelection(landed);
          view.dispatch(tr);
          view.focus();
          return;
        }
        // into the page on the other side of a split, taken out of this one
        const into = target.view.state.tr.replaceRange(target.pos, target.pos, slice);
        target.view.dispatch(into);
        view.dispatch(view.state.tr.delete(state.from, state.to));
        target.view.focus();
      };

      const onPointerMove = (event: PointerEvent) => {
        if (!drag) return;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (!drag.started) {
          if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
          startDrag();
        }
        event.preventDefault();
        if (!drag.frame) drag.frame = requestAnimationFrame(frame);
      };
      const onPointerUp = () => endDrag(true);
      const onPointerCancel = () => endDrag(false);
      const onDragKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        endDrag(false);
      };

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || !current || !view.editable) return;
        dragged = false;
        const range = dragRange(current.pos) ?? {
          from: current.pos,
          to: current.pos + (view.state.doc.nodeAt(current.pos)?.nodeSize ?? 0),
        };
        if (range.to <= range.from) return;
        // the press would otherwise take the focus and the selection with it
        event.preventDefault();
        drag = {
          ...range,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          started: false,
          ghost: null,
          line: null,
          frame: 0,
          target: null,
          sources: [],
        };
        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerCancel, true);
        window.addEventListener('keydown', onDragKey, true);
      };

      const onClick = () => {
        if (dragged) {
          dragged = false;
          return;
        }
        if (!current) return;
        // a block among several picked in the margin, or among the lines the selected words run across,
        // opens the menu for all of them
        const range = dragRange(current.pos);
        if (!range)
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, current.pos)));
        view.focus();
        onMenu({
          pos: current.pos,
          rect: handle.getBoundingClientRect(),
          ...(range && !selectedBlocks(view.state) ? { range } : {}),
        });
      };

      host?.addEventListener('mousemove', onMove);
      host?.addEventListener('mouseleave', onLeave);
      handle.addEventListener('pointerdown', onPointerDown);
      handle.addEventListener('click', onClick);

      return {
        update() {
          if (drag) return;
          if (current && !current.element.isConnected) hide();
        },
        destroy() {
          endDrag(false);
          host?.removeEventListener('mousemove', onMove);
          host?.removeEventListener('mouseleave', onLeave);
          handle.remove();
        },
      };
    },
  });
}

export const BlockHandle = Extension.create<{ onMenu: (request: BlockMenuRequest) => void }>({
  name: 'blockHandle',
  addOptions() {
    return { onMenu: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      'Alt-Shift-ArrowUp': ({ editor }) => moveBlock(editor.state, editor.view.dispatch, -1),
      'Alt-Shift-ArrowDown': ({ editor }) => moveBlock(editor.state, editor.view.dispatch, 1),
    };
  },
  addProseMirrorPlugins() {
    return [handlePlugin(this.options.onMenu)];
  },
});
