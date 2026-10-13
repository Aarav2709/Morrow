import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands';
import type { Command } from './commands';
import { dailyInsertIndex, dateKey } from './daily';
import { backlinksTo } from './links';
import { readWorkspace } from './migrations';
import { emptyWorkspace, SCHEMA_VERSION } from './model';
import type { DocNode, PageMeta, WorkspaceState } from './model';
import {
  createBackup,
  pageMarkdown,
  parseBackup,
  planMarkdownImport,
  planRestore,
  safeFileName,
  workspaceMarkdownFiles,
} from './portability';
import { searchWorkspace } from './search';
import { collectTasks } from './tasks';

function run(state: WorkspaceState, ...commands: Command[]): WorkspaceState {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command);
    if (!result.ok) throw new Error(result.error);
    return result.value.state;
  }, state);
}

const doc = (...paragraphs: Array<string | DocNode[]>): DocNode => ({
  type: 'doc',
  content: paragraphs.map((value) => ({
    type: 'paragraph',
    content: typeof value === 'string' ? [{ type: 'text', text: value }] : value,
  })),
});

function sample(): WorkspaceState {
  return run(
    emptyWorkspace(),
    {
      type: 'page.create',
      id: 'garden',
      parentId: null,
      now: 1,
      title: 'Garden plans',
      doc: doc('Plant tomatoes in May.', 'Café notes: buy compost'),
    },
    {
      type: 'page.create',
      id: 'beds',
      parentId: 'garden',
      now: 2,
      title: 'Raised beds',
      doc: doc('Cedar boards, 2 metres.'),
    },
    {
      type: 'page.create',
      id: 'journal',
      parentId: null,
      now: 3,
      title: 'Monday',
      doc: doc([
        { type: 'text', text: 'Worked on ' },
        { type: 'pageLink', attrs: { id: 'garden', label: 'Garden' } },
      ]),
    },
    { type: 'page.create', id: 'old', parentId: null, now: 4, title: 'Tomato archive', doc: doc('tomatoes') },
    { type: 'page.trash', id: 'old', now: 5 },
  );
}

describe('search', () => {
  const state = sample();

  it('finds pages by title and body, ignoring the trash', () => {
    const results = searchWorkspace(state, 'tomato');
    expect(results.map((r) => r.page.id)).toEqual(['garden']);
    expect(results[0]!.snippet?.match.toLowerCase()).toBe('tomato');
  });

  it('requires every term and ranks title matches first', () => {
    expect(searchWorkspace(state, 'cedar boards').map((r) => r.page.id)).toEqual(['beds']);
    expect(searchWorkspace(state, 'cedar tomatoes')).toEqual([]);
    expect(searchWorkspace(state, 'garden')[0]!.page.id).toBe('garden');
  });

  it('ignores accents and case', () => {
    expect(searchWorkspace(state, 'CAFE').map((r) => r.page.id)).toEqual(['garden']);
  });

  it('reports the page path', () => {
    expect(searchWorkspace(state, 'cedar')[0]!.path).toEqual(['Garden plans']);
  });
});

describe('links and tasks', () => {
  it('collects backlinks from live pages', () => {
    const backlinks = backlinksTo(sample(), 'garden');
    expect(backlinks.map((b) => b.source.id)).toEqual(['journal']);
    expect(backlinks[0]!.contexts).toEqual(['Worked on Garden']);
  });

  it('collects tasks across pages', () => {
    const state = run(emptyWorkspace(), {
      type: 'page.create',
      id: 't',
      parentId: null,
      now: 1,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'taskList',
            content: [
              {
                type: 'taskItem',
                attrs: { checked: true },
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Water plants' }] }],
              },
            ],
          },
        ],
      },
    });
    expect(collectTasks(state)).toEqual([{ pageId: 't', index: 0, text: 'Water plants', checked: true }]);
  });
});

