import { mergeAttributes, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Suggestion from '@tiptap/suggestion';
import { CalendarDays, FileText } from 'lucide-react';
import { dateKey, parseDateKey } from '../../core/daily';
import type { MenuItem } from './SuggestionMenu';
import { renderSuggestion } from './SuggestionMenu';
import { dateLocale, t } from '../i18n';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      setColumns: (count: number) => ReturnType;
    };
  }
}

// side by side blocks, each column holds any blocks
export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,4}',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-columns': '',
        class: 'columns',
        style: `--columns: ${node.childCount}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setColumns:
        (count) =>
        ({ chain, state }) => {
          const start = state.selection.from;
          return (
            chain()
              .insertContent({
                type: 'columns',
                content: Array.from({ length: Math.min(4, Math.max(2, count)) }, () => ({
                  type: 'column',
                  content: [{ type: 'paragraph' }],
                })),
              })
              // typing carries on in the first column
              .command(({ tr }) => {
                let target: number | null = null;
                tr.doc.nodesBetween(Math.max(0, start - 2), tr.doc.content.size, (node, pos) => {
                  if (target !== null) return false;
                  if (node.type.name === 'column') {
                    target = pos + 2;
                    return false;
                  }
                  return true;
                });
                if (target !== null) tr.setSelection(TextSelection.near(tr.doc.resolve(target)));
                return true;
              })
              .run()
          );
        },
    };
  },
});

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-column]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '', class: 'column' }), 0];
  },
});

// a live list of the page's headings, each one jumps to its section
// every heading gets an id, unique to its editor, so a table of contents can link to it. links inside the
// page are kept when it is saved as a pdf, there they jump to the heading
function headingIds(doc: PMNode, prefix: string): DecorationSet {
  const decorations: Decoration[] = [];
  let index = 0;
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { id: `${prefix}-${index++}` }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

let editors = 0;

export const TableOfContents = Node.create<object, { prefix: string }>({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'nav[data-toc]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['nav', mergeAttributes(HTMLAttributes, { 'data-toc': '', class: 'toc' })];
  },

  addStorage() {
    return { prefix: `heading-${(editors++).toString(36)}` };
  },

  addProseMirrorPlugins() {
    const prefix = this.storage.prefix;
    return [
      new Plugin<DecorationSet>({
        key: new PluginKey('headingIds'),
        state: {
          init: (_config, state) => headingIds(state.doc, prefix),
          apply: (tr, value) => (tr.docChanged ? headingIds(tr.doc, prefix) : value),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },

  addNodeView() {
    return ({ editor }) => {
      const prefix = (editor.storage as unknown as Record<string, { prefix: string }>).tableOfContents!
        .prefix;
      const dom = document.createElement('nav');
      dom.className = 'toc';
      dom.contentEditable = 'false';
      dom.setAttribute('aria-label', t('slash.items.toc.title'));
      let last = '';
      const render = () => {
        const headings: Array<{ level: number; text: string; pos: number }> = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'heading')
            headings.push({ level: Number(node.attrs.level), text: node.textContent, pos });
          return node.type.name !== 'heading';
        });
        const key = JSON.stringify(headings.map((heading) => [heading.level, heading.text]));
        if (key === last) return;
        last = key;
        dom.replaceChildren();
        if (!headings.length) {
          const empty = document.createElement('p');
          empty.className = 'toc-empty';
          empty.textContent = t('editor.tocEmpty');
          dom.append(empty);
          return;
        }
        headings.forEach((heading, index) => {
          const item = document.createElement('a');
          item.href = `#${prefix}-${index}`;
          item.className = `toc-item toc-${Math.min(3, heading.level)}`;
          item.textContent = heading.text || 'Untitled heading';
          item.addEventListener('click', (event) => {
            event.preventDefault();
            // positions move as the page changes, so the heading is found again by its place in the list
            let seen = 0;
            let target: number | null = null;
            editor.state.doc.descendants((node, pos) => {
              if (target !== null) return false;
              if (node.type.name === 'heading') {
                if (seen === index) target = pos;
                seen++;
                return false;
              }
              return true;
            });
            if (target === null) return;
            const element = editor.view.nodeDOM(target) as HTMLElement | null;
            element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
          dom.append(item);
        });
      };
      render();
      editor.on('update', render);
      return {
        dom,
        stopEvent: (event) => event.type === 'click' || event.type === 'mousedown',
        ignoreMutation: () => true,
        destroy: () => {
          editor.off('update', render);
        },
      };
    };
  },
});

