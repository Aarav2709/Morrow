import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// letters of the scripts written right to left: hebrew, arabic, syriac, thaana, nko and the rest up to
// arabic extended, and the presentation forms of hebrew and arabic
const RIGHT_TO_LEFT = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;

export function hasRightToLeft(text: string): boolean {
  return RIGHT_TO_LEFT.test(text);
}

// a block with arabic or hebrew in it takes its direction from its first letter, the way dir="auto" does,
// so a line in arabic reads from the right while the english around it stays as it was. it is only drawn
// that way and never stored, so the page's file is the same whichever way it reads
function directions(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isBlock || node.isAtom || node.type.spec.code) return false;
    // nothing inside reads from the right, so nothing inside needs a direction either
    if (!hasRightToLeft(node.textContent)) return false;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { dir: 'auto' }));
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

const key = new PluginKey<DecorationSet>('textDirection');

export const TextDirection = Extension.create({
  name: 'autoTextDirection',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => directions(state.doc),
          apply: (tr, old) => {
            if (!tr.docChanged) return old;
            // a page with no right to left words stays that way while what is typed has none either
            const brought = tr.steps.some((step) => {
              const slice = (step as { slice?: { content: PMNode['content'] } }).slice;
              if (!slice) return true;
              return hasRightToLeft(slice.content.textBetween(0, slice.content.size, '\n', ' '));
            });
            if (old === DecorationSet.empty && !brought) return old;
            return directions(tr.doc);
          },
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});
