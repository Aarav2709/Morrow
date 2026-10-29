import { describe, expect, it } from 'vitest';
import { canvasDoc, readCanvas, writeCanvas } from './canvas';
import { applyCommand } from './commands';
import { decryptPage, deriveKey, encryptPage, isEncryptedText } from './crypto';
import { daysWithNotes, neighbourNotes, pagesMadeOn } from './daily';
import { diffLines } from './diff';
import type { Command } from './commands';
import {
  convertValue,
  databaseFromTable,
  defaultDatabase,
  groupRows,
  inferType,
  visibleRows,
} from './database';
import {
  cardsInDeck,
  collectCards,
  decksOf,
  dueCards,
  readReviewLog,
  schedule,
  writeReviewLog,
} from './flashcards';
import { buildGraph, DEFAULT_GRAPH_OPTIONS } from './graph';
import { activityWeeks, onThisDay, streak } from './insights';
import { emptyWorkspace, newPageMeta } from './model';
import type { DocNode, PageMeta, ViewDef, WorkspaceState } from './model';
import { unlinkedMentions } from './links';
import { searchWorkspace } from './search';
import { buildSite } from './site';
import { planPull } from './sync';
import { collectTags, pagesWithTag } from './tags';
import { applyTemplate, fillTemplate, formatDate, hasPlaceholder } from './templates';
import { linkTargets, placePages } from './vault/layout';
import { planMoves } from './vault/plan';

let n = 0;
const id = () => `x${++n}`;
const p = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });

function run(state: WorkspaceState, ...commands: Command[]): WorkspaceState {
  let current = state;
  for (const command of commands) {
    const result = applyCommand(current, command);
    if (!result.ok) throw new Error(result.error);
    current = result.value.state;
  }
  return current;
}

describe('databases', () => {
  const database = defaultDatabase(id);
  const [status, date] = database.properties;
  const [todo, doing, done] = status!.options;
  const row = (title: string, values: PageMeta['properties'], order: number) =>
    newPageMeta({ id: title, parentId: 'db', title, order, properties: values });
  const rows = [
    row('Paint', { [status!.id]: doing!.id, [date!.id]: '2026-10-02' }, 0),
    row('Plant', { [status!.id]: todo!.id, [date!.id]: '2026-09-20' }, 1),
    row('Prune', { [status!.id]: done!.id }, 2),
    row('Plan', {}, 3),
  ];
  const view = (patch: Partial<ViewDef>): ViewDef => ({ ...database.views[0]!, ...patch });

  it('filters and sorts rows, empty values last', () => {
    const shown = visibleRows(
      rows,
      view({
        filters: [{ id: 'f', prop: 'title', op: 'contains', value: 'p' }],
        sorts: [{ prop: date!.id, dir: 'asc' }],
      }),
      database,
    );
    expect(shown.map((page) => page.title)).toEqual(['Plant', 'Paint', 'Prune', 'Plan']);
    const notDone = visibleRows(
      rows,
      view({ filters: [{ id: 'f', prop: status!.id, op: 'isNot', value: done!.id }] }),
      database,
    );
    expect(notDone.map((page) => page.title)).toEqual(['Paint', 'Plant', 'Plan']);
  });

  it('groups rows into board columns with a column for rows without a value', () => {
    const groups = groupRows(rows, status!.id, database);
    expect(groups.map((group) => [group.label, group.rows.map((page) => page.title)])).toEqual([
      ['No status', ['Plan']],
      ['To do', ['Plant']],
      ['Doing', ['Paint']],
      ['Done', ['Prune']],
    ]);
  });

  it('keeps values that make sense when a property changes type', () => {
    expect(convertValue(status!, { ...status!, type: 'text', options: [] }, doing!.id)).toBe('Doing');
    expect(convertValue({ ...status!, type: 'text' }, { ...status!, type: 'number' }, '42 pages')).toBe(42);
  });

  it('infers column types from csv values', () => {
    expect(inferType(['1', '2.5', ''])).toBe('number');
    expect(inferType(['Yes', 'No'])).toBe('checkbox');
    expect(inferType(['2026-01-02', 'March 3, 2025'])).toBe('date');
    expect(inferType(['Reading', 'Next', 'Reading', 'Finished'])).toBe('select');
    expect(inferType(['https://a.org', 'https://b.org'])).toBe('url');
    const made = databaseFromTable(
      ['Name', 'Tags', 'Note'],
      [
        ['a', 'x', 'free text one'],
        ['b', 'y', 'free text two'],
      ],
      id,
    );
    expect(made.properties.map((prop) => prop.name)).toEqual(['Tags', 'Note']);
    // the lower case name is morrow's own frontmatter key, so that column is renamed
    expect(databaseFromTable(['Name', 'tags'], [['a', 'x']], id).properties[0]!.name).toBe('tags 2');
  });

  it('accepts database commands and rejects bad values', () => {
    let state = run(emptyWorkspace(), {
      type: 'page.create',
      id: 'db',
      parentId: null,
      now: 1,
      kind: 'database',
      database,
    });
    state = run(state, { type: 'page.create', id: 'r', parentId: 'db', now: 2 });
    state = run(state, { type: 'page.setProperties', id: 'r', values: { [status!.id]: todo!.id }, now: 3 });
    expect(state.pages.r!.properties).toEqual({ [status!.id]: todo!.id });
    state = run(state, { type: 'page.setProperties', id: 'r', values: { [status!.id]: null }, now: 4 });
    expect(state.pages.r!.properties).toEqual({});
    expect(
      applyCommand(state, { type: 'page.setProperties', id: 'r', values: { a: { x: 1 } as never }, now: 5 })
        .ok,
    ).toBe(false);
    expect(applyCommand(state, { type: 'database.set', id: 'r', database, now: 5 }).ok).toBe(false);
  });
});

