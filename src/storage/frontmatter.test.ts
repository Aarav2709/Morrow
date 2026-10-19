import { describe, expect, it } from 'vitest';
import type { Command } from '../core/commands';
import { planArchiveImport } from '../core/importer';
import { emptyWorkspace } from '../core/model';
import type { PageId } from '../core/model';
import { planMarkdownImport } from '../core/portability';
import { databaseFromSubpages, fieldsForMove, releaseRow } from '../core/properties';
import { defaultDatabase } from '../core/database';
import { MemoryVault } from './memoryVault';
import { WorkspaceSession } from './session';
import { VaultRepository } from './vaultRepository';

let counter = 0;
const newId = () => `id${++counter}`;

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

async function runAll(session: WorkspaceSession, commands: Command[]): Promise<void> {
  const result = session.executeAll(commands);
  if (!result.ok) throw new Error(result.error);
  await session.flush();
}

// what the app's move does: carry the page's values along, then move it
async function move(session: WorkspaceSession, id: PageId, parentId: PageId | null): Promise<void> {
  const plan = fieldsForMove(session.getState().pages, id, parentId, newId);
  await runAll(session, [
    ...(plan?.database
      ? [{ type: 'database.set', id: plan.database.id, database: plan.database.database, now: 5 } as const]
      : []),
    ...(plan
      ? [
          {
            type: 'page.setFields',
            id,
            properties: plan.fields.properties,
            extra: plan.fields.extra,
            now: 5,
          } as const,
        ]
      : []),
    { type: 'page.move', id, parentId },
  ]);
}

const NOTE = '---\ndate: 2024-05-01\nauthor: Ursula\nrating: 4\n---\nA note from obsidian.\n';

