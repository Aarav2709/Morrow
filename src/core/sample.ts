import type { Command } from './commands';
import { canvasDoc } from './canvas';
import { dateKey } from './daily';
import type { CalloutTone, DatabaseDef, DocMark, DocNode, PageId } from './model';

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
const k = (text: string) => t(text, 'code');
const b = (text: string) => t(text, 'bold');
const item = (...content: DocNode[]): DocNode => ({ type: 'listItem', content });
const bullets = (...items: Inline[][]): DocNode => ({
  type: 'bulletList',
  content: items.map((parts) => item(p(...parts))),
});
const numbered = (...items: Inline[][]): DocNode => ({
  type: 'orderedList',
  attrs: { start: 1 },
  content: items.map((parts) => item(p(...parts))),
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
const table = (header: string[], ...rows: Inline[][]): DocNode => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: header.map((cell) => ({ type: 'tableHeader', content: [p(cell)] })) },
    ...rows.map((row) => ({
      type: 'tableRow',
      content: row.map((cell) => ({ type: 'tableCell', content: [p(...(cell === '' ? [] : [cell]))] })),
    })),
  ],
});
const link = (id: PageId, label: string): DocNode => ({ type: 'pageLink', attrs: { id, label } });
// a link shown with other words keeps those words as its label, the way the parser reads it back
const alias = (id: PageId, shown: string): DocNode => ({
  type: 'pageLink',
  attrs: { id, label: shown, alias: shown },
});
const embed = (id: PageId, label: string): DocNode => ({
  type: 'pageLink',
  attrs: { id, label, embed: true },
});
const missing = (target: string): DocNode => ({
  type: 'pageLink',
  attrs: { id: null, label: target, target },
});
const date = (key: string): DocNode => ({ type: 'dateMention', attrs: { date: key } });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });
const callout = (tone: CalloutTone, title: string, ...content: DocNode[]): DocNode => ({
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
const columns = (...cols: DocNode[][]): DocNode => ({
  type: 'columns',
  content: cols.map((content) => ({ type: 'column', content })),
});
const toc = (): DocNode => ({ type: 'tableOfContents' });
const math = (latex: string): DocNode => ({ type: 'inlineMath', attrs: { latex } });
const color = (text: string, name: string) => t(text, { type: 'textColor', attrs: { color: name } });
const marker = (text: string, name: string) => t(text, { type: 'highlight', attrs: { color: name } });
const rule = (): DocNode => ({ type: 'horizontalRule' });

// a wave and a star, so the example canvas shows what freehand ink looks like
function wave(): number[] {
  const points: number[] = [];
  for (let i = 0; i <= 40; i++) points.push(i * 8, Math.round(30 + 22 * Math.sin(i / 3)));
  return points;
}
function star(): number[] {
  const points: number[] = [];
  for (let i = 0; i <= 10; i++) {
    const radius = i % 2 === 0 ? 46 : 20;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(Math.round(50 + radius * Math.cos(angle)), Math.round(50 + radius * Math.sin(angle)));
  }
  return points;
}

// first run content: a guide that walks through every feature with live examples. everything sits
// under one page, so deleting "Welcome to Morrow" removes all of it in one go
export function sampleCommands(newId: () => PageId, now: number): Command[] {
  const day = (offset: number) => dateKey(new Date(now + offset * 86_400_000));
  const welcome = newId();
  const writing = newId();
  const layout = newId();
  const links = newId();
  const planning = newId();
  const databases = newId();
  const books = newId();
  const canvas = newId();
  const board = newId();
  const memory = newId();
  const privacy = newId();
  const sharing = newId();
  const custom = newId();

  const [author, status, rating, pages, finishedOn, similar, summary] = [
    newId(),
    newId(),
    newId(),
    newId(),
    newId(),
    newId(),
    newId(),
  ];
  const [next, reading, finished] = [newId(), newId(), newId()];
  const database: DatabaseDef = {
    properties: [
      { id: author, name: 'Author', type: 'text', options: [] },
      {
        id: status,
        name: 'Status',
        type: 'select',
        options: [
          { id: next, name: 'Next', color: 'gray' },
          { id: reading, name: 'Reading', color: 'blue' },
          { id: finished, name: 'Finished', color: 'green' },
        ],
      },
      { id: rating, name: 'Rating', type: 'number', options: [] },
      { id: pages, name: 'Pages', type: 'number', options: [] },
      { id: finishedOn, name: 'Finished on', type: 'date', options: [] },
      { id: similar, name: 'Similar to', type: 'relation', options: [] },
      {
        id: summary,
        name: 'Summary',
        type: 'formula',
        options: [],
        formula:
          'if(prop("Status") == "Finished", "★ " + prop("Rating") + " of 5", prop("Pages") + " pages to go")',
      },
    ],
    views: [
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
        name: 'Calendar',
        type: 'calendar',
        filters: [],
        sorts: [],
        groupBy: null,
        dateProp: finishedOn,
        hidden: [],
      },
      {
        id: newId(),
        name: 'Gallery',
        type: 'gallery',
        filters: [],
        sorts: [],
        groupBy: null,
        dateProp: null,
        hidden: [],
      },
    ],
  };
  const book = (
    title: string,
    icon: string,
    values: Record<string, string | number | string[]>,
    notes: DocNode,
    offset: number,
  ): Command => ({
    type: 'page.create',
    id: newId(),
    parentId: books,
    now: now - offset,
    title,
    icon,
    properties: values,
    doc: notes,
  });

  const chapter = (id: PageId, title: string, icon: string, offset: number, body: DocNode): Command => ({
    type: 'page.create',
    id,
    parentId: welcome,
    now: now - offset,
    title,
    icon,
    tags: ['getting-started'],
    doc: body,
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
          'Morrow is a calm place to write, plan and keep what you know. There is no account, no subscription, no AI and no ads, and nothing you write is ever sent anywhere. Every page is a plain Markdown file in a folder you chose, so your notes stay yours even without Morrow.',
        ),
        callout(
          'tip',
          'How to use this guide',
          p(
            'Each chapter below is a real page that shows its feature working. Try things, change them, break them. When you are done, delete this page from its ',
            k('•••'),
            ' menu at the top right and every chapter and example goes with it.',
          ),
        ),
        h(1, 'Start in five minutes'),
        numbered(
          [
            'Press ',
            k('Alt N'),
            ' (',
            k('⌥ N'),
            ' on a Mac) to make a page. Give it a title and press ',
            k('Enter'),
            '.',
          ],
          [
            'Type ',
            k('/'),
            ' on an empty line to pick any block: headings, checklists, tables, columns, databases and more.',
          ],
          [
            'Type ',
            k('[['),
            ' to link to another page, and ',
            k('@'),
            ' to mention a date like ',
            k('@tomorrow'),
            '.',
          ],
          ['Press ', k('Alt D'), ' to open today’s note, a page for every day that collects what happened.'],
          ['Press ', k('Ctrl K'), ' (', k('⌘ K'), ') to search everything and run any command by name.'],
        ),
        h(1, 'The chapters'),
        columns(
          [
            p(link(writing, 'Writing and formatting')),
            p(link(layout, 'Layouts, diagrams and media')),
            p(link(links, 'Links, tags and the graph')),
            p(link(planning, 'Daily notes, tasks and templates')),
            p(link(databases, 'Databases')),
          ],
          [
            p(link(canvas, 'Canvas and drawing')),
            p(link(memory, 'Flashcards and review')),
            p(link(privacy, 'Privacy, history and encryption')),
            p(link(sharing, 'Sync, import, export and publishing')),
            p(link(custom, 'Make it yours')),
          ],
        ),
        h(1, 'Why Morrow'),
        bullets(
          [
            b('Your files, forever.'),
            ' Pages are Markdown, canvases are JSON Canvas, databases are folders of pages. Open them in any text editor.',
          ],
          [
            b('Powerful databases, offline.'),
            ' Databases with board, table, calendar, list and gallery views, relations and formulas, all on your own computer.',
          ],
          [
            b('Everything built in.'),
            ' Links, backlinks, a graph, canvases and daily notes work the moment you open the app. No plugins to hunt for.',
          ],
          [
            b('Private by design.'),
            ' No telemetry, no cloud, no AI reading your notes. Lock any page with a password, sync between your own devices over your own network.',
          ],
          [b('Free and open source.'), ' No plans, no seats, no paywalled features. Ever.'],
        ),
        h(2, 'Keys worth learning first'),
        table(
          ['What', 'Windows and Linux', 'Mac'],
          ['Search and run commands', 'Ctrl K', '⌘ K'],
          ['New page', 'Alt N', '⌥ N'],
          ['New subpage of this page', 'Alt Shift N', '⌥ ⇧ N'],
          ['Today’s note', 'Alt D', '⌥ D'],
          ['Quick capture from anywhere', 'Ctrl Alt M', '⌘ ⌥ M'],
          ['New tab and close tab', 'Ctrl T, Ctrl W', '⌘ T, ⌘ W'],
          ['Every shortcut', 'Ctrl /', '⌘ /'],
        ),
      ),
    },
    { type: 'page.setCover', id: welcome, cover: 'gradient-8', now },

    chapter(
      writing,
      'Writing and formatting',
      '✍️',
      1,
      doc(
        p('Everything on this page can be edited. Click anywhere and start typing.'),
        toc(),
        h(1, 'Text'),
        p(
          'Select some words and a toolbar appears. Text can be ',
          b('bold'),
          ' (',
          k('Ctrl B'),
          '), ',
          t('italic', 'italic'),
          ' (',
          k('Ctrl I'),
          '), ',
          t('underlined', 'underline'),
          ', ',
          t('struck through', 'strike'),
          ', ',
          k('inline code'),
          ' or ',
          t('highlighted', 'highlight'),
          ' (',
          k('Ctrl Shift H'),
          ').',
        ),
        p(
          'Colour words like ',
          color('red', 'red'),
          ', ',
          color('green', 'green'),
          ' and ',
          color('purple', 'purple'),
          ', or mark them ',
          marker('yellow', 'yellow'),
          ', ',
          marker('blue', 'blue'),
          ' and ',
          marker('pink', 'pink'),
          ' from the colour button in the toolbar.',
        ),
        h(1, 'Blocks'),
        p(
          'Type ',
          k('/'),
          ' on an empty line to see every block. Hover over any block and drag the ',
          k('⋮⋮'),
          ' handle on its left to move it, or click the handle to turn it into another kind of block, duplicate it or delete it.',
        ),
        h(2, 'Lists'),
        bullets(['A bulleted list starts with ', k('-')], ['Press Tab to indent and Shift Tab to outdent']),
        numbered(['A numbered list starts with ', k('1.')], ['It counts by itself']),
        tasks(
          [true, 'A checklist starts with ', k('[ ]')],
          [false, 'Every unticked item, on every page, shows up in ', b('Tasks'), ' in the sidebar'],
        ),
        h(2, 'Quotes and callouts'),
        quote('Make the fundamental workflows excellent before adding more workflows.'),
        callout(
          'note',
          'A note',
          p('Click the label of a callout to change its colour, and click its title to rename it.'),
        ),
        callout(
          'tip',
          'A tip',
          p('Callouts are saved as standard Markdown callouts, so other Markdown apps show them too.'),
        ),
        callout('warning', 'A warning', p('Use these for things that matter.')),
        callout('danger', 'Danger', p('And these for things that really matter.')),
        toggle(
          'A toggle folds its content away. Click the arrow',
          p('Hidden until you need it. Good for long details, answers and spoilers.'),
        ),
        h(2, 'Code'),
        code(
          'ts',
          '// pick the language at the top of the block, there are dozens\nfunction greet(name: string): string {\n  return `Hello, ${name}`;\n}',
        ),
        h(2, 'Tables'),
        table(
          ['Plant', 'Where', 'When'],
          ['Tomatoes', 'Raised bed', 'May'],
          ['Garlic', 'Raised bed', 'October'],
        ),
        p('Click inside a table for buttons that add and remove rows and columns.'),
        h(2, 'Maths'),
        p(
          'Type ',
          k('$'),
          ' around LaTeX for maths in a sentence, like ',
          math('e^{i\\pi} + 1 = 0'),
          ' or ',
          math('\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}'),
          '. Click one to edit it.',
        ),
        h(1, 'Markdown as you type'),
        table(
          ['Type this', 'To get'],
          ['# space', 'Heading 1, ## for 2 and ### for 3'],
          ['- or * space', 'Bulleted list'],
          ['1. space', 'Numbered list'],
          ['[ ] space', 'Checklist'],
          ['> space', 'Quote'],
          ['```', 'Code block'],
          ['---', 'Divider'],
          ['**bold** and *italic*', 'Bold and italic'],
          ['==marker==', 'Highlight'],
        ),
        h(1, 'Find, focus and source'),
        bullets(
          [k('Ctrl F'), ' finds and replaces on the page.'],
          [
            k('Ctrl Shift F'),
            ' is focus mode: everything but your writing fades away. Press it again, or Escape, to come back.',
          ],
          [
            'The page menu ',
            k('•••'),
            ' has ',
            b('Edit as Markdown'),
            ', which shows the page as the text in its file, to edit directly.',
          ],
          ['The same menu shows the word count and when the page was made.'],
        ),
      ),
    ),

    chapter(
      layout,
      'Layouts, diagrams and media',
      '🧱',
      2,
      doc(
        p('Blocks for arranging a page, drawing diagrams from text, and showing files.'),
        h(1, 'Columns'),
        p('Type ', k('/2 columns'), ' or ', k('/3 columns'), '. Each column holds any blocks.'),
        columns(
          [h(3, 'Morning'), tasks([false, 'Write 500 words'], [false, 'Walk'])],
          [h(3, 'Afternoon'), tasks([false, 'Reply to letters'], [false, 'Read'])],
          [h(3, 'Evening'), tasks([false, 'Cook'], [false, 'Plan tomorrow'])],
        ),
        h(1, 'Table of contents'),
        p(
          'Type ',
          k('/table of contents'),
          ' for a list of every heading on the page that jumps to it when clicked. Long pages also show an outline at the side.',
        ),
        h(1, 'Diagrams'),
        p(
          'Type ',
          k('/diagram'),
          ' for a Mermaid diagram: describe it in text and Morrow draws it. Hover over it and click ',
          b('Edit diagram'),
          ' to change the text.',
        ),
        code(
          'mermaid',
          'flowchart LR\n  Capture[Capture an idea] --> Daily[Daily note]\n  Daily --> Page[Its own page]\n  Page --> Project[Project database]\n  Project -->|done| Archive',
        ),
        p(
          'Mermaid also draws sequence diagrams, timelines, Gantt charts, pie charts and mind maps. Search for the Mermaid docs to see them all.',
        ),
        h(1, 'Embeds'),
        p(
          'Write ',
          k('![[Page name]]'),
          ' to show another page right here, kept up to date as it changes. This is the chapter on flashcards:',
        ),
        p(embed(memory, 'Flashcards and review')),
        h(1, 'Pictures, files, sound and video'),
        bullets(
          [
            'Drag a picture or any file onto the page, or paste it, or use ',
            k('/image'),
            ' and ',
            k('/file'),
            '.',
          ],
          ['Audio and video files play right on the page. PDFs open in a viewer on the page.'],
          [
            'Everything you add is copied into an attachments folder inside your vault, so it travels with your notes.',
          ],
          [
            'Pictures from the web only load when you click ',
            b('Load image'),
            ', so opening a page never contacts anyone.',
          ],
        ),
      ),
    ),

    chapter(
      links,
      'Links, tags and the graph',
      '🔗',
      3,
      doc(
        p('Notes become more useful the more they are connected. Morrow makes connecting them quick.'),
        h(1, 'Links'),
        bullets(
          ['Type ', k('[['), ' and pick a page to link it: ', link(databases, 'Databases'), '.'],
          [
            'Show different words for a link with ',
            k('[[Page|words]]'),
            ': ',
            alias(canvas, 'the whiteboard chapter'),
            '.',
          ],
          [
            'A link to a page that does not exist yet, like ',
            missing('An idea for later'),
            ', is shown faded. Click it and the page is made.',
          ],
          ['Hold ', k('Ctrl'), ' (', k('⌘'), ') while clicking a link to open it in a new tab.'],
        ),
        h(1, 'Backlinks and mentions'),
        p(
          'At the bottom of every page is a list of the pages that link to it, with the sentence each link sits in. Below that, ',
          b('unlinked mentions'),
          ' finds pages that name this page without linking it, and opens each one right at the mention so you can link it.',
        ),
        h(1, 'Dates'),
        p(
          'Type ',
          k('@'),
          ' to mention a date: ',
          date(day(0)),
          ', ',
          date(day(1)),
          ' or ',
          date(day(7)),
          '. Click one to open that day’s note. In the file it is a link like ',
          k(`[[${day(0)}]]`),
          ', the common way daily notes are named.',
        ),
        h(1, 'Tags'),
        p(
          'Write a tag anywhere in text, like #ideas or #reading/fiction, or add tags under the title of a page. ',
          b('Tags'),
          ' in the sidebar lists every tag and the pages that use it. Click a tag to see them all.',
        ),
        h(1, 'The graph'),
        p(
          'Press ',
          k('Alt G'),
          ' for the graph: every page is a dot and every link a line. Drag dots around, zoom with the wheel, and click one to open it. Open the graph from a page’s menu to see only what is near that page.',
        ),
      ),
    ),

    chapter(
      planning,
      'Daily notes, tasks and templates',
      '📅',
      4,
      doc(
        h(1, 'Daily notes'),
        p(
          'Press ',
          k('Alt D'),
          ' or click ',
          b('Today'),
          ' in the sidebar. Each day gets its own page inside a Journal page, newest first. Use it as a diary, a work log, or the place where everything lands before it finds a home.',
        ),
        h(1, 'Tasks'),
        p(
          'Any checklist item on any page is a task. ',
          b('Tasks'),
          ' in the sidebar gathers every open one, grouped by page. Give a task a date with ',
          k('@'),
          ':',
        ),
        tasks(
          [false, 'Water the tomatoes ', date(day(1))],
          [false, 'Send the draft ', date(day(3))],
          [true, 'Read the welcome guide ', date(day(0))],
        ),
        h(1, 'Quick capture'),
        p(
          'Press ',
          k('Ctrl Alt M'),
          ' (',
          k('⌘ ⌥ M'),
          ') from any app, even with Morrow in the background. Type a thought and it goes into today’s note without leaving what you were doing.',
        ),
        h(1, 'Templates'),
        numbered(
          [
            'Make a page the way you like it, for example a meeting note with headings for agenda, notes and actions.',
          ],
          [
            'Choose ',
            b('Save as template'),
            ' from its ',
            k('•••'),
            ' menu. It is copied into a Templates page.',
          ],
          ['Press ', k('Alt T'), ' to make a new page from any template.'],
          ['A template called ', b('Daily note'), ' is used for every new daily note.'],
        ),
        p(
          'Templates can use ',
          k('{{date}}'),
          ', ',
          k('{{time}}'),
          ' and ',
          k('{{title}}'),
          ', which are filled in when the page is made.',
        ),
      ),
    ),

    chapter(
      databases,
      'Databases',
      '🗃️',
      5,
      doc(
        p(
          'A database is a page whose subpages are its rows. Each row is a full page with its own content, plus properties like status, dates and numbers. In your vault a database is a folder, and each row is a Markdown file with its properties at the top, readable by any Markdown app.',
        ),
        h(1, 'An example'),
        p(
          'Here is the Reading list, shown right inside this page. Drag cards between columns, click one to open it, and switch views with the tabs:',
        ),
        p(embed(books, 'Reading list')),
        h(1, 'Views'),
        table(
          ['View', 'Good for'],
          ['Table', 'Seeing and editing every property at once'],
          ['Board', 'Moving things through stages, grouped by a select'],
          ['Calendar', 'Anything with a date, drag rows between days'],
          ['List', 'A quiet list of titles'],
          ['Gallery', 'Cards with the first picture of each page as a cover'],
        ),
        p(
          'Each view keeps its own filters, sorts, grouping and hidden properties. Add one with the ',
          k('+'),
          ' next to the view tabs.',
        ),
        h(1, 'Properties'),
        table(
          ['Type', 'Holds'],
          ['Text, Number, Link', 'Words, amounts, web addresses'],
          ['Select, Multi-select', 'One or more coloured choices'],
          ['Date, Checkbox', 'A day, yes or no'],
          ['Relation', 'Links to other pages, written as [[links]] in the file'],
          ['Formula', 'A value worked out from the other properties'],
        ),
        p(
          'Formulas look like ',
          k('prop("Pages") * 2'),
          ' or ',
          k('if(prop("Status") == "Finished", "done", "not yet")'),
          '. Open a formula property from its column header to see every function, with examples.',
        ),
        h(1, 'Make one'),
        bullets(
          [
            'Type ',
            k('/database'),
            ' for a database on its own page, or ',
            k('/inline database'),
            ' for one shown inside the page you are on.',
          ],
          ['Or click ', k('+'), ' next to Pages in the sidebar and choose Database.'],
          ['Import a CSV file from ', b('Import'), ' to turn a spreadsheet into a database.'],
          [
            'Already have a folder of notes? Open its menu and choose ',
            b('Turn subpages into a database'),
            '. Each note becomes a row, and the properties at the top of the notes become columns.',
          ],
        ),
        h(1, 'Properties on any page'),
        p(
          'Pages outside a database can have properties too. Hover under a page’s title and choose ',
          b('Add property'),
          '. They are saved at the top of the file the way other Markdown apps write them, so notes from Obsidian show theirs straight away. Move a page into a database and its properties become columns, move it out and they stay with the page.',
        ),
      ),
    ),
    {
      type: 'page.create',
      id: books,
      parentId: databases,
      now: now - 6,
      title: 'Reading list',
      icon: '📚',
      kind: 'database',
      database,
    },
    book(
      'Middlemarch',
      '📗',
      { [author]: 'George Eliot', [status]: reading, [pages]: 880, [similar]: ['Piranesi'] },
      doc(
        p('Slow and wonderful.'),
        tasks([true, 'Book one'], [true, 'Book two'], [false, 'Book three'], [false, 'Book four']),
      ),
      7,
    ),
    book(
      'The Left Hand of Darkness',
      '❄️',
      { [author]: 'Ursula K. Le Guin', [status]: finished, [rating]: 5, [pages]: 304, [finishedOn]: day(-3) },
      doc(p('Read it again next winter.')),
      8,
    ),
    book(
      'Piranesi',
      '🏛️',
      {
        [author]: 'Susanna Clarke',
        [status]: next,
        [pages]: 272,
        [similar]: ['The Left Hand of Darkness', 'Middlemarch'],
      },
      doc(p('Recommended by a friend.')),
      9,
    ),
    book(
      'A Psalm for the Wild-Built',
      '🌱',
      { [author]: 'Becky Chambers', [status]: finished, [rating]: 4, [pages]: 160, [finishedOn]: day(-10) },
      doc(p('Short, kind and hopeful.')),
      10,
    ),

    chapter(
      canvas,
      'Canvas and drawing',
      '🎨',
      11,
      doc(
        p(
          'A canvas is an endless whiteboard of cards, pages, arrows, groups and freehand ink. Open the ',
          link(board, 'Ideas board'),
          ' below to try it. Canvases are saved as open JSON Canvas files.',
        ),
        h(1, 'Cards and arrows'),
        bullets(
          [
            'Double-click empty space to add a card, and double-click a card to write in it. Cards understand Markdown.',
          ],
          ['Drag a card to move it. Drag its corner to resize it.'],
          ['Select a card and drag from one of the dots on its edges to another card to connect them.'],
          [
            'Use the toolbar at the bottom to add a page as a card, make a group, change colours, undo, and zoom.',
          ],
          ['Drag empty space, or use the middle mouse button, to move around. Hold Ctrl and scroll to zoom.'],
        ),
        h(1, 'Drawing'),
        table(
          ['Tool', 'Key', 'What it does'],
          ['Select', 'V', 'Pick up and move cards'],
          ['Pen', 'P', 'Draw freehand lines'],
          ['Highlighter', 'H', 'Wide see-through strokes over anything'],
          ['Eraser', 'E', 'Drag across lines to remove them'],
        ),
        p(
          'Choose a colour and a thickness from the toolbar while the pen or highlighter is on. Lines drawn close together join into one drawing you can move and resize. Press Escape to go back to selecting.',
        ),
      ),
    ),
    {
      type: 'page.create',
      id: board,
      parentId: canvas,
      now: now - 12,
      title: 'Ideas board',
      kind: 'canvas',
      doc: canvasDoc({
        nodes: [
          { id: 'group', type: 'group', label: 'Try these', x: -40, y: -60, width: 760, height: 330 },
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
            text: 'Select a card, then drag from a dot on its edge to connect it.',
            x: 380,
            y: 0,
            width: 280,
            height: 90,
            color: '5',
          },
          {
            id: 'draw',
            type: 'text',
            text: 'Press P and draw on the canvas. E erases.',
            x: 380,
            y: 150,
            width: 280,
            height: 90,
            color: '4',
          },
          { id: 'page', type: 'page', pageId: welcome, x: 0, y: 340, width: 320, height: 220 },
          {
            id: 'ink',
            type: 'drawing',
            x: 400,
            y: 430,
            width: 330,
            height: 70,
            strokes: [{ points: wave(), width: 4, color: '6' }],
          },
          {
            id: 'star',
            type: 'drawing',
            x: 800,
            y: 330,
            width: 110,
            height: 110,
            strokes: [{ points: star(), width: 4, color: '3' }],
          },
        ],
        edges: [
          { id: 'e1', fromNode: 'start', toNode: 'drag', fromSide: 'right', toSide: 'left' },
          { id: 'e2', fromNode: 'drag', toNode: 'draw', fromSide: 'bottom', toSide: 'top' },
          {
            id: 'e3',
            fromNode: 'start',
            toNode: 'page',
            fromSide: 'bottom',
            toSide: 'top',
            label: 'a page as a card',
          },
        ],
      }),
    },

    chapter(
      memory,
      'Flashcards and review',
      '🧠',
      13,
      doc(
        p(
          'Write a line as a question, two colons and an answer, on any page, and it becomes a flashcard. ',
          b('Review'),
          ' in the sidebar (',
          k('Alt R'),
          ') shows the cards due today. Grade each one and Morrow schedules it again, sooner if you forgot and later if it was easy.',
        ),
        p('What does Morrow never send anywhere? :: Your notes'),
        p('Which key opens today’s note? :: Alt D'),
        p('How do you mention a date? :: Type @ and pick one'),
        p(
          'Edit the question or answer whenever you like. A card keeps its schedule as long as its question stays the same.',
        ),
      ),
    ),

    chapter(
      privacy,
      'Privacy, history and encryption',
      '🔒',
      14,
      doc(
        h(1, 'Nothing leaves your computer'),
        p(
          'Morrow has no servers. It never phones home, has no analytics and no AI. The only time it uses the network is when you ask it to: loading a picture from the web, or syncing with your own devices.',
        ),
        h(1, 'Your vault'),
        p(
          'Your notes live in a vault, a normal folder. Open it from the vault menu at the top of the sidebar, or with ',
          b('Show in folder'),
          ' in a page’s menu. You can edit the files in any app while Morrow is open and it follows along. Keep the folder in a backup or a synced drive if you like.',
        ),
        h(1, 'Page history'),
        p(
          'Morrow keeps earlier versions of a page as you work. Choose ',
          b('Page history'),
          ' from the page menu to see what changed, line by line, and bring back any version.',
        ),
        h(1, 'Password protected pages'),
        numbered(
          ['Choose ', b('Encrypt with a password'), ' from a page’s menu.'],
          ['The file on disk becomes unreadable without the password, using AES-256.'],
          ['Unlock it with the password when you open it, and lock it again from the menu.'],
        ),
        callout(
          'danger',
          'There is no way back',
          p('If you forget the password, nobody can open the page. Not you, and not Morrow.'),
        ),
        h(1, 'Trash'),
        p('Deleted pages go to the Trash in the sidebar first, so a slip is never permanent.'),
      ),
    ),

    chapter(
      sharing,
      'Sync, import, export and publishing',
      '🔄',
      15,
      doc(
        h(1, 'Sync between your devices'),
        p(
          'Open ',
          b('Settings'),
          ' and turn on sync on two computers on the same network. Pair them once with the code one of them shows, and from then on they keep each other up to date directly, with no cloud in between. When both change the same page, both versions are kept so nothing is lost.',
        ),
        p(
          'To sync anywhere, even away from home, keep the vault in a cloud folder you already use. ',
          b('Settings'),
          ' finds your Dropbox, iCloud Drive, Google Drive, OneDrive, Syncthing or Nextcloud folder and moves the vault into it, and that app does the syncing. If a page changes on two computers at once, the copy it keeps is marked so you can compare the two side by side.',
        ),
        h(1, 'Bring your notes in'),
        bullets(
          [
            'From other note apps: export your workspace as Markdown and CSV, then choose the zip in ',
            b('Import'),
            '. Databases come across as databases.',
          ],
          [
            'From a folder of Markdown notes: open it as a Morrow vault. Wiki links, tags, callouts and canvases already work.',
          ],
          ['Markdown files and folders from anywhere else, and CSV files as databases.'],
        ),
        h(1, 'Take them out'),
        bullets(
          [b('Export as Markdown'), ' saves a page with its attachments.'],
          [b('Export as PDF'), ' saves the page as it looks, ready to print or send.'],
          ['Or just copy the vault folder. It already is your export.'],
        ),
        h(1, 'Publish a website'),
        p(
          'Choose ',
          b('Publish as a website'),
          ' from a page’s menu to turn it and its subpages into a small static site, with navigation and working links. Upload the folder to any static web host.',
        ),
      ),
    ),

    chapter(
      custom,
      'Make it yours',
      '⚙️',
      16,
      doc(
        h(1, 'Look and feel'),
        p('In ', b('Settings'), ' (', k('Ctrl ,'), ') choose:'),
        bullets(
          ['Light, dark or the same as your system. ', k('Ctrl Shift L'), ' switches.'],
          ['An accent colour, and whether headings, lists and tags are colourful.'],
          ['A sans, serif or mono font for writing, and a comfortable or wide page.'],
        ),
        h(1, 'Icons and covers'),
        p(
          'Hover over a page title for ',
          b('Add icon'),
          ' and ',
          b('Add cover'),
          '. Icons come from a full emoji picker with search. Covers are colour gradients or any picture from your computer.',
        ),
        h(1, 'Tabs'),
        bullets(
          [
            k('Ctrl T'),
            ' opens a new tab and ',
            k('Ctrl W'),
            ' closes it. ',
            k('Ctrl Tab'),
            ' moves between them.',
          ],
          ['Ctrl click, or middle click, any page in the sidebar or any link to open it in a new tab.'],
          ['Drag tabs to reorder them. They are remembered when you come back.'],
        ),
        h(1, 'The sidebar'),
        bullets(
          ['Drag pages to reorder them or to put one inside another.'],
          ['Right click a page for its menu, or star it to keep it in Favourites.'],
          [k('Ctrl \\'), ' hides the sidebar and drag its edge to resize it.'],
        ),
        h(1, 'Custom CSS'),
        p(
          'Restyle anything from ',
          b('Settings'),
          ', under ',
          b('Custom CSS'),
          '. It is saved in your vault as ',
          k('.morrow/style.css'),
          ' and travels with your notes. For example:',
        ),
        code('css', ':root {\n  --accent: #e5484d;\n}\n.page-title {\n  letter-spacing: -0.03em;\n}'),
        rule(),
        p('That is everything. Delete this guide whenever you are ready, and make Morrow yours.'),
      ),
    ),
    { type: 'page.setFavorite', id: welcome, favorite: true },
  ];
}
