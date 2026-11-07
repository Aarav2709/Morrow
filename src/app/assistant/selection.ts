// text highlighted in a page and handed to the assistant, so it knows exactly which words to work on and
// changes only those. the range follows edits made meanwhile, and goes when the words themselves are gone
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { useSyncExternalStore } from 'react';
import { markdownToDoc } from '../../core/markdown/parse';
import { docToMarkdown } from '../../core/markdown/serialize';
import type { DocNode, PageId } from '../../core/model';
import type { AssistantToolSpec } from '../platform/desktop';
import { getSession } from '../workspace';
import type { Proposal } from './tools';

export interface AttachedSelection {
  pageId: PageId;
  from: number;
  to: number;
  // the words as they read, and as markdown with their formatting
  text: string;
  markdown: string;
}

let attached: AttachedSelection | null = null;
let editor: Editor | null = null;
let stopFollowing: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: AttachedSelection | null): void {
  attached = next;
  for (const listener of listeners) listener();
}

export function useAttachedSelection(): AttachedSelection | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => attached,
  );
}

export function getAttachedSelection(): AttachedSelection | null {
  return attached && editor && !editor.isDestroyed ? attached : null;
}

function markdownOf(source: Editor, from: number, to: number): string {
  const slice = source.state.doc.slice(from, to);
  const content = slice.content.toJSON() as DocNode[] | null;
  // part of one paragraph comes as an inline run, the rest as whole blocks
  const blocks = (content ?? []).every((node) => node.type === 'text' || node.type === 'hardBreak')
    ? [{ type: 'paragraph', content: content ?? [] }]
    : (content ?? []);
  return docToMarkdown({ type: 'doc', content: blocks }).trim();
}

export function attachSelection(source: Editor, pageId: PageId): boolean {
  const { from, to } = source.state.selection;
  const text = source.state.doc.textBetween(from, to, '\n').trim();
  if (!text) return false;
  clearSelection();
  editor = source;
  const follow = ({ transaction }: { transaction: Transaction }) => {
    if (!attached || !transaction.docChanged) return;
    const next = { ...attached };
    next.from = transaction.mapping.map(attached.from, 1);
    next.to = transaction.mapping.map(attached.to, -1);
    if (next.to <= next.from) set(null);
    else if (next.from !== attached.from || next.to !== attached.to) attached = next;
  };
  source.on('transaction', follow);
  stopFollowing = () => source.off('transaction', follow);
  set({ pageId, from, to, text, markdown: markdownOf(source, from, to) });
  return true;
}

export function clearSelection(): void {
  stopFollowing?.();
  stopFollowing = null;
  editor = null;
  set(null);
}

export const SELECTION_TOOL: AssistantToolSpec = {
  name: 'replace_selection',
  description:
    'Replace the text the user highlighted with new text, leaving everything else in the page as it is. Use it whenever the user asks to change, rewrite, fix, shorten, lengthen or translate the highlighted text. The user approves it first.',
  parameters: {
    type: 'object',
    properties: {
      markdown: {
        type: 'string',
        description: 'Only the new text that takes the place of the highlighted text, in Morrow Markdown.',
      },
    },
    required: ['markdown'],
  },
};

// what the assistant reads with a message while text is highlighted
export function selectionContext(): string | null {
  const selection = getAttachedSelection();
  if (!selection) return null;
  return [
    'The user highlighted this text in the page and is asking about it. To change it, call replace_selection, which replaces exactly this text and nothing else:',
    '<highlighted>',
    selection.markdown,
    '</highlighted>',
  ].join('\n');
}

// the change, shown before it happens. the words are checked again when it is applied
export function proposeSelectionChange(markdown: string): Proposal {
  const selection = getAttachedSelection();
  const target = editor;
  if (!selection || !target)
    throw new Error('Nothing is highlighted any more. Ask the user to highlight it again.');
  const replacement = markdown.trim();
  if (!replacement) throw new Error('The new text is empty.');
  return {
    title: 'Change the highlighted text',
    pageId: selection.pageId,
    before: selection.markdown,
    after: replacement,
    apply: async () => {
      const current = getAttachedSelection();
      if (!current || target.isDestroyed || target !== editor)
        throw new Error('The highlighted text is no longer there.');
      const { from, to } = current;
      if (target.state.doc.textBetween(from, to, '\n').trim() !== current.text)
        throw new Error('The highlighted text changed in the meantime. Ask the user to highlight it again.');
      await getSession().keepVersion(current.pageId);
      const blocks = (markdownToDoc(replacement).content ?? []) as DocNode[];
      const $from = target.state.doc.resolve(from);
      const $to = target.state.doc.resolve(to);
      // inside one paragraph, a one paragraph answer goes in as words rather than as a new block
      const inline = blocks.length === 1 && blocks[0]!.type === 'paragraph' && $from.sameParent($to);
      const content = inline ? (blocks[0]!.content ?? []) : blocks;
      const original = target.state.doc.slice(from, to);
      const sizeBefore = target.state.doc.content.size;
      target.chain().insertContentAt({ from, to }, content).run();
      const end = to + (target.state.doc.content.size - sizeBefore);
      clearSelection();
      return {
        pageId: current.pageId,
        message: 'Replaced the highlighted text. The earlier version is kept in the page history.',
        undo: () => {
          if (target.isDestroyed || end > target.state.doc.content.size) return;
          target.view.dispatch(target.state.tr.replace(from, end, original));
        },
      };
    },
  };
}
