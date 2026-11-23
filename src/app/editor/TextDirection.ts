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

// the direction a run of text starts in, from its first letter, the way dir="auto" decides
export function directionOf(text: string): 'rtl' | 'ltr' {
  const first = /\p{L}/u.exec(text)?.[0];
  return first !== undefined && hasRightToLeft(first) ? 'rtl' : 'ltr';
}

// a block with arabic or hebrew in it takes its direction from its first letter, so a line in arabic reads
// from the right while the english around it stays as it was. the direction is worked out here rather than
// left to dir="auto", which skips anything inside that has a direction of its own, so a list would never
// see its items' words and keep its bullets on the left. it is only drawn that way and never stored, so the
// page's file is the same whichever way it reads
function directions(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  // blocks given a direction. what is inside one needs its own too, or an english list in an arabic toggle
  // would take the toggle's direction and read from the right
  const given = new Set<PMNode>();
  doc.descendants((node, pos, parent) => {
    if (!node.isBlock || node.isAtom || node.type.spec.code) return false;
    const text = node.textContent;
    const inside = parent !== null && given.has(parent);
    // nothing inside reads from the right and nothing around it does, so nothing here needs a direction
    if (!inside && !hasRightToLeft(text)) return false;
    // an empty line keeps the direction around it, so the cursor starts where the words around it do
    if (!/\p{L}/u.test(text)) return false;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { dir: directionOf(text) }));
    given.add(node);
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