describe('templates', () => {
  const date = new Date(2026, 9, 15, 9, 5);
  it('fills dates, times and titles like obsidian templates', () => {
    expect(fillTemplate('{{title}} on {{date}} at {{time}}', { title: 'Standup', date })).toBe(
      'Standup on 2026-10-15 at 09:05',
    );
    expect(formatDate(date, 'DD/MM/YY [week]', 'en-GB')).toBe('15/10/26 week');
    const filled = applyTemplate(doc(p('Notes for {{date:YYYY}}')), { title: '', date });
    expect(filled).toEqual(doc(p('Notes for 2026')));
  });

  it('knows a title that asks for the date filled in', () => {
    expect(hasPlaceholder('Standup {{date}}')).toBe(true);
    expect(hasPlaceholder('Week of {{ date:D MMMM }}')).toBe(true);
    expect(hasPlaceholder('Weekly review')).toBe(false);
    expect(hasPlaceholder('{{ not a placeholder }}')).toBe(false);
  });
});

describe('tags and graph', () => {
  const state = run(
    emptyWorkspace(),
    {
      type: 'page.create',
      id: 'a',
      parentId: null,
      now: 1,
      title: 'Alpha',
      tags: ['project/garden'],
      doc: doc(p('See the #ideas list')),
    },
    {
      type: 'page.create',
      id: 'b',
      parentId: null,
      now: 2,
      title: 'Beta',
      doc: doc({ type: 'paragraph', content: [{ type: 'pageLink', attrs: { id: 'a', label: 'Alpha' } }] }),
    },
    { type: 'page.create', id: 'c', parentId: null, now: 3, title: 'Lonely', doc: doc(p('`#notatag` here')) },
  );

  it('collects tags from properties and text, with nested tags', () => {
    expect(collectTags(state).map((entry) => entry.tag)).toEqual(['ideas', 'project/garden']);
    expect(pagesWithTag(state, 'project').map((page) => page.id)).toEqual(['a']);
    expect(searchWorkspace(state, '#ideas').map((result) => result.page.id)).toEqual(['a']);
  });

  it('builds the link graph and a local graph', () => {
    const all = buildGraph(state, DEFAULT_GRAPH_OPTIONS);
    expect(all.links).toEqual([{ source: 'b', target: 'a', kind: 'link' }]);
    expect(
      buildGraph(state, { ...DEFAULT_GRAPH_OPTIONS, orphans: false })
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(buildGraph(state, { ...DEFAULT_GRAPH_OPTIONS, focus: 'c' }).nodes.map((node) => node.id)).toEqual([
      'c',
    ]);
    const withTags = buildGraph(state, { ...DEFAULT_GRAPH_OPTIONS, tags: true });
    expect(withTags.nodes.some((node) => node.id === '#ideas')).toBe(true);
  });
});

describe('vault layout', () => {
  it('swaps two names through a temporary name instead of overwriting', () => {
    let state = run(
      emptyWorkspace(),
      { type: 'page.create', id: 'a', parentId: null, now: 1, title: 'A' },
      { type: 'page.create', id: 'b', parentId: null, now: 2, title: 'B' },
    );
    const before = placePages(state, new Map(), new Set());
    state = run(
      state,
      { type: 'page.rename', id: 'a', title: 'B', now: 3 },
      { type: 'page.rename', id: 'b', title: 'A', now: 3 },
    );
    const after = placePages(state, before, new Set());
    expect(after.get('a')!.file).toBe('B.md');
    const ops = planMoves(before, after);
    const files = new Set(['A.md', 'B.md']);
    for (const op of ops) {
      if (op.op !== 'rename' || !op.from.endsWith('.md')) continue;
      expect(files.has(op.to)).toBe(false);
      files.delete(op.from);
      files.add(op.to);
    }
    expect([...files].sort()).toEqual(['A.md', 'B.md']);
  });

  it('names links by file name, and by path only when names repeat', () => {
    const state = run(
      emptyWorkspace(),
      { type: 'page.create', id: 'p', parentId: null, now: 1, title: 'Projects' },
      { type: 'page.create', id: 'n1', parentId: null, now: 2, title: 'Notes' },
      { type: 'page.create', id: 'n2', parentId: 'p', now: 3, title: 'Notes' },
    );
    const targets = linkTargets(placePages(state, new Map(), new Set()));
    expect(targets.get('p')).toBe('Projects');
    expect(targets.get('n2')).toBe('Projects/Notes');
  });
});

describe('canvas files', () => {
  it('reads and writes json canvas with pages by path', () => {
    const raw = {
      nodes: [
        { id: 'a', type: 'file', file: 'Notes/Plan.md', x: 0, y: 0, width: 300, height: 200 },
        { id: 'b', type: 'text', text: 'hi', x: 400, y: 0, width: 200, height: 60, color: '4' },
        { id: 'bad', type: 'mystery' },
      ],
      edges: [
        { id: 'e', fromNode: 'a', toNode: 'b', toEnd: 'arrow' },
        { id: 'dangling', fromNode: 'a', toNode: 'gone' },
      ],
    };
    const data = readCanvas(raw, (path) => (path === 'Notes/Plan.md' ? 'plan' : null))!;
    expect(data.nodes.map((node) => node.type)).toEqual(['page', 'text']);
    expect(data.edges).toHaveLength(1);
    const written = JSON.parse(writeCanvas(data, () => 'Notes/Plan.md')) as {
      nodes: Array<{ type: string; file?: string }>;
    };
    expect(written.nodes[0]).toMatchObject({ type: 'file', file: 'Notes/Plan.md' });
    expect(canvasDoc(data).content![0]!.type).toBe('canvas');
  });
});

describe('publishing and mentions', () => {
  const state = run(
    emptyWorkspace(),
    {
      type: 'page.create',
      id: 'home',
      parentId: null,
      now: 1,
      title: 'Garden <notes>',
      doc: doc(p('See below')),
    },
    {
      type: 'page.create',
      id: 'beds',
      parentId: 'home',
      now: 2,
      title: 'Raised beds',
      doc: doc(
        {
          type: 'paragraph',
          content: [
            { type: 'pageLink', attrs: { id: 'home', label: 'Garden' } },
            { type: 'text', text: ' and <script>' },
          ],
        },
        { type: 'image', attrs: { fileId: 'attachments/beds.png', alt: 'Beds' } },
        { type: 'image', attrs: { fileId: null, src: 'https://tracker.example/pixel.gif', alt: 'pixel' } },
      ),
    },
    {
      type: 'page.create',
      id: 'other',
      parentId: null,
      now: 3,
      title: 'Shed',
      doc: doc(p('The raised beds need wood.')),
    },
  );

  it('builds a site of plain pages that never loads anything from elsewhere', () => {
    const site = buildSite(state, { rootId: 'home', title: 'My garden' });
    const paths = site.files.map((file) => file.path).sort();
    expect(paths).toEqual(['index.html', 'raised-beds.html', 'style.css']);
    const beds = site.files.find((file) => file.path === 'raised-beds.html')!.content;
    expect(beds).toContain('<a class="page-link" href="index.html">Garden &lt;notes&gt;</a>');
    expect(beds).toContain('and &lt;script&gt;');
    expect(beds).not.toContain('<img src="https://');
    expect(beds).not.toContain('<script');
    expect([...site.assets.keys()]).toEqual(['attachments/beds.png']);
    expect(site.files.find((file) => file.path === 'index.html')!.content).toContain('Linked from');
  });

  it('finds pages that name a page without linking to it', () => {
    expect(unlinkedMentions(state, 'beds').map((mention) => mention.source.id)).toEqual(['other']);
    expect(unlinkedMentions(state, 'beds')[0]!.context).toBe('The raised beds need wood.');
  });
});

describe('home insights', () => {
  it('counts a writing streak and lays out weeks of activity', () => {
    const today = new Date(2026, 9, 15);
    expect(streak({ '2026-10-15': 3, '2026-10-14': 1, '2026-10-13': 2, '2026-10-11': 5 }, today)).toBe(3);
    expect(streak({ '2026-10-14': 1, '2026-10-13': 2 }, today)).toBe(2);
    expect(streak({}, today)).toBe(0);
    const weeks = activityWeeks({ '2026-10-15': 4 }, today, 4);
    expect(weeks).toHaveLength(4);
    expect(weeks[3]!.find((day) => day.key === '2026-10-15')!.count).toBe(4);
    expect(weeks[3]!.at(-1)!.future).toBe(true);
    expect(weeks[0]![0]!.key).toBe('2026-09-21');
  });

  it('finds notes from this day in earlier years', () => {
    const state = run(
      emptyWorkspace(),
      { type: 'page.create', id: 'j', parentId: null, now: 1, kind: 'journal', title: 'Journal' },
      { type: 'page.create', id: 'old', parentId: 'j', now: 1, dailyDate: '2025-10-15', title: 'Last year' },
      { type: 'page.create', id: 'now', parentId: 'j', now: 1, dailyDate: '2026-10-15', title: 'Today' },
    );
    expect(onThisDay(state, new Date(2026, 9, 15)).map((page) => page.id)).toEqual(['old']);
  });

  it('steps between daily notes and lists the pages made on a day', () => {
    const made = new Date(2026, 9, 15, 14, 30).getTime();
    const state = run(
      emptyWorkspace(),
      { type: 'page.create', id: 'j', parentId: null, now: 1, kind: 'journal', title: 'Journal' },
      { type: 'page.create', id: 'a', parentId: 'j', now: made, dailyDate: '2026-10-01', title: 'A' },
      { type: 'page.create', id: 'b', parentId: 'j', now: made, dailyDate: '2026-10-15', title: 'B' },
      { type: 'page.create', id: 'c', parentId: 'j', now: made, dailyDate: '2026-10-20', title: 'C' },
      { type: 'page.create', id: 'meeting', parentId: null, now: made, title: 'Dentist' },
      { type: 'page.create', id: 'later', parentId: null, now: made + 86_400_000, title: 'Tomorrow' },
      { type: 'page.create', id: 'gone', parentId: null, now: made, title: 'Gone' },
      { type: 'page.trash', id: 'gone', now: made },
    );
    const around = neighbourNotes(state, '2026-10-15');
    expect([around.previous?.id, around.next?.id]).toEqual(['a', 'c']);
    // a day without a note of its own still finds the notes either side
    const gap = neighbourNotes(state, '2026-10-10');
    expect([gap.previous?.id, gap.next?.id]).toEqual(['a', 'b']);
    expect(neighbourNotes(state, '2026-10-01').previous).toBeNull();
    expect(pagesMadeOn(state, '2026-10-15').map((page) => page.id)).toEqual(['meeting']);
    expect([...daysWithNotes(state)].sort()).toEqual(['2026-10-01', '2026-10-15', '2026-10-20']);
  });
});

describe('encrypted pages', () => {
  it('encrypts a page so only the right password opens it', async () => {
    const plain = '---\ntags: [secret]\n---\nMy diary.\n';
    const pageKey = await deriveKey('correct horse', new Uint8Array(16).fill(7), 100_000);
    const file = await encryptPage(plain, pageKey);
    expect(file).not.toContain('diary');
    expect(file).not.toContain('secret');
    expect(isEncryptedText(file)).toBe(true);
    expect(isEncryptedText(plain)).toBe(false);
    expect((await decryptPage(file, 'correct horse'))?.plain).toBe(plain);
    expect(await decryptPage(file, 'wrong')).toBeNull();
    // every save uses a new nonce, so the same text never looks the same twice
    expect(await encryptPage(plain, pageKey)).not.toBe(file);
  });
});

describe('sync between computers', () => {
  const day = new Date(2026, 9, 16);
  // runs one pull, applying the plan to the local files the way the desktop app does
  const pull = (
    local: Record<string, string>,
    remote: Record<string, string>,
    base: Record<string, string>,
    device: string,
  ) => {
    const plan = planPull(local, remote, base, device, day);
    const files = { ...local };
    for (const action of plan.actions) {
      if (action.kind === 'delete') delete files[action.path];
      else if (action.kind === 'download') files[action.path] = remote[action.path]!;
      else {
        files[action.copy] = files[action.path]!;
        files[action.path] = remote[action.path]!;
      }
    }
    return { files, base: plan.base };
  };
  // file contents stand in for their hashes
  const both = (a: Record<string, string>, b: Record<string, string>, base: Record<string, string>) => {
    let ab = { ...base };
    let ba = { ...base };
    let left = a;
    let right = b;
    for (let round = 0; round < 3; round++) {
      const x = pull(left, right, ab, 'Laptop');
      left = x.files;
      ab = x.base;
      const y = pull(right, left, ba, 'Desktop');
      right = y.files;
      ba = y.base;
    }
    return { left, right };
  };

  it('copies new and changed files and passes on deletions', () => {
    const base = { 'a.md': '1', 'b.md': '1', 'c.md': '1' };
    const { left, right } = both(
      { 'a.md': '2', 'b.md': '1', 'c.md': '1', 'new.md': 'n' },
      { 'a.md': '1', 'b.md': '1' },
      base,
    );
    expect(left).toEqual({ 'a.md': '2', 'b.md': '1', 'new.md': 'n' });
    expect(right).toEqual(left);
  });

  it('keeps both versions when both computers edited a file, and settles on one name', () => {
    const { left, right } = both({ 'a.md': 'laptop' }, { 'a.md': 'desktop' }, { 'a.md': 'old' });
    expect(right).toEqual(left);
    expect(Object.values(left).sort()).toEqual(['desktop', 'laptop']);
    expect(Object.keys(left).filter((path) => path.includes('conflict'))).toHaveLength(1);
  });

  it('prefers an edit over a deletion and ignores tool folders', () => {
    const { left, right } = both(
      { 'a.md': 'edited', '.obsidian/x.json': 'mine' },
      { '.obsidian/x.json': 'theirs' },
      { 'a.md': 'old' },
    );
    expect(left['a.md']).toBe('edited');
    expect(right['a.md']).toBe('edited');
    expect(right['.obsidian/x.json']).toBe('theirs');
  });
});

describe('flashcards', () => {
  const today = new Date(2026, 9, 16);
  const state = run(emptyWorkspace(), {
    type: 'page.create',
    id: 'fr',
    parentId: null,
    now: 1,
    title: 'French',
    doc: doc(p('cat :: le chat'), p('just a line'), {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [p('dog :: le chien')] }],
    }),
  });

  it('finds question :: answer lines anywhere in a page', () => {
    expect(collectCards(state).map((card) => [card.front, card.back])).toEqual([
      ['cat', 'le chat'],
      ['dog', 'le chien'],
    ]);
  });

  it('spaces reviews out and starts over when a card is forgotten', () => {
    const first = schedule(undefined, 'good', today);
    expect(first).toMatchObject({ interval: 1, due: '2026-10-17', reps: 1 });
    const second = schedule(first, 'good', new Date(2026, 9, 17));
    expect(second.interval).toBe(6);
    const third = schedule(second, 'good', new Date(2026, 9, 23));
    expect(third.interval).toBeGreaterThan(12);
    const forgot = schedule(third, 'again', new Date(2026, 10, 10));
    expect(forgot).toMatchObject({ interval: 1, reps: 0, lapses: 1 });
    const cards = collectCards(state);
    const log = { [cards[0]!.id]: first };
    expect(dueCards(cards, log, today).map((card) => card.front)).toEqual(['dog']);
    expect(readReviewLog(JSON.parse(writeReviewLog(log)))).toEqual(log);
  });

  it('studies a page and the pages inside it as a deck of their own', () => {
    const languages = run(
      state,
      { type: 'page.create', id: 'lang', parentId: null, now: 1, title: 'Languages' },
      { type: 'page.move', id: 'fr', parentId: 'lang' },
      {
        type: 'page.create',
        id: 'de',
        parentId: 'lang',
        now: 1,
        title: 'German',
        doc: doc(p('cat :: die Katze')),
      },
      {
        type: 'page.create',
        id: 'bio',
        parentId: null,
        now: 1,
        title: 'Biology',
        doc: doc(p('cell :: smallest unit')),
      },
    );
    const cards = collectCards(languages);
    expect(cardsInDeck(cards, languages.pages, 'lang').map((card) => card.back)).toEqual([
      'le chat',
      'le chien',
      'die Katze',
    ]);
    expect(cardsInDeck(cards, languages.pages, 'de')).toHaveLength(1);
    expect(decksOf(cards, languages.pages).map((deck) => [deck.path, deck.cards])).toEqual([
      ['Biology', 1],
      ['Languages', 3],
      ['Languages / French', 2],
      ['Languages / German', 1],
    ]);
  });
});

describe('version differences', () => {
  it('marks added and removed lines', () => {
    expect(diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'same', text: 'd' },
      { kind: 'added', text: 'e' },
    ]);
  });
});
