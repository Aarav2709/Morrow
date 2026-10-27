import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import {
  CalendarDays,
  Columns2,
  Columns3,
  ListTree,
  Workflow,
  ChevronRight,
  Highlighter,
  LayoutDashboard,
  Sigma,
  Table2,
  Code2,
  ImageIcon,
  Info,
  Paperclip,
  Heading1,
  Heading2,
  Heading,
  Heading3,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table,
} from 'lucide-react';
import { foldText } from '../../core/search';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { pickFiles } from '../platform/files';
import { editMathNear } from './Extras';
import { insertFiles } from './Media';
import type { MenuItem } from './SuggestionMenu';
import { renderSuggestion } from './SuggestionMenu';
import { listItemAtCursor, turnListItem } from './turnInto';
import type { TurnTarget } from './turnInto';

interface BlockItem extends MenuItem {
  keywords: string;
  run: (editor: Editor, range: Range, options: SlashOptions) => void;
}

export interface SlashOptions {
  // makes a subpage of the open page and returns its id, used for databases and canvases
  createChild: (kind: 'database' | 'canvas') => string | null;
}

const linkChild = (
  editor: Editor,
  range: Range,
  options: SlashOptions,
  kind: 'database' | 'canvas',
  embed = false,
) => {
  const id = options.createChild(kind);
  if (!id) return;
  const label = kind === 'database' ? 'Database' : 'Canvas';
  chain(editor, range)
    .insertContent([
      { type: 'pageLink', attrs: embed ? { id, label, embed: true } : { id, label } },
      { type: 'text', text: ' ' },
    ])
    .run();
};

const SAMPLE_DIAGRAM = `flowchart LR
  Idea --> Draft --> Review
  Review -->|changes| Draft
  Review --> Done`;

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

// in the first line of a list item a block command changes only that item, the rest of the list stays.
// asking a list item for the list it is already in is left to the usual toggle, which takes it out
const turnItem = (editor: Editor, range: Range, target: TurnTarget): boolean => {
  const item = listItemAtCursor(editor);
  if (item === null) return false;
  const list = editor.state.doc.resolve(item).parent.type.name;
  if (list === target.kind) return false;
  chain(editor, range).run();
  turnListItem(editor, item, target);
  return true;
};