describe('frontmatter from other apps', () => {
  it('shows obsidian properties on the page and saves edits to them in place', async () => {
    const vault = new MemoryVault({ 'Note.md': NOTE });
    const session = await open(vault);
    const note = idOf(session, 'Note');
    expect(session.getState().pages[note]!.extra).toEqual({
      date: '2024-05-01',
      author: 'Ursula',
      rating: 4,
    });
    await runAll(session, [
      {
        type: 'page.setFields',
        id: note,
        extra: { date: '2024-05-01', author: 'Ursula K. Le Guin', rating: 4, read: true },
        now: 2,
      },
    ]);
    expect(vault.text('Note.md')).toBe(
      '---\ndate: 2024-05-01\nauthor: Ursula K. Le Guin\nrating: 4\nread: true\n---\nA note from obsidian.\n',
    );
    await session.close();
  });

  it('rewrites only the property that changed, leaving the style and comments of the rest', async () => {
    const text = '---\n# from obsidian\naliases: [Earthsea note]\nauthor: Ursula\nread: true\n---\nBody\n';
    const vault = new MemoryVault({ 'Note.md': text });
    const session = await open(vault);
    const note = idOf(session, 'Note');
    await runAll(session, [
      {
        type: 'page.setFields',
        id: note,
        extra: { aliases: ['Earthsea note'], author: 'Ursula K. Le Guin', rating: 5 },
        now: 2,
      },
    ]);
    expect(vault.text('Note.md')).toBe(
      '---\n# from obsidian\naliases: [Earthsea note]\nauthor: Ursula K. Le Guin\nrating: 5\n---\nBody\n',
    );
    await session.close();
  });

  it('fills a database column whatever the case of the key, and keeps the file spelling', async () => {
    const database = defaultDatabase(newId);
    const vault = new MemoryVault({
      'Reading.md': `---\nkind: database\ndatabase:\n  properties:\n    - id: ${database.properties[1]!.id}\n      name: Date\n      type: date\n  views: []\n---\n`,
      'Reading/Note.md': NOTE,
    });
    const session = await open(vault);
    const note = session.getState().pages[idOf(session, 'Note')]!;
    expect(note.properties[database.properties[1]!.id]).toBe('2024-05-01');
    expect(note.extra).toEqual({ author: 'Ursula', rating: 4 });
    await runAll(session, [{ type: 'page.rename', id: note.id, title: 'Renamed', now: 3 }]);
    // date stays date, no empty Date is added beside it
    expect(vault.text('Reading/Renamed.md')).toBe(
      '---\ndate: 2024-05-01\nauthor: Ursula\nrating: 4\n---\nA note from obsidian.\n',
    );
    await session.close();
  });

  it('keeps a value the column can not hold instead of dropping it', async () => {
    const vault = new MemoryVault({
      'Tasks.md':
        '---\nkind: database\ndatabase:\n  properties:\n    - id: due\n      name: Due\n      type: date\n  views: []\n---\n',
      'Tasks/Call.md': '---\nDue: next tuesday\n---\n',
    });
    const session = await open(vault);
    const call = idOf(session, 'Call');
    expect(session.getState().pages[call]!.extra).toEqual({ Due: 'next tuesday' });
    await runAll(session, [{ type: 'page.rename', id: call, title: 'Call mum', now: 3 }]);
    expect(vault.text('Tasks/Call mum.md')).toBe('---\nDue: next tuesday\n---\n');
    await session.close();
  });

  it('turns frontmatter into columns when a page moves into a database, and back when it leaves', async () => {
    const vault = new MemoryVault({ 'Note.md': NOTE });
    const session = await open(vault);
    const note = idOf(session, 'Note');
    await runAll(session, [
      { type: 'page.create', id: 'db', parentId: null, now: 1, title: 'Books', kind: 'database' },
      { type: 'database.set', id: 'db', database: defaultDatabase(newId), now: 1 },
    ]);
    await move(session, note, 'db');
    const db = session.getState().pages.db!.database!;
    expect(db.properties.map((prop) => [prop.name, prop.type])).toEqual([
      ['Status', 'select'],
      ['Date', 'date'],
      ['author', 'text'],
      ['rating', 'number'],
    ]);
    const row = session.getState().pages[note]!;
    expect(row.extra).toEqual({});
    expect(Object.values(row.properties).sort()).toEqual([4, '2024-05-01', 'Ursula'].sort());
    expect(vault.text('Books/Note.md')).toBe(
      '---\ndate: 2024-05-01\nauthor: Ursula\nrating: 4\n---\nA note from obsidian.\n',
    );

    await move(session, note, null);
    expect(session.getState().pages[note]!.properties).toEqual({});
    expect(vault.text('Note.md')).toBe(NOTE);
    await session.close();
  });

  it('keeps the spelling of a key added in morrow when it later fills a column', async () => {
    const vault = new MemoryVault({ 'Note.md': 'Body\n' });
    const session = await open(vault);
    const note = idOf(session, 'Note');
    // added empty first, the way the page header adds one, then filled in
    await runAll(session, [{ type: 'page.setFields', id: note, extra: { status: '' }, now: 2 }]);
    await runAll(session, [{ type: 'page.setFields', id: note, extra: { status: 'Finished' }, now: 2 }]);
    await runAll(session, [
      { type: 'page.create', id: 'db', parentId: null, now: 3, title: 'Books', kind: 'database' },
      { type: 'database.set', id: 'db', database: defaultDatabase(newId), now: 3 },
    ]);
    await move(session, note, 'db');
    expect(vault.text('Books/Note.md')).toBe('---\nstatus: Finished\n---\nBody\n');
    await session.close();
  });

  it('turns a folder of notes into a database with columns from their frontmatter', async () => {
    const vault = new MemoryVault({
      'Books/Dune.md': '---\nstatus: Read\nyear: 1965\ngenre: [sci-fi]\n---\n',
      'Books/Emma.md': '---\nstatus: Reading\nyear: 1815\n---\n',
      'Books/Kindred.md': '---\nstatus: Read\nyear: 1979\nurl: https://example.com\n---\n',
    });
    const session = await open(vault);
    const books = idOf(session, 'Books');
    const adopted = databaseFromSubpages(session.getState().pages, books, newId, () =>
      defaultDatabase(newId),
    );
    expect(adopted.database.properties.map((prop) => [prop.name, prop.type])).toEqual([
      ['status', 'select'],
      ['year', 'number'],
      ['genre', 'multiSelect'],
      ['url', 'url'],
    ]);
    expect(adopted.database.views.map((view) => view.type)).toEqual(['table', 'board']);
    expect(adopted.rows).toHaveLength(3);
    await runAll(session, [
      { type: 'page.setKind', id: books, kind: 'database', now: 2 },
      { type: 'database.set', id: books, database: adopted.database, now: 2 },
      ...adopted.rows.map((row): Command => ({ type: 'page.setFields', ...row, now: 2 })),
    ]);
    // the folder gets a note saying it is a database, the rows' files are unchanged
    expect(vault.text('Books.md')).toContain('kind: database');
    expect(vault.text('Books/Emma.md')).toBe('---\nstatus: Reading\nyear: 1815\n---\n');
    const emma = session.getState().pages[idOf(session, 'Emma')]!;
    expect(releaseRow(emma, session.getState().pages[books]!.database!)).toEqual({
      status: 'Reading',
      year: 1815,
    });
    await session.close();
  });
});

describe('importing notes with frontmatter', () => {
  const text =
    '---\ntitle: Real title\nicon: 🌱\ntags: [garden, ideas]\nmood: calm\n---\n# Real title\n\nBody\n';

  it('reads loose files into page fields instead of text', () => {
    const plan = planMarkdownImport(emptyWorkspace(), [{ name: 'note.md', text }], null, newId, 0);
    const page = plan.pages[0]!;
    expect(page).toMatchObject({
      title: 'Real title',
      icon: '🌱',
      tags: ['garden', 'ideas'],
      extra: { mood: 'calm' },
    });
    expect(plan.docs[page.id]).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
    });
  });

  it('keeps a first heading that differs from the title, and reads archives the same way', () => {
    const data = new TextEncoder().encode('---\ntitle: Short\n---\n# A longer heading\n');
    const plan = planArchiveImport(emptyWorkspace(), [{ path: 'Folder/Short.md', data }], null, newId, 0);
    const page = plan.pages.find((candidate) => candidate.title === 'Short')!;
    expect(plan.docs[page.id]!.content![0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
  });
});
