import { describe, expect, it } from 'vitest';
import { canvasFromDoc } from '../core/canvas';
import type { Command } from '../core/commands';
import type { DocNode, PageId } from '../core/model';
import { MemoryVault } from './memoryVault';
import { WorkspaceSession } from './session';
import { VaultRepository } from './vaultRepository';

let counter = 0;
const newId = () => `id${++counter}`;

const doc = (...texts: string[]): DocNode => ({
  type: 'doc',
  content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

async function open(vault: MemoryVault): Promise<WorkspaceSession> {
  const session = await WorkspaceSession.open(new VaultRepository(vault, newId), { delayMs: 0 });
  if (!session.ok) throw new Error(session.error);
  return session.value;
}

function idOf(session: WorkspaceSession, title: string): PageId {
  const page = Object.values(session.getState().pages).find((candidate) => candidate.title === title);
  if (!page) throw new Error(`no page ${title}`);
  return page.id;
}

async function run(session: WorkspaceSession, command: Command): Promise<void> {
  const result = session.execute(command);
  if (!result.ok) throw new Error(result.error);
  await session.flush();
}

const OBSIDIAN = {
  'Welcome.md': '---\ntags: [start]\ncssclasses: wide\n---\n# Hello\n\nSee [[Projects/Garden|the garden]].\n',
  'Projects.md': 'All my projects.\n',
  'Projects/Garden.md': 'Back to [[Welcome]].\n\n* loose   formatting  kept\n',
  'Ideas/Loose idea.md': 'Just a thought with ![[pic.png]]\n',
  'attachments/pic.png': 'PNG',
  'Board.canvas': JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', text: 'hello', x: 0, y: 0, width: 200, height: 80 },
      { id: 'b', type: 'file', file: 'Projects/Garden.md', x: 300, y: 0, width: 200, height: 80 },
    ],
    edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
  }),
  '.obsidian/app.json': '{}',
};