describe('backup and restore', () => {
  it('round trips the whole workspace including the trash', () => {
    const state = sample();
    const parsed = parseBackup(JSON.stringify(createBackup(state, new Date(0))));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    let n = 0;
    const plan = planRestore(emptyWorkspace(), parsed.value, () => `new${n++}`);
    const restored = run(emptyWorkspace(), { type: 'pages.insert', pages: plan.pages, docs: plan.docs });
    expect(restored).toEqual(state);
  });

  it('never overwrites existing pages', () => {
    const state = sample();
    const backup = parseBackup(JSON.stringify(createBackup(state, new Date(0))));
    if (!backup.ok) throw new Error(backup.error);
    const edited = run(state, { type: 'page.rename', id: 'garden', title: 'Edited', now: 99 });
    let n = 0;
    const plan = planRestore(edited, backup.value, () => `copy${n++}`);
    expect(plan.skipped).toBe(3);
    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0]!.title).toBe('Garden plans (restored)');
    const after = run(edited, { type: 'pages.insert', pages: plan.pages, docs: plan.docs });
    expect(after.pages.garden!.title).toBe('Edited');
    expect(after.pages.beds!.parentId).toBe('garden');
  });

  it('rejects files that are not backups and newer formats', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup('{"format":"other"}').ok).toBe(false);
    const future = parseBackup(
      JSON.stringify({ format: 'morrow-backup', schemaVersion: SCHEMA_VERSION + 1, pages: [], docs: {} }),
    );
    expect(future.ok || future.error).toMatch(/newer version/);
  });
});

describe('reading stored data', () => {
  it('skips unreadable records and flags unreadable content without dropping the page', () => {
    const result = readWorkspace(1, {
      pages: [
        { id: 'ok', title: 'Fine' },
        { id: 'bad doc', title: 'x' },
        null,
        { id: 'broken', title: 'Broken' },
      ],
      docs: { ok: doc('hi'), broken: { type: 'not-a-doc' } },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.pages.map((page) => page.id)).toEqual(['ok', 'broken']);
    expect(result.value.unreadable).toEqual(['broken']);
    expect(result.value.problems).toHaveLength(3);
    const page = result.value.pages[0] as PageMeta;
    expect(page).toMatchObject({ parentId: null, favorite: false, trashedAt: null, kind: 'page' });
  });
});

describe('markdown files', () => {
  it('imports files under a parent and links them to each other', () => {
    const state = sample();
    let n = 0;
    const plan = planMarkdownImport(
      state,
      [
        { name: 'ideas.md', text: '# Ideas\n\nSee [[Reading]] and [[Garden plans]].' },
        { name: 'Reading.md', text: '- [ ] Piranesi' },
      ],
      'garden',
      () => `imp${n++}`,
      10,
    );
    expect(plan.pages.map((page) => page.title)).toEqual(['Ideas', 'Reading']);
    const links = plan.docs.imp0!.content![0]!.content!.filter((node) => node.type === 'pageLink');
    expect(links.map((link) => link.attrs?.id)).toEqual(['imp1', 'garden']);
    const after = run(state, { type: 'pages.insert', pages: plan.pages, docs: plan.docs });
    expect(after.pages.imp0!.parentId).toBe('garden');
  });

  it('exports the workspace as nested files with current link titles', () => {
    const state = run(sample(), { type: 'page.rename', id: 'garden', title: 'Garden: 2026', now: 9 });
    const { files } = workspaceMarkdownFiles(state);
    expect(files.map((file) => file.path).sort()).toEqual([
      'Garden 2026.md',
      'Garden 2026/Raised beds.md',
      'Monday.md',
    ]);
    expect(pageMarkdown(state, 'journal')).toBe('# Monday\n\nWorked on [[Garden: 2026]]\n');
  });

  it('produces safe file names', () => {
    expect(safeFileName('a/b\\c:d*?')).toBe('a b c d');
    expect(safeFileName('CON')).toBe('Untitled');
    expect(safeFileName('...')).toBe('Untitled');
  });
});

describe('daily notes', () => {
  it('formats keys and keeps the journal newest first', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    const day = (dailyDate: string) => ({ dailyDate }) as PageMeta;
    expect(dailyInsertIndex([day('2026-01-07'), day('2026-01-03')], '2026-01-05')).toBe(1);
    expect(dailyInsertIndex([], '2026-01-05')).toBe(0);
  });
});

describe('sample workspace', () => {
  it('applies cleanly and survives a markdown round trip page by page', async () => {
    const { sampleCommands } = await import('./sample');
    const { markdownToPage } = await import('./markdown/parse');
    const { findUnknownTypes } = await import('./doc');
    let n = 0;
    const state = run(emptyWorkspace(), ...sampleCommands(() => `s${n++}`, 1000));
    expect(Object.keys(state.pages)).toHaveLength(6);
    for (const page of Object.values(state.pages)) {
      const doc = state.docs[page.id]!;
      expect(findUnknownTypes(doc)).toEqual([]);
      const parsed = markdownToPage(pageMarkdown(state, page.id), 'x', {
        resolvePage: (title) => Object.values(state.pages).find((p) => p.title === title)?.id ?? null,
      });
      expect(parsed.title).toBe(page.title);
      expect(parsed.doc).toEqual(doc);
    }
  });
});
