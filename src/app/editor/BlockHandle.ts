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
  if (selection instanceof NodeSelection && selection.$from.depth === 0) {
    const index = selection.$from.index(0);
    return { start: selection.from, node: selection.node, parent: state.doc, index };
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

// top level position of the block rendered by a direct child of the editor dom
function blockPosition(view: EditorView, element: Element): number | null {
  try {
    const pos = view.posAtDOM(element, 0);
    const $pos = view.state.doc.resolve(pos);
    return $pos.depth === 0 ? pos : $pos.before(1);
  } catch {
    return null;
  }
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
        const target = children.find((child) => {
          if (child.classList.contains('ProseMirror-gapcursor')) return false;
          const rect = child.getBoundingClientRect();
          return event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4;
        });
        if (!target) return;
        const pos = blockPosition(view, target);
        if (pos === null) return;
        current = { element: target, pos };
        const hostRect = host.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(target).lineHeight) || 24;
        const firstLine = Math.min(rect.height, lineHeight);
        handle.style.top = `${rect.top - hostRect.top + firstLine / 2 - 11}px`;
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
