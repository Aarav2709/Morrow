import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { t } from '../i18n';

// where the column a position is in sits: the columns block, its position and the column's place in it
export function columnAt(
  state: EditorState,
  pos: number,
): { columns: PMNode; at: number; index: number } | null {
  const $pos = state.doc.resolve(Math.min(pos + 1, state.doc.content.size));
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'column' && $pos.node(depth - 1).type.name === 'columns')
      return { columns: $pos.node(depth - 1), at: $pos.before(depth - 1), index: $pos.index(depth - 1) };
  }
  return null;
}

// a column taken out of its place and put back at another, the others keeping their order
export function moveColumn(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  pos: number,
  to: number,
): boolean {
  const found = columnAt(state, pos);
  if (!found) return false;
  const { columns, at, index } = found;
  const target = Math.max(0, Math.min(columns.childCount - 1, to));
  if (target === index) return false;
  const children: PMNode[] = [];
  columns.forEach((child) => children.push(child));
  const [moved] = children.splice(index, 1);
  children.splice(target, 0, moved!);
  const tr = state.tr.replaceWith(at, at + columns.nodeSize, columns.type.create(columns.attrs, children));
  // the cursor goes along with the column
  let start = at + 1;
  for (let i = 0; i < target; i++) start += children[i]!.nodeSize;
  const selection = TextSelection.findFrom(tr.doc.resolve(start + 1), 1);
  if (selection) tr.setSelection(selection);
  dispatch(tr.scrollIntoView());
  return true;
}

const GRIP = `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="5" r="1.2"/><circle cx="7" cy="5" r="1.2"/><circle cx="11" cy="5" r="1.2"/><circle cx="3" cy="9" r="1.2"/><circle cx="7" cy="9" r="1.2"/><circle cx="11" cy="9" r="1.2"/></g></svg>`;

// a grip on top of the column under the pointer. dragging it left or right puts the column in another
// place among the others, a line shows where
function gripPlugin() {
  return new Plugin({
    key: new PluginKey('columnGrip'),
    view(view: EditorView) {
      const host = view.dom.parentElement;
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'column-grip';
      grip.tabIndex = -1;
      grip.setAttribute('aria-label', t('editor.dragColumn'));
      grip.title = t('editor.dragColumn');
      grip.innerHTML = GRIP;
      host?.appendChild(grip);
      let column: HTMLElement | null = null;
      let drag: { from: number; target: number; columns: HTMLElement[] } | null = null;

      const place = () => {
        if (!column || !host) return;
        const box = column.getBoundingClientRect();
        const hostBox = host.getBoundingClientRect();
        grip.style.left = `${box.left + box.width / 2 - hostBox.left - 11}px`;
        grip.style.top = `${box.top - hostBox.top - 16}px`;
        grip.classList.add('is-visible');
      };
      const hide = () => {
        if (drag) return;
        grip.classList.remove('is-visible');
        column = null;
      };
      const onMove = (event: MouseEvent) => {
        if (!view.editable || drag) return;
        if (event.target instanceof Node && grip.contains(event.target)) return;
        const found = (event.target as Element | null)?.closest?.('.column');
        if (found instanceof HTMLElement && view.dom.contains(found)) {
          column = found;
          place();
        } else hide();
      };
      const clearMarks = () =>
        drag?.columns.forEach((item) =>
          item.classList.remove('is-column-drop-before', 'is-column-drop-after'),
        );
      const onPointerMove = (event: PointerEvent) => {
        if (!drag) return;
        clearMarks();
        let target = drag.columns.length - 1;
        for (let index = 0; index < drag.columns.length; index++) {
          const box = drag.columns[index]!.getBoundingClientRect();
          if (event.clientX < box.left + box.width / 2) {
            target = index;
            break;
          }
        }
        drag.target = target;
        const mark = drag.columns[target]!;
        mark.classList.add(
          event.clientX < mark.getBoundingClientRect().left + mark.getBoundingClientRect().width / 2
            ? 'is-column-drop-before'
            : 'is-column-drop-after',
        );
      };
      const finish = (event: PointerEvent) => {
        if (!drag) return;
        const state = drag;
        clearMarks();
        drag = null;
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', finish, true);
        document.documentElement.classList.remove('is-dragging-blocks');
        const box = state.columns[state.target]!.getBoundingClientRect();
        const before = event.clientX < box.left + box.width / 2;
        // the place among the others once the column is taken out of its own
        let to = before ? state.target : state.target + 1;
        if (to > state.from) to -= 1;
        const first = column ? view.posAtDOM(column, 0) : null;
        if (first !== null && to !== state.from) moveColumn(view.state, view.dispatch, first - 1, to);
        hide();
      };
      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || !column) return;
        event.preventDefault();
        const columns = Array.from(column.parentElement?.children ?? []).filter(
          (item): item is HTMLElement => item instanceof HTMLElement && item.classList.contains('column'),
        );
        drag = { from: columns.indexOf(column), target: columns.indexOf(column), columns };
        document.documentElement.classList.add('is-dragging-blocks');
        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', finish, true);
      };
      host?.addEventListener('mousemove', onMove);
      host?.addEventListener('mouseleave', hide);
      grip.addEventListener('pointerdown', onPointerDown);
      return {
        update() {
          if (column && !column.isConnected) hide();
        },
        destroy() {
          host?.removeEventListener('mousemove', onMove);
          host?.removeEventListener('mouseleave', hide);
          window.removeEventListener('pointermove', onPointerMove, true);
          window.removeEventListener('pointerup', finish, true);
          grip.remove();
        },
      };
    },
  });
}

export const ColumnGrip = Extension.create({
  name: 'columnGrip',
  addProseMirrorPlugins() {
    return [gripPlugin()];
  },
});
