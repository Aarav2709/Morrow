import type { Command } from './commands';
import { canvasDoc } from './canvas';
import type { DatabaseDef, DocMark, DocNode, PageId } from './model';

type Inline = string | DocNode;

const t = (text: string, ...marks: Array<string | DocMark>): DocNode => ({
  type: 'text',
  text,
  ...(marks.length ? { marks: marks.map((mark) => (typeof mark === 'string' ? { type: mark } : mark)) } : {}),
});
const inline = (parts: Inline[]): DocNode[] =>
  parts.map((part) => (typeof part === 'string' ? t(part) : part));
const p = (...parts: Inline[]): DocNode => ({
  type: 'paragraph',
  ...(parts.length ? { content: inline(parts) } : {}),
});
const h = (level: number, text: string): DocNode => ({
  type: 'heading',
  attrs: { level },
  content: [t(text)],
});
const tasks = (...items: Array<[boolean, ...Inline[]]>): DocNode => ({
  type: 'taskList',
  content: items.map(([checked, ...parts]) => ({
    type: 'taskItem',
    attrs: { checked },
    content: [p(...parts)],
  })),
});
const quote = (...parts: Inline[]): DocNode => ({ type: 'blockquote', content: [p(...parts)] });
const code = (language: string, text: string): DocNode => ({
  type: 'codeBlock',
  attrs: { language },
  content: [t(text)],
});
const table = (header: string[], ...rows: string[][]): DocNode => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: header.map((cell) => ({ type: 'tableHeader', content: [p(cell)] })) },
    ...rows.map((row) => ({
      type: 'tableRow',
      content: row.map((cell) => ({ type: 'tableCell', content: [p(...(cell ? [cell] : []))] })),
    })),
  ],
});
const link = (id: PageId, label: string): DocNode => ({ type: 'pageLink', attrs: { id, label } });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });

const callout = (tone: string, title: string, ...content: DocNode[]): DocNode => ({
  type: 'callout',
  attrs: { tone, kind: tone, title },
  content,
});
const toggle = (title: string, ...content: DocNode[]): DocNode => ({
  type: 'details',
  attrs: { open: false },
  content: [
    { type: 'detailsSummary', content: [t(title)] },
    { type: 'detailsContent', content },
  ],
});
const math = (latex: string): DocNode => ({ type: 'inlineMath', attrs: { latex } });
const missing = (target: string): DocNode => ({
  type: 'pageLink',
  attrs: { id: null, label: target, target },
});

