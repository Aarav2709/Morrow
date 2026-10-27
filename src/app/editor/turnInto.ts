import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { getPreferences } from '../platform/preferences';

export type TurnTarget =
  | { kind: 'paragraph' }
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'bulletList' | 'orderedList' | 'taskList' | 'blockquote' | 'codeBlock' | 'toggle' };

const LIST_ITEMS = new Set(['listItem', 'taskItem']);
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

// the inline content of a line, kept to what the new block can hold. a toggle's title only takes text
function lineContent(type: Schema['nodes'][string], line: PMNode): Fragment {
  if (type.validContent(line.content)) return line.content;
  const kept: PMNode[] = [];
  line.content.forEach((child) => {
    if (child.isText && type.contentMatch.matchType(child.type)) kept.push(child);
    else if (child.textContent) kept.push(type.schema.text(child.textContent, child.marks));
  });
  return Fragment.from(kept);
}

// what one list item becomes, with whatever was nested under it after it, or folded inside a toggle
function convertItem(schema: Schema, item: PMNode, target: TurnTarget): PMNode[] | null {
  const { nodes } = schema;
  const first = item.firstChild;
  if (!first?.isTextblock) return null;
  const rest = item.content.cut(first.nodeSize);
  const after = (block: PMNode) => {
    const children: PMNode[] = [block];
    rest.forEach((child) => children.push(child));
    return children;
  };
  switch (target.kind) {
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const itemType = target.kind === 'taskList' ? nodes.taskItem : nodes.listItem;
      const listType = nodes[target.kind];
      if (!itemType || !listType) return null;
      const attrs = target.kind === 'taskList' ? { checked: item.attrs.checked === true } : null;
      return [listType.create(null, itemType.create(attrs, item.content))];
    }
    case 'paragraph':
      return nodes.paragraph ? after(nodes.paragraph.create(null, first.content)) : null;
    case 'heading':
      return nodes.heading
        ? after(nodes.heading.create({ level: target.level }, lineContent(nodes.heading, first)))
        : null;
    case 'blockquote':
      return nodes.blockquote && nodes.paragraph
        ? after(nodes.blockquote.create(null, nodes.paragraph.create(null, first.content)))
        : null;
    case 'codeBlock': {
      if (!nodes.codeBlock) return null;
      const text = first.textContent;
      return after(
        nodes.codeBlock.create(
          { language: getPreferences().codeLanguage || null },
          text ? schema.text(text) : null,
        ),
      );
    }
    case 'toggle': {
      const { details, detailsSummary, detailsContent, paragraph } = nodes;
      if (!details || !detailsSummary || !detailsContent || !paragraph) return null;
      return [
        details.create({ open: true }, [
          detailsSummary.create(null, lineContent(detailsSummary, first)),
          detailsContent.create(null, rest.size ? rest : paragraph.create()),
        ]),
      ];
    }
  }
}

// turns one item of a list into something else the way notion does. the list is cut around it, so the
// items before and after stay as they were, nested lists keep their place under their parent item, and
// an item that becomes a list of another kind joins a list of that kind right next to it
export function turnListItem(editor: Editor, pos: number, target: TurnTarget): boolean {
  const { state } = editor;
  const item = state.doc.nodeAt(pos);
  if (!item || !LIST_ITEMS.has(item.type.name)) return false;
  const $pos = state.doc.resolve(pos);
  const list = $pos.parent;
  if (!LISTS.has(list.type.name)) return false;
  const index = $pos.index();
  const listPos = $pos.before();
  const converted = convertItem(state.schema, item, target);
  if (!converted) return false;

  const before = index > 0 ? list.copy(list.content.cut(0, $pos.parentOffset)) : null;
  const afterStart = $pos.parentOffset + item.nodeSize;
  const after = afterStart < list.content.size ? list.copy(list.content.cut(afterStart)) : null;
  const middle = [...converted];
  let merged: PMNode | null = before;
  let cursorFrom = listPos + (before ? before.nodeSize : 0);
  // a new list next to a list of the same kind becomes part of it
  const head = middle[0]!;
  if (before && LISTS.has(head.type.name) && head.type === before.type) {
    cursorFrom = listPos + 1 + before.content.size;
    merged = before.copy(before.content.append(head.content));
    middle.shift();
  }
  const blocks = [...(merged ? [merged] : []), ...middle];
  const last = blocks[blocks.length - 1]!;
  if (after && LISTS.has(last.type.name) && last.type === after.type)
    blocks[blocks.length - 1] = last.copy(last.content.append(after.content));
  else if (after) blocks.push(after);

  const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, blocks);
  const selection = TextSelection.findFrom(tr.doc.resolve(Math.min(cursorFrom, tr.doc.content.size)), 1);
  if (selection) tr.setSelection(selection);
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

// the list item the cursor is writing the first line of, so a / command there changes only that item
export function listItemAtCursor(editor: Editor): number | null {
  const { $from, empty } = editor.state.selection;
  if (!empty || !$from.parent.isTextblock || $from.depth < 2) return null;
  const item = $from.node($from.depth - 1);
  if (!LIST_ITEMS.has(item.type.name) || $from.index($from.depth - 1) !== 0) return null;
  return $from.before($from.depth - 1);
}
