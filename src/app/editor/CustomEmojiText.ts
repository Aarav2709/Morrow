import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { customEmoji, loadCustomEmoji } from '../customEmoji';

const key = new PluginKey<DecorationSet>('customEmojiText');
const SHORT_NAME = /:([a-z0-9_-]{1,32}):/g;

// :name: in the text, for a picture of your own by that name, is drawn as the picture. the words stay
// :name: in the file, so other apps show what was written
export function customEmojiDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (node.marks.some((mark) => mark.type.name === 'code')) return false;
    const text = node.text ?? '';
    for (const match of text.matchAll(SHORT_NAME)) {
      const own = customEmoji(match[1]!);
      if (!own) continue;
      const from = pos + match.index!;
      decorations.push(
        Decoration.inline(from, from + match[0].length, {
          class: 'custom-emoji',
          style: `background-image: url("${own.url}")`,
          title: match[0],
        }),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export const CustomEmojiText = Extension.create({
  name: 'customEmojiText',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => customEmojiDecorations(state.doc),
          apply: (tr, value) =>
            tr.docChanged || tr.getMeta(key) ? customEmojiDecorations(tr.doc) : value.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
        view(view) {
          // pictures added, removed or loaded after the page opened are drawn once they are known
          const redraw = () => {
            if (!view.isDestroyed)
              view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false));
          };
          window.addEventListener('morrow:custom-emoji', redraw);
          void loadCustomEmoji();
          return { destroy: () => window.removeEventListener('morrow:custom-emoji', redraw) };
        },
      }),
    ];
  },
});
