import type { Command } from './commands';
import type { DocMark, DocNode, PageId } from './model';

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
const ul = (...items: Inline[][]): DocNode => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [p(...item)] })),
});
const ol = (...items: Inline[][]): DocNode => ({
  type: 'orderedList',
  attrs: { start: 1 },
  content: items.map((item) => ({ type: 'listItem', content: [p(...item)] })),
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
const hr: DocNode = { type: 'horizontalRule' };
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

// first run content, built from the same commands as everything else
export function sampleCommands(newId: () => PageId, now: number): Command[] {
  const welcome = newId();
  const writing = newId();
  const projects = newId();
  const garden = newId();
  const shelves = newId();
  const reading = newId();

  return [
    {
      type: 'page.create',
      id: welcome,
      parentId: null,
      now,
      title: 'Welcome to Morrow',
      doc: doc(
        p(
          'Morrow is a quiet place to write, plan and keep what you know. It works without an account, without the internet and without AI. Everything you write stays on this computer.',
        ),
        h(2, 'Getting around'),
        ul(
          [
            'Press ',
            t('/', 'code'),
            ' on an empty line to add headings, lists, checklists, tables and more.',
          ],
          ['Type ', t('[[', 'code'), ' to link to another page. Linked pages show a backlink at the bottom.'],
          ['Search everything with ', t('Ctrl K', 'code'), ', or ', t('⌘ K', 'code'), ' on a Mac.'],
          ['Drag pages in the sidebar to reorder or nest them.'],
        ),
        h(2, 'Try it'),
        tasks(
          [false, 'Create a page with ', t('Alt N', 'code')],
          [false, "Open today's note with ", t('Alt D', 'code')],
          [false, 'Look through ', link(writing, 'Writing in Morrow')],
          [true, 'Install Morrow'],
        ),
        h(2, 'Your data is yours'),
        p(
          'Pages are saved automatically as you type. You can save a full backup or export everything as plain Markdown files from ',
          t('Settings', 'bold'),
          ' at any time, and restore a backup on any computer.',
        ),
        quote('Make the fundamental workflows excellent before adding more workflows.'),
        h(3, 'Useful shortcuts'),
        table(
          ['Action', 'Windows and Linux', 'Mac'],
          ['Search and commands', 'Ctrl K', '⌘ K'],
          ['New page', 'Alt N', '⌥ N'],
          ["Today's note", 'Alt D', '⌥ D'],
          ['Move block up or down', 'Alt Shift ↑ ↓', '⌥ ⇧ ↑ ↓'],
          ['Toggle sidebar', 'Ctrl \\', '⌘ \\'],
        ),
      ),
    },
    {
      type: 'page.create',
      id: writing,
      parentId: welcome,
      now: now - 1,
      title: 'Writing in Morrow',
      doc: doc(
        p(
          'Text can be ',
          t('bold', 'bold'),
          ', ',
          t('italic', 'italic'),
          ', ',
          t('underlined', 'underline'),
          ', ',
          t('struck through', 'strike'),
          ' or ',
          t('inline code', 'code'),
          '. Select some text to see the formatting toolbar, or use the usual shortcuts.',
        ),
        p(
          'Links work too: ',
          t('CommonMark', { type: 'link', attrs: { href: 'https://commonmark.org' } }),
          ' is the Markdown flavour Morrow imports and exports.',
        ),
        h(2, 'Markdown shortcuts'),
        p('Start a line with these characters and Morrow turns them into blocks as you type:'),
        ol(
          [t('#', 'code'), ' and a space for a heading, ', t('##', 'code'), ' for a smaller one'],
          [t('-', 'code'), ' for a bulleted list, ', t('1.', 'code'), ' for a numbered list'],
          [t('[ ]', 'code'), ' for a checklist item'],
          [t('>', 'code'), ' for a quotation and ', t('```', 'code'), ' for a code block'],
          [t('---', 'code'), ' for a divider'],
        ),
        code(
          'ts',
          'function tomorrow(today: Date): Date {\n  return new Date(today.getTime() + 24 * 60 * 60 * 1000);\n}',
        ),
        hr,
        p(
          'Hold ',
          t('Alt', 'code'),
          ' and ',
          t('Shift', 'code'),
          ' and press the arrow keys to move the current block up or down, or drag it by the handle that appears on the left.',
        ),
      ),
    },
    {
      type: 'page.create',
      id: projects,
      parentId: null,
      now: now - 2,
      title: 'Projects',
      doc: doc(
        p(
          'Active projects live here as subpages. Open ',
          link(garden, 'Garden redesign'),
          ' to see a plan with tasks.',
        ),
      ),
    },
    {
      type: 'page.create',
      id: garden,
      parentId: projects,
      now: now - 3,
      title: 'Garden redesign',
      doc: doc(
        p('Goal: a low maintenance garden that looks good from the kitchen window in every season.'),
        h(2, 'Next steps'),
        tasks(
          [true, 'Measure the beds along the south fence'],
          [false, 'Order cedar boards for two raised beds'],
          [false, 'Ask the neighbours about sharing a compost bin'],
          [false, 'Move the rosemary before the first frost'],
        ),
        h(2, 'Planting plan'),
        table(
          ['Plant', 'Where', 'When'],
          ['Tomatoes', 'Raised bed one', 'May'],
          ['Lavender', 'Along the path', 'April'],
          ['Garlic', 'Raised bed two', 'October'],
        ),
        quote('The best time to plant a tree was twenty years ago. The second best time is now.'),
      ),
    },
    {
      type: 'page.create',
      id: shelves,
      parentId: projects,
      now: now - 4,
      title: 'Kitchen shelves',
      doc: doc(
        p('Two floating oak shelves above the counter, 90 cm wide.'),
        tasks([false, 'Find the studs and mark them'], [false, 'Buy brackets rated for 25 kg']),
      ),
    },
    {
      type: 'page.create',
      id: reading,
      parentId: null,
      now: now - 5,
      title: 'Reading list',
      doc: doc(
        p('Books to read, reading and read.'),
        table(
          ['Title', 'Author', 'Status'],
          ['Middlemarch', 'George Eliot', 'Reading'],
          ['The Left Hand of Darkness', 'Ursula K. Le Guin', 'Finished'],
          ['Piranesi', 'Susanna Clarke', 'Next'],
        ),
      ),
    },
    { type: 'page.setFavorite', id: welcome, favorite: true },
  ];
}
