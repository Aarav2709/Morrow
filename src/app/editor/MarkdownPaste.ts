import { Extension } from '@tiptap/core';
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