export const BLOCK_ITEMS: BlockItem[] = [
  {
    id: 'text',
    title: 'Text',
    description: 'Plain paragraph',
    icon: Pilcrow,
    keywords: 'paragraph plain',
    run: (e, r) => turnItem(e, r, { kind: 'paragraph' }) || chain(e, r).setParagraph().run(),
  },
  {
    id: 'h1',
    title: 'Heading 1',
    description: 'Large section heading',
    icon: Heading1,
    hint: '#',
    keywords: 'title h1',
    run: (e, r) =>
      turnItem(e, r, { kind: 'heading', level: 1 }) || chain(e, r).setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    description: 'Medium heading',
    icon: Heading2,
    hint: '##',
    keywords: 'subtitle h2',
    run: (e, r) =>
      turnItem(e, r, { kind: 'heading', level: 2 }) || chain(e, r).setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    description: 'Small heading',
    icon: Heading3,
    hint: '###',
    keywords: 'h3',
    run: (e, r) =>
      turnItem(e, r, { kind: 'heading', level: 3 }) || chain(e, r).setHeading({ level: 3 }).run(),
  },
  ...([4, 5, 6] as const).map((level) => ({
    id: `h${level}`,
    title: `Heading ${level}`,
    description: 'A smaller heading, for deeper sections',
    icon: Heading,
    hint: '#'.repeat(level),
    keywords: `h${level} subheading`,
    run: (e: Editor, r: Range) =>
      turnItem(e, r, { kind: 'heading', level }) || chain(e, r).setHeading({ level }).run(),
  })),
  {
    id: 'bullet',
    title: 'Bulleted list',
    description: 'Simple list',
    icon: List,
    hint: '-',
    keywords: 'unordered ul bullet',
    run: (e, r) => turnItem(e, r, { kind: 'bulletList' }) || chain(e, r).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    title: 'Numbered list',
    description: 'List with numbers',
    icon: ListOrdered,
    hint: '1.',
    keywords: 'ordered ol',
    run: (e, r) => turnItem(e, r, { kind: 'orderedList' }) || chain(e, r).toggleOrderedList().run(),
  },
  {
    id: 'task',
    title: 'Checklist',
    description: 'Track tasks',
    icon: ListChecks,
    hint: '[ ]',
    keywords: 'todo task checkbox',
    run: (e, r) => turnItem(e, r, { kind: 'taskList' }) || chain(e, r).toggleTaskList().run(),
  },
  {
    id: 'quote',
    title: 'Quote',
    description: 'Quotation or callout',
    icon: Quote,
    hint: '>',
    keywords: 'blockquote citation',
    run: (e, r) => turnItem(e, r, { kind: 'blockquote' }) || chain(e, r).setBlockquote().run(),
  },
  {
    id: 'code',
    title: 'Code block',
    description: 'Monospaced code',
    icon: Code2,
    hint: '```',
    keywords: 'snippet pre',
    run: (e, r) => turnItem(e, r, { kind: 'codeBlock' }) || chain(e, r).setCodeBlock().run(),
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'Horizontal line',
    icon: Minus,
    hint: '---',
    keywords: 'hr rule separator line',
    run: (e, r) => chain(e, r).setHorizontalRule().run(),
  },
  {
    id: 'callout',
    title: 'Callout',
    description: 'Highlighted note',
    icon: Info,
    keywords: 'note tip warning aside alert',
    run: (e, r) => chain(e, r).setCallout().run(),
  },
  {
    id: 'toggle',
    title: 'Toggle',
    description: 'Content that folds away',
    icon: ChevronRight,
    keywords: 'details collapse fold accordion',
    run: (e, r) => turnItem(e, r, { kind: 'toggle' }) || chain(e, r).setDetails().run(),
  },
  {
    id: 'image',
    title: 'Image',
    description: 'Picture from your computer',
    icon: ImageIcon,
    keywords: 'picture photo upload',
    run: (e, r) => {
      chain(e, r).run();
      void pickFiles('image/*', true).then((files) => insertFiles(e, files));
    },
  },
  {
    id: 'file',
    title: 'File',
    description: 'Attach any file',
    icon: Paperclip,
    keywords: 'attachment upload pdf document',
    run: (e, r) => {
      chain(e, r).run();
      void pickFiles('', true).then((files) => insertFiles(e, files));
    },
  },
  {
    id: 'table',
    title: 'Table',
    description: 'Rows and columns',
    icon: Table,
    keywords: 'grid spreadsheet',
    run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'math',
    title: 'Formula',
    description: 'Display maths in LaTeX',
    icon: Sigma,
    hint: '$$',
    keywords: 'math equation latex katex tex formula',
    run: (e, r) => {
      chain(e, r)
        .insertContent({ type: 'blockMath', attrs: { latex: '' } })
        .run();
      // the formula opens for typing straight away
      editMathNear(e, r.from);
    },
  },
  {
    id: 'inlineMath',
    title: 'Inline formula',
    description: 'Maths inside a sentence',
    icon: Sigma,
    hint: '$…$',
    keywords: 'math equation latex inline',
    // inserted at the slash itself, then opened for typing like a block formula
    run: (e, r) => {
      chain(e, r)
        .insertContent({ type: 'inlineMath', attrs: { latex: '' } })
        .run();
      editMathNear(e, r.from);
    },
  },
  {
    id: 'highlight',
    title: 'Highlight',
    description: 'Mark text to find it again',
    icon: Highlighter,
    hint: '==',
    keywords: 'mark marker yellow',
    run: (e, r) => chain(e, r).toggleHighlight().run(),
  },
  {
    id: 'database',
    title: 'Database',
    description: 'Table, board and calendar of pages',
    icon: Table2,
    keywords: 'collection kanban board calendar gallery table',
    run: (e, r, options) => linkChild(e, r, options, 'database'),
  },
  {
    id: 'canvas',
    title: 'Canvas',
    description: 'Cards and arrows on a whiteboard',
    icon: LayoutDashboard,
    keywords: 'whiteboard board diagram mind map',
    run: (e, r, options) => linkChild(e, r, options, 'canvas'),
  },
  {
    id: 'inlineDatabase',
    title: 'Inline database',
    description: 'A database shown right on this page',
    icon: Table2,
    keywords: 'inline table board embedded view',
    run: (e, r, options) => linkChild(e, r, options, 'database', true),
  },
  {
    id: 'inlineCanvas',
    title: 'Inline canvas',
    description: 'A whiteboard shown right on this page',
    icon: LayoutDashboard,
    keywords: 'inline whiteboard drawing sketch embedded board',
    run: (e, r, options) => linkChild(e, r, options, 'canvas', true),
  },
  {
    id: 'columns2',
    title: '2 columns',
    description: 'Put blocks side by side',
    icon: Columns2,
    keywords: 'columns layout side by side split',
    run: (e, r) => chain(e, r).setColumns(2).run(),
  },
  {
    id: 'columns3',
    title: '3 columns',
    description: 'Three blocks side by side',
    icon: Columns3,
    keywords: 'columns layout side by side split',
    run: (e, r) => chain(e, r).setColumns(3).run(),
  },
  {
    id: 'toc',
    title: 'Table of contents',
    description: 'Every heading on this page',
    icon: ListTree,
    keywords: 'toc outline contents headings index',
    run: (e, r) => chain(e, r).insertContent({ type: 'tableOfContents' }).run(),
  },
  {
    id: 'diagram',
    title: 'Diagram',
    description: 'Flowcharts and more with Mermaid',
    icon: Workflow,
    keywords: 'mermaid flowchart sequence gantt chart graph uml',
    run: (e, r) =>
      chain(e, r)
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: SAMPLE_DIAGRAM }],
        })
        .run(),
  },
  {
    id: 'date',
    title: 'Date',
    description: 'Mention a day, like @tomorrow',
    icon: CalendarDays,
    hint: '@',
    keywords: 'date day today tomorrow reminder mention due',
    run: (e, r) => chain(e, r).insertContent('@').run(),
  },
  {
    id: 'embed',
    title: 'Embed a page',
    description: 'Show another page inside this one',
    icon: Link2,
    hint: '![[',
    keywords: 'transclude include synced block mirror',
    run: (e, r) => chain(e, r).insertContent('![[').run(),
  },
  {
    id: 'link',
    title: 'Link to page',
    description: 'Mention another page',
    icon: Link2,
    hint: '[[',
    keywords: 'mention reference wiki',
    run: (e, r) => chain(e, r).insertContent('[[').run(),
  },
];