export interface DateMentionOptions {
  openDate: (date: Date) => void;
  findPages: (query: string) => Array<{ id: string; title: string; path: string }>;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function describeDate(key: string, today = new Date()): string {
  const date = parseDateKey(key);
  if (!date) return key;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((date.getTime() - start.getTime()) / 86_400_000);
  if (days === 0) return t('daily.today');
  if (days === 1) return t('daily.tomorrow');
  if (days === -1) return t('daily.yesterday');
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString(dateLocale(), {
    ...(days > 1 && days < 7 ? { weekday: 'long' } : {}),
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// dates the @ menu offers for what was typed, like "fri", "next week" or "2026-12-01"
export function dateSuggestions(query: string, today = new Date()): Date[] {
  const at = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const text = query.trim().toLowerCase();
  const all: Array<[string, Date]> = [
    ['today', at(0)],
    ['tomorrow', at(1)],
    ['yesterday', at(-1)],
    ['next week', at(7)],
  ];
  for (let offset = 1; offset <= 7; offset++) {
    const date = at(offset);
    all.push([WEEKDAYS[date.getDay()]!, date]);
  }
  const exact = parseDateKey(text);
  if (exact) return [exact];
  const typed = text ? new Date(`${text} ${today.getFullYear()}`) : null;
  const matches = all.filter(
    ([name]) => !text || name.startsWith(text) || name.split(' ').some((word) => word.startsWith(text)),
  );
  const dates = matches.map(([, date]) => date);
  if (typed && !Number.isNaN(typed.getTime()) && /\d/.test(text)) dates.unshift(typed);
  const seen = new Set<string>();
  return dates
    .filter((date) => {
      const key = dateKey(date);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, text ? 6 : 4);
}

// @today and friends, a date that opens that day's note
export const DateMention = Node.create<DateMentionOptions>({
  name: 'dateMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { openDate: () => {}, findPages: () => [] };
  },

  addAttributes() {
    return { date: { default: null, parseHTML: (element) => element.getAttribute('datetime') } };
  },

  parseHTML() {
    return [{ tag: 'time[datetime]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'time',
      mergeAttributes(HTMLAttributes, { datetime: node.attrs.date, class: 'date-mention' }),
      describeDate(String(node.attrs.date)),
    ];
  },

  renderText({ node }) {
    return describeDate(String(node.attrs.date));
  },

  addNodeView() {
    return ({ node }) => {
      let current = node;
      const dom = document.createElement('button');
      dom.type = 'button';
      dom.className = 'date-mention';
      dom.contentEditable = 'false';
      const paint = () => {
        const key = String(current.attrs.date ?? '');
        dom.textContent = `@${describeDate(key)}`;
        dom.title = t('editor.openNoteFor', {
          date: parseDateKey(key)?.toLocaleDateString(dateLocale(), { dateStyle: 'full' }) ?? key,
        });
        const date = parseDateKey(key);
        const today = dateKey(new Date());
        dom.classList.toggle('is-past', !!date && key < today);
        dom.classList.toggle('is-today', key === today);
      };
      paint();
      dom.addEventListener('click', (event) => {
        event.preventDefault();
        const date = parseDateKey(String(current.attrs.date ?? ''));
        if (date) this.options.openDate(date);
      });
      return {
        dom,
        update(updated) {
          if (updated.type !== current.type) return false;
          current = updated;
          paint();
          return true;
        },
      };
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<MenuItem, MenuItem>({
        editor: this.editor,
        pluginKey: new PluginKey('dateMentionSuggestion'),
        char: '@',
        allowSpaces: true,
        allow: ({ state }) => state.selection.$from.parent.type.name !== 'codeBlock',
        items: ({ query }) => {
          if (query.length > 30) return [];
          const dates: MenuItem[] = dateSuggestions(query).map((date) => ({
            id: `date:${dateKey(date)}`,
            title: describeDate(dateKey(date)),
            description: date.toLocaleDateString(dateLocale(), {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            }),
            icon: CalendarDays,
          }));
          const pages: MenuItem[] = options
            .findPages(query.trim())
            .slice(0, 5)
            .map((page) => ({
              id: `page:${page.id}`,
              title: page.title,
              ...(page.path ? { description: page.path } : {}),
              icon: FileText,
            }));
          return [...dates, ...pages];
        },
        command: ({ editor, range, props }) => insertMention(editor, range, props),
        render: renderSuggestion(
          () => t('editor.mentionDateOrPage'),
          () => t('editor.nothingMatches'),
        ),
      }),
    ];
  },
});

function insertMention(editor: Editor, range: { from: number; to: number }, item: MenuItem): void {
  const node = item.id.startsWith('date:')
    ? { type: 'dateMention', attrs: { date: item.id.slice(5) } }
    : { type: 'pageLink', attrs: { id: item.id.slice(5), label: item.title } };
  editor
    .chain()
    .focus()
    .insertContentAt(range, [node, { type: 'text', text: ' ' }])
    .run();
}