describe('opening a folder of markdown files', () => {
  it('reads pages, folders, links, images and canvases', async () => {
    const vault = new MemoryVault(OBSIDIAN);
    const session = await open(vault);
    const state = session.getState();
    const titles = Object.values(state.pages)
      .map((page) => page.title)
      .sort();
    expect(titles).toEqual(['Board', 'Garden', 'Ideas', 'Loose idea', 'Projects', 'Welcome']);
    const garden = idOf(session, 'Garden');
    expect(state.pages[garden]!.parentId).toBe(idOf(session, 'Projects'));
    expect(state.pages[idOf(session, 'Loose idea')]!.parentId).toBe(idOf(session, 'Ideas'));
    expect(state.pages[idOf(session, 'Welcome')]!.tags).toEqual(['start']);
    const link = state.docs[idOf(session, 'Welcome')]!.content![1]!.content![1]!;
    expect(link.attrs).toMatchObject({ id: garden, alias: 'the garden' });
    const image = state.docs[idOf(session, 'Loose idea')]!.content!.find((node) => node.type === 'image');
    expect(image?.attrs?.fileId).toBe('attachments/pic.png');
    const board = canvasFromDoc(state.docs[idOf(session, 'Board')]);
    expect(board.nodes[1]).toMatchObject({ type: 'page', pageId: garden });
    expect(session.firstRun).toBe(false);
    await session.close();
  });

  it('only rewrites the file that was edited and keeps unknown properties', async () => {
    const vault = new MemoryVault(OBSIDIAN);
    const session = await open(vault);
    const welcome = idOf(session, 'Welcome');
    await run(session, { type: 'page.setDoc', id: welcome, doc: doc('Rewritten'), now: 5 });
    expect(vault.text('Welcome.md')).toBe('---\ntags: [start]\ncssclasses: wide\n---\nRewritten\n');
    expect(vault.text('Projects/Garden.md')).toBe(OBSIDIAN['Projects/Garden.md']);
    expect(vault.text('Board.canvas')).toBe(OBSIDIAN['Board.canvas']);
    await session.close();
  });

  it('changes only the frontmatter when only an icon or tags change', async () => {
    const vault = new MemoryVault(OBSIDIAN);
    const session = await open(vault);
    const welcome = idOf(session, 'Welcome');
    await run(session, { type: 'page.setIcon', id: welcome, icon: '📝', now: 5 });
    await run(session, { type: 'page.setTags', id: welcome, tags: ['start', 'new'], now: 6 });
    const text = vault.text('Welcome.md')!;
    expect(text.slice(text.indexOf('# Hello'))).toBe(
      OBSIDIAN['Welcome.md'].slice(OBSIDIAN['Welcome.md'].indexOf('# Hello')),
    );
    expect(text).toContain('icon: 📝');
    expect(text).toContain('cssclasses: wide');
    await session.close();
  });

  it('renames the file and updates links in other files without touching the rest of them', async () => {
    const vault = new MemoryVault(OBSIDIAN);
    const session = await open(vault);
    await run(session, { type: 'page.rename', id: idOf(session, 'Welcome'), title: 'Start here', now: 5 });
    expect(vault.text('Welcome.md')).toBeUndefined();
    expect(vault.text('Start here.md')).toBe(OBSIDIAN['Welcome.md']);
    expect(vault.text('Projects/Garden.md')).toBe('Back to [[Start here]].\n\n* loose   formatting  kept\n');
    await session.close();
  });

  it('moves pages with their folders and tidies up empty folders', async () => {
    const vault = new MemoryVault(OBSIDIAN);
    const session = await open(vault);
    await run(session, { type: 'page.move', id: idOf(session, 'Garden'), parentId: null });
    expect(vault.text('Garden.md')).toContain('Back to [[Welcome]]');
    expect(vault.dirs.has('Projects')).toBe(false);
    // the canvas follows the page to its new path
    expect(JSON.parse(vault.text('Board.canvas')!).nodes[1].file).toBe('Garden.md');
    await run(session, {
      type: 'page.move',
      id: idOf(session, 'Garden'),
      parentId: idOf(session, 'Welcome'),
    });
    expect(vault.text('Welcome/Garden.md')).toBeDefined();
    await session.close();
  });

  it('keeps trashed pages in .trash and puts them back on restore', async () => {
    const vault = new MemoryVault(OBSIDIAN);
    const session = await open(vault);
    const projects = idOf(session, 'Projects');
    await run(session, { type: 'page.trash', id: projects, now: 99 });
    expect(vault.paths()).toEqual(
      expect.arrayContaining(['.trash/Projects.md', '.trash/Projects/Garden.md']),
    );
    expect(vault.text('Projects.md')).toBeUndefined();

    const reopened = await open(vault);
    expect(reopened.getState().pages[projects]!.trashedAt).toBe(99);
    await run(reopened, { type: 'page.restore', id: projects });
    expect(vault.text('Projects/Garden.md')).toBe(OBSIDIAN['Projects/Garden.md']);
    await run(reopened, { type: 'page.trash', id: projects, now: 100 });
    await run(reopened, { type: 'page.deleteForever', id: projects });
    expect(vault.trashed).toEqual(
      expect.arrayContaining(['.trash/Projects.md', '.trash/Projects/Garden.md']),
    );
    await session.close();
    await reopened.close();
  });

  it('remembers ids, order and favourites across restarts', async () => {
    const vault = new MemoryVault(OBSIDIAN);
    const session = await open(vault);
    const ideas = idOf(session, 'Ideas');
    await run(session, { type: 'page.setFavorite', id: ideas, favorite: true });
    await run(session, { type: 'page.move', id: ideas, parentId: null, index: 0 });
    const reopened = await open(vault);
    expect(reopened.getState().pages[ideas]).toMatchObject({ favorite: true, order: 0 });
    await reopened.close();
    await session.close();
  });

  it('treats empty folders as pages, except the attachments folder', async () => {
    const vault = new MemoryVault({ 'Note.md': 'hi\n' });
    vault.dirs.add('attachments');
    vault.dirs.add('Someday');
    const session = await open(vault);
    expect(
      Object.values(session.getState().pages)
        .map((page) => page.title)
        .sort(),
    ).toEqual(['Note', 'Someday']);
    await session.close();
  });

  it('creates files for new pages and suffixes duplicate names', async () => {
    const vault = new MemoryVault();
    const session = await open(vault);
    expect(session.firstRun).toBe(true);
    await run(session, { type: 'page.create', id: 'a', parentId: null, now: 1, doc: doc('one') });
    await run(session, { type: 'page.create', id: 'b', parentId: null, now: 2, doc: doc('two') });
    await run(session, { type: 'page.create', id: 'c', parentId: 'a', now: 3, title: 'Child' });
    expect(vault.text('Untitled.md')).toBe('one\n');
    expect(vault.text('Untitled 2.md')).toBe('---\ntitle: Untitled\n---\ntwo\n');
    expect(vault.text('Untitled/Child.md')).toBe('');
    await session.close();
  });
});