export function getLocalizedBlocks(): BlockItem[] {
  return BLOCK_ITEMS.map((item) => {
    const titleKey = `slash.items.${item.id}.title` as TranslationKey;
    const descKey = `slash.items.${item.id}.description` as TranslationKey;
    const kwKey = `slash.items.${item.id}.keywords` as TranslationKey;
    const title = t(titleKey);
    const description = t(descKey);
    const localizedKw = t(kwKey);
    const keywords =
      localizedKw && localizedKw !== kwKey ? `${item.keywords ?? ''} ${localizedKw}` : item.keywords;
    return {
      ...item,
      title: title && title !== titleKey ? title : item.title,
      description: description && description !== descKey ? description : item.description,
      keywords,
    };
  });
}

// the groups the menu shows before you type, in this order
const SECTIONS: Array<[string, string[], TranslationKey]> = [
  [
    'basic',
    [
      'text',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'bullet',
      'ordered',
      'task',
      'toggle',
      'quote',
      'callout',
      'divider',
      'code',
    ],
    'slash.sections.basic',
  ],
  ['media', ['image', 'file'], 'slash.sections.media'],
  ['layout', ['columns2', 'columns3', 'table', 'toc'], 'slash.sections.layout'],
  [
    'pagesAndData',
    ['link', 'embed', 'date', 'database', 'inlineDatabase', 'canvas', 'inlineCanvas'],
    'slash.sections.pagesAndData',
  ],
  ['mathsAndDiagrams', ['math', 'inlineMath', 'diagram', 'highlight'], 'slash.sections.mathsAndDiagrams'],
];

function grouped(): BlockItem[] {
  const items = getLocalizedBlocks();
  const placed = new Set<string>();
  const out: BlockItem[] = [];
  for (const [, ids, sectionKey] of SECTIONS) {
    const sectionName = t(sectionKey);
    for (const id of ids) {
      const item = items.find((candidate) => candidate.id === id);
      if (item) {
        out.push({ ...item, section: sectionName });
        placed.add(id);
      }
    }
  }
  // anything not given a group still shows, at the end
  const moreName = t('slash.sections.more');
  for (const item of items) if (!placed.has(item.id)) out.push({ ...item, section: moreName });
  return out;
}

// blocks whose name matches come before blocks that only match a keyword, so /diagram finds the diagram
export function filterBlocks(query: string): BlockItem[] {
  const folded = foldText(query.trim());
  if (!folded) return grouped();
  const words = folded.split(/\s+/);
  const items = getLocalizedBlocks();
  const rank = (item: BlockItem): number => {
    const title = foldText(item.title);
    if (title.startsWith(folded)) return 0;
    if (title.includes(folded)) return 1;
    const haystack = `${title} ${foldText(item.keywords ?? '')}`;
    return words.every((word) => haystack.includes(word)) ? 2 : -1;
  };
  return items
    .map((item) => ({ item, score: rank(item) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.item);
}

export const SlashCommand = Extension.create<SlashOptions>({
  name: 'slashCommand',
  addOptions() {
    return { createChild: () => null };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<MenuItem, MenuItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        startOfLine: false,
        // names like "2 columns" have spaces, a sentence typed after a slash simply finds nothing
        allowSpaces: true,
        allow: ({ state }) => {
          const parent = state.selection.$from.parent;
          return parent.type.name !== 'codeBlock';
        },
        items: ({ query }) =>
          query.length > 40 || /\s{2}/.test(query) ? [] : filterBlocks(query).slice(0, 40),
        command: ({ editor, range, props }) => {
          const item = BLOCK_ITEMS.find((candidate) => candidate.id === props.id);
          item?.run(editor, range, options);
        },
        render: renderSuggestion(
          () => t('slash.menu.insertBlock'),
          () => t('slash.menu.noMatchingBlocks'),
          'insert',
        ),
      }),
    ];
  },
});
