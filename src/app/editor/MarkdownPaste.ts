import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { markdownToDoc } from '../../core/markdown/parse';
import type { PageId } from '../../core/model';

const MARKDOWN_HINTS = [
  /^#{1,6}\s+\S/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+[.)]\s+\S/m,
  /^\s*>\s?\S/m,
  /^```/m,
  /^\s*\|.+\|\s*$/m,
  /\*\*[^*\n]+\*\*/,
  /\[[^\]\n]+\]\([^)\s]+\)/,
];

export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINTS.some((pattern) => pattern.test(text));
}

// a checkbox written as text, the way notion copies its to-do items: [ ] or [x], or [] for an empty one
const TASK_PREFIX = /^\[([ \u00a0xX]?)\]\s*/;

function checklistFrom(schema: Schema, list: PMNode): PMNode | null {
  const { taskList, taskItem } = schema.nodes;
  if (!taskList || !taskItem || list.childCount === 0) return null;
  const items: PMNode[] = [];
  for (let index = 0; index < list.childCount; index++) {
    const item = list.child(index);
    const first = item.firstChild;
    const match = first?.isTextblock ? TASK_PREFIX.exec(first.textContent) : null;
    if (!first || !match) return null;
    const line = first.cut(match[0].length);
    const rest: PMNode[] = [line];
    item.forEach((child, _offset, at) => {
      if (at > 0)
        rest.push(child.type.name === 'bulletList' ? (checklistFrom(schema, child) ?? child) : child);
    });
    items.push(taskItem.create({ checked: /x/i.test(match[1] ?? '') }, rest));
  }
  return taskList.create(null, items);
}

// bullet lists whose every item starts with a written checkbox become real checklists
function realChecklists(schema: Schema, fragment: Fragment): Fragment {
  const children: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.isLeaf) return children.push(node);
    const list = node.type.name === 'bulletList' ? checklistFrom(schema, node) : null;
    children.push(list ?? node.copy(realChecklists(schema, node.content)));
  });
  return Fragment.from(children);
}

// plain text that looks like markdown is converted into real blocks on paste
export const MarkdownPaste = Extension.create<{ resolvePage: (title: string) => PageId | null }>({
  name: 'markdownPaste',
  addOptions() {
    return { resolvePage: () => null };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const options = this.options;
    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          transformPasted(slice) {
            const content = realChecklists(editor.schema, slice.content);
            return content.eq(slice.content) ? slice : new Slice(content, slice.openStart, slice.openEnd);
          },
          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data || data.types.includes('text/html')) return false;
            const text = data.getData('text/plain');
            if (!text || !looksLikeMarkdown(text)) return false;
            if (view.state.selection.$from.parent.type.name === 'codeBlock') return false;
            const doc = markdownToDoc(text, { resolvePage: options.resolvePage });
            return editor.commands.insertContent(doc.content ?? []);
          },
        },
      }),
    ];
  },
});