// first run content: one guide that shows every feature, with an example database and canvas inside it,
// so deleting the guide removes everything it brought
export function sampleCommands(newId: () => PageId, now: number): Command[] {
  const welcome = newId();
  const books = newId();
  const board = newId();
  const author = newId();
  const status = newId();
  const [next, current, finished] = [newId(), newId(), newId()];
  const database: DatabaseDef = {
    properties: [
      { id: author, name: 'Author', type: 'text', options: [] },
      {
        id: status,
        name: 'Status',
        type: 'select',
        options: [
          { id: next, name: 'Next', color: 'gray' },
          { id: current, name: 'Reading', color: 'blue' },
          { id: finished, name: 'Finished', color: 'green' },
        ],
      },
    ],
    views: [
      {
        id: newId(),
        name: 'All books',
        type: 'table',
        filters: [],
        sorts: [],
        groupBy: null,
        dateProp: null,
        hidden: [],
      },
      {
        id: newId(),
        name: 'Board',
        type: 'board',
        filters: [],
        sorts: [],
        groupBy: status,
        dateProp: null,
        hidden: [],
      },
    ],
  };
  const book = (title: string, by: string, state: string, offset: number): Command => ({
    type: 'page.create',
    id: newId(),
    parentId: books,
    now: now - offset,
    title,
    properties: { [author]: by, [status]: state },
  });

  return [
    {
      type: 'page.create',
      id: welcome,
      parentId: null,
      now,
      title: 'Welcome to Morrow',
      icon: '👋',
      tags: ['getting-started'],
      doc: doc(
        p(
          'Morrow is a quiet place to write, plan and keep what you know. No account, no subscription, no AI and nothing sent anywhere. Every page is a plain Markdown file in the folder you chose.',
        ),
        callout(
          'tip',
          'This page is a guide',
          p(
            'Try everything on it, then delete it from its ',
            t('•••', 'code'),
            ' menu. Its examples go with it.',
          ),
        ),
        h(2, 'Write'),
        p(
          'Text can be ',
          t('bold', 'bold'),
          ', ',
          t('italic', 'italic'),
          ', ',
          t('underlined', 'underline'),
          ', ',
          t('struck through', 'strike'),
          ', ',
          t('highlighted', 'highlight'),
          ' or ',
          t('code', 'code'),
          '. Select text for the toolbar. Press ',
          t('/', 'code'),
          ' on an empty line for every kind of block, or type Markdown like ',
          t('#', 'code'),
          ', ',
          t('-', 'code'),
          ' and ',
          t('[ ]', 'code'),
          ' as you go.',
        ),
        toggle('Toggles fold content away. Click the arrow.', p('Hidden until you need it.')),
        callout(
          'warning',
          'Callouts',
          p('Click the word Warning above to change the colour, and give any callout a title.'),
        ),
        h(2, 'Plan'),
        tasks(
          [false, 'Tick this. Every checklist item shows up in ', t('Tasks', 'bold'), ' in the sidebar.'],
          [false, "Open today's note with ", t('Alt D', 'code')],
          [true, 'Install Morrow'],
        ),
        table(
          ['Plant', 'Where', 'When'],
          ['Tomatoes', 'Raised bed', 'May'],
          ['Garlic', 'Raised bed', 'October'],
        ),
        h(2, 'Connect'),
        p(
          'Type ',
          t('[[', 'code'),
          ' to link a page, like ',
          link(books, 'Reading list'),
          '. A link to a page that does not exist yet, like ',
          missing('An idea for later'),
          ', makes the page when you click it. Pages you link show a backlink at the bottom.',
        ),
        p(
          'Tag anything with ',
          t('#getting-started', 'code'),
          ' or #ideas, then open ',
          t('Tags', 'bold'),
          ' or the ',
          t('Graph', 'bold'),
          ' in the sidebar to see how your pages connect.',
        ),
        h(2, 'Organise'),
        p(
          link(books, 'Reading list'),
          ' is a database: its rows are pages, shown as a table, a board, a calendar, a list or a gallery. ',
          link(board, 'Ideas board'),
          ' is a canvas of cards and arrows. Make your own from the ',
          t('+', 'code'),
          ' next to Pages.',
        ),
        h(2, 'Think'),
        p('Formulas are LaTeX: ', math('e^{i\\pi} + 1 = 0'), '. Click one to edit it.'),
        code('ts', "const greeting: string = 'Code blocks are highlighted';"),
        h(2, 'Keep'),
        p(
          'Pages save as you type, and earlier versions are kept in ',
          t('Page history', 'bold'),
          '. Edit the files in any other app and Morrow follows along. Bring in a Notion export or an Obsidian vault from ',
          t('Import', 'bold'),
          ', and save a page as a template from its menu.',
        ),
        quote('Make the fundamental workflows excellent before adding more workflows.'),
        h(3, 'Shortcuts'),
        table(
          ['Action', 'Windows and Linux', 'Mac'],
          ['Search and commands', 'Ctrl K', '⌘ K'],
          ['New page', 'Alt N', '⌥ N'],
          ["Today's note", 'Alt D', '⌥ D'],
          ['Graph', 'Alt G', '⌥ G'],
          ['Every shortcut', 'Ctrl /', '⌘ /'],
        ),
      ),
    },
    {
      type: 'page.create',
      id: books,
      parentId: welcome,
      now: now - 1,
      title: 'Reading list',
      kind: 'database',
      database,
    },
    book('Middlemarch', 'George Eliot', current, 2),
    book('The Left Hand of Darkness', 'Ursula K. Le Guin', finished, 3),
    book('Piranesi', 'Susanna Clarke', next, 4),
    {
      type: 'page.create',
      id: board,
      parentId: welcome,
      now: now - 5,
      title: 'Ideas board',
      kind: 'canvas',
      doc: canvasDoc({
        nodes: [
          {
            id: 'start',
            type: 'text',
            text: '# Canvas\nDouble-click anywhere to add a card.',
            x: 0,
            y: 0,
            width: 280,
            height: 110,
          },
          {
            id: 'drag',
            type: 'text',
            text: 'Drag from the dot on a card to connect it.',
            x: 380,
            y: 0,
            width: 260,
            height: 80,
            color: '5',
          },
          { id: 'page', type: 'page', pageId: welcome, x: 0, y: 180, width: 320, height: 200 },
        ],
        edges: [
          { id: 'e1', fromNode: 'start', toNode: 'drag', fromSide: 'right', toSide: 'left' },
          { id: 'e2', fromNode: 'start', toNode: 'page', fromSide: 'bottom', toSide: 'top' },
        ],
      }),
    },
    { type: 'page.setFavorite', id: welcome, favorite: true },
  ];
}
