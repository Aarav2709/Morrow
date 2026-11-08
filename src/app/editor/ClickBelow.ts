// clicking the empty space under the last block starts a new line there, the way notion does. a page keeps
// no empty line at its end otherwise, so the last line can always be deleted
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

export function clickBelow(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || event.target !== view.dom || !view.editable) return false;
  const last = view.dom.lastElementChild;
  if (last && event.clientY <= last.getBoundingClientRect().bottom) return false;
  const { doc, schema } = view.state;
  const end = doc.lastChild;
  const empty = end?.type.name === 'paragraph' && end.content.size === 0;
  let tr = view.state.tr;
  if (!empty) tr = tr.insert(doc.content.size, schema.nodes.paragraph!.create());
  tr = tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1)).scrollIntoView();
  view.dispatch(tr);
  view.focus();
  event.preventDefault();
  return true;
}

export const ClickBelow = Extension.create({
  name: 'clickBelow',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('clickBelow'),
        props: { handleDOMEvents: { mousedown: clickBelow } },
      }),
    ];
  },
});