describe('edits made outside morrow', () => {
  it('picks up changed, new and deleted files', async () => {
    const vault = new MemoryVault(OBSIDIAN);
    const session = await open(vault);
    const garden = idOf(session, 'Garden');
    vault.external({
      'Projects/Garden.md': 'Edited in another app.\n',
      'Projects/Orchard.md': 'New from git pull.\n',
      'Ideas/Loose idea.md': null,
    });
    const state = session.getState();
    expect(state.docs[garden]).toEqual(doc('Edited in another app.'));
    expect(idOf(session, 'Orchard')).toBeDefined();
    expect(state.pages[idOf(session, 'Orchard')]!.parentId).toBe(idOf(session, 'Projects'));
    expect(Object.values(state.pages).some((page) => page.title === 'Loose idea')).toBe(false);
    // a save afterwards leaves the outside edit alone
    await run(session, { type: 'page.rename', id: idOf(session, 'Welcome'), title: 'Welcome!', now: 9 });
    expect(vault.text('Projects/Garden.md')).toBe('Edited in another app.\n');
    await session.close();
  });

  it('treats a file that moved as the same page', async () => {
    const vault = new MemoryVault(OBSIDIAN);
    const session = await open(vault);
    const welcome = idOf(session, 'Welcome');
    vault.external({ 'Welcome.md': null, 'Projects/Welcome.md': OBSIDIAN['Welcome.md'] });
    expect(session.getState().pages[welcome]!.parentId).toBe(idOf(session, 'Projects'));
    await session.close();
  });

  it('keeps unsaved edits and saves the other version in page history', async () => {
    const vault = new MemoryVault(OBSIDIAN);
    const session = await open(vault);
    const garden = idOf(session, 'Garden');
    session.execute({ type: 'page.setDoc', id: garden, doc: doc('Mine'), now: 5 });
    vault.external({ 'Projects/Garden.md': 'Theirs\n' });
    expect(session.getState().docs[garden]).toEqual(doc('Mine'));
    await session.flush();
    expect(vault.text('Projects/Garden.md')).toBe('Mine\n');
    const history = await session.listSnapshots(garden);
    expect(history.some((snapshot) => JSON.stringify(snapshot.doc).includes('Theirs'))).toBe(true);
    await session.close();
  });
});

describe('databases and journals in files', () => {
  it('writes row properties as readable frontmatter and reads them back', async () => {
    const vault = new MemoryVault();
    const session = await open(vault);
    const database = {
      properties: [
        {
          id: 'status',
          name: 'Status',
          type: 'select' as const,
          options: [{ id: 'o1', name: 'Reading', color: 'blue' as const }],
        },
        { id: 'pages', name: 'Pages', type: 'number' as const, options: [] },
      ],
      views: [
        {
          id: 'v',
          name: 'All',
          type: 'table' as const,
          filters: [],
          sorts: [],
          groupBy: null,
          dateProp: null,
          hidden: [],
        },
      ],
    };
    await run(session, {
      type: 'page.create',
      id: 'db',
      parentId: null,
      now: 1,
      title: 'Books',
      kind: 'database',
    });
    await run(session, { type: 'database.set', id: 'db', database, now: 2 });
    await run(session, { type: 'page.create', id: 'row', parentId: 'db', now: 3, title: 'Piranesi' });
    await run(session, {
      type: 'page.setProperties',
      id: 'row',
      values: { status: 'o1', pages: 272 },
      now: 4,
    });
    expect(vault.text('Books/Piranesi.md')).toBe('---\nStatus: Reading\nPages: 272\n---\n');
    expect(vault.text('Books.md')).toContain('kind: database');

    vault.external({ 'Books/Jonathan Strange.md': '---\nStatus: Finished\nPages: 782\n---\nLong.\n' });
    const reopened = await open(vault);
    const row = Object.values(reopened.getState().pages).find((page) => page.title === 'Jonathan Strange')!;
    const db = reopened.getState().pages.db!.database!;
    const finished = db.properties[0]!.options.find((option) => option.name === 'Finished');
    expect(row.properties).toEqual({ status: finished!.id, pages: 782 });
    await session.close();
    await reopened.close();
  });

  it('names daily notes by date and titles them in words', async () => {
    const vault = new MemoryVault({
      'Journal.md': '---\nkind: journal\n---\n',
      'Journal/2026-10-15.md': 'Rain.\n',
    });
    const session = await open(vault);
    const day = Object.values(session.getState().pages).find((page) => page.dailyDate === '2026-10-15');
    expect(day?.title).toMatch(/2026/);
    expect(day?.title).not.toBe('2026-10-15');
    await session.close();
  });
});
