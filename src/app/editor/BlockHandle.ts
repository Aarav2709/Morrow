import { Extension } from '@tiptap/core';
import { t } from '../i18n';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const MOVABLE_ITEMS = new Set(['listItem', 'taskItem']);

export interface BlockMenuRequest {
  pos: number;
  rect: DOMRect;
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

// every item of a list and every line inside an open toggle is a block of its own, the way notion has it,
// so the handle picks the innermost one under the pointer rather than the whole list or toggle
function innerBlock(element: HTMLElement, y: number): HTMLElement {
  if (element.tagName === 'UL' || element.tagName === 'OL') {
    const item = Array.from(element.children).find(
      (child): child is HTMLElement => child.tagName === 'LI' && contains(child, y),
    );
    if (!item) return element;
    const nested = Array.from(item.querySelectorAll<HTMLElement>('ul, ol')).find(
      (list) => list.parentElement?.closest('li') === item && contains(list, y),
    );
    return nested ? innerBlock(nested, y) : item;
  }
  if (element.dataset.type === 'details') {
    const content = Array.from(element.querySelectorAll<HTMLElement>('[data-type="detailsContent"]')).find(
      (candidate) => candidate.parentElement?.closest('[data-type="details"]') === element,
    );
    if (!content || content.hidden || !contains(content, y)) return element;
    const child = Array.from(content.children).find(
      (candidate): candidate is HTMLElement => candidate instanceof HTMLElement && contains(candidate, y),
    );
    return child ? innerBlock(child, y) : element;
  }
  return element;
}

// the middle of a block's first line of text, which sits lower than its top in a callout, quote or
// code block with padding around it. null for a block with no text, such as a picture
function firstTextMiddle(block: HTMLElement): number | null {
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
  const text = walker.nextNode();
  if (!text) return null;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 1);
  const box = range.getClientRects()[0];
  const top = block.getBoundingClientRect().top;
  // text far down the block belongs to something else, like a caption under a picture
  return box && box.top - top < 80 ? box.top + box.height / 2 : null;
}

function handlePlugin(onMenu: (request: BlockMenuRequest) => void) {
  return new Plugin({
    key: new PluginKey('blockHandle'),
    view(view) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'block-handle';
      handle.draggable = true;
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
        if (!view.editable || !host) return;
        const children = Array.from(view.dom.children) as HTMLElement[];
        const top = children.find((child) => {
          if (child.classList.contains('ProseMirror-gapcursor')) return false;
          const rect = child.getBoundingClientRect();
          return event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4;
        });
        if (!top) return;
        let target = innerBlock(top, event.clientY);
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
        const middle = firstTextMiddle(target) ?? rect.top + Math.min(rect.height, lineHeight) / 2;
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

      const onDragStart = (event: DragEvent) => {
        if (!current || !event.dataTransfer) return;
        const selection = NodeSelection.create(view.state.doc, current.pos);
        view.dispatch(view.state.tr.setSelection(selection));
        const slice = selection.content();
        const { dom, text } = view.serializeForClipboard(slice);
        event.dataTransfer.clearData();
        event.dataTransfer.setData('text/html', dom.innerHTML);
        event.dataTransfer.setData('text/plain', text);
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setDragImage(current.element, 0, 0);
        view.dragging = { slice, move: true };
      };

      const onClick = () => {
        if (!current) return;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, current.pos)));
        view.focus();
        onMenu({ pos: current.pos, rect: handle.getBoundingClientRect() });
      };

      host?.addEventListener('mousemove', onMove);
      host?.addEventListener('mouseleave', onLeave);
      handle.addEventListener('dragstart', onDragStart);
      handle.addEventListener('dragend', hide);
      handle.addEventListener('click', onClick);

      return {
        update() {
          if (current && !current.element.isConnected) hide();
        },
        destroy() {
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
