import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands';
import type { Command } from './commands';
import { fileIdsInDoc } from './doc';
import { MAX_SNAPSHOTS_PER_PAGE, snapshotDue, snapshotsToPrune, SNAPSHOT_INTERVAL_MS } from './history';
import { parseCsv, planArchiveImport } from './importer';
import { markdownToDoc } from './markdown/parse';
import { docToMarkdown } from './markdown/serialize';
import { emptyWorkspace, SCHEMA_VERSION } from './model';
import type { DocNode, PageMeta, WorkspaceState } from './model';
import {
  base64ToBytes,
  bytesToBase64,
  createBackup,
  parseBackup,
  referencedFileIds,
  workspaceMarkdownFiles,
} from './portability';
import { searchWorkspace } from './search';
import { childrenOf, flattenTree, livePages } from './tree';

const encode = (text: string) => new TextEncoder().encode(text);

function run(state: WorkspaceState, ...commands: Command[]): WorkspaceState {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command);
    if (!result.ok) throw new Error(result.error);
    return result.value.state;
  }, state);
}

describe('callouts and toggles in markdown', () => {
  it('reads github alerts as callouts and writes them back', () => {
    const doc = markdownToDoc('> [!WARNING]\n> Turn the water off first.\n\n> [!TIP] Keep spares.');
    expect(doc.content!.map((node) => node.attrs?.tone)).toEqual(['warning', 'tip']);
    expect(doc.content![0]!.content![0]!.content![0]!.text).toBe('Turn the water off first.');
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });

  it('keeps ordinary quotes as quotes', () => {
    expect(markdownToDoc('> Just a quote').content![0]!.type).toBe('blockquote');
  });

  it('round trips toggles through html details', () => {
    const doc = markdownToDoc(
      '<details>\n<summary>Packing &amp; tickets</summary>\n\n- passport\n- charger\n\n</details>',
    );
    const toggle = doc.content![0]!;
    expect(toggle.type).toBe('details');
    expect(toggle.content![0]!.content![0]!.text).toBe('Packing & tickets');
    expect(toggle.content![1]!.content![0]!.type).toBe('bulletList');
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });

  it('reads notion asides as callouts', () => {
    const doc = markdownToDoc('<aside>\n💡 Water early in the morning.\n\n</aside>\n\nAfter');
    expect(doc.content!.map((node) => node.type)).toEqual(['callout', 'paragraph']);
    expect(doc.content![0]!.content![0]!.content![0]!.text).toBe('💡 Water early in the morning.');
  });
});

describe('images and attachments in markdown', () => {
  const resolveFile = (href: string) =>
    href === 'photo.png'
      ? { fileId: 'img1', name: 'photo.png', image: true }
      : href === 'plan.pdf'
        ? { fileId: 'pdf1', name: 'plan.pdf', image: false }
        : null;

  it('turns known files into blocks and leaves unknown ones as links', () => {
    const doc = markdownToDoc('![Front garden](photo.png)\n\n[plan.pdf](plan.pdf)\n\n![](elsewhere.png)', {
      resolveFile,
    });
    expect(doc.content!.map((node) => node.type)).toEqual(['image', 'fileAttachment', 'paragraph']);
    expect(doc.content![0]!.attrs).toEqual({ fileId: 'img1', alt: 'Front garden' });
    expect(fileIdsInDoc(doc)).toEqual(['img1', 'pdf1']);
  });

  it('keeps a file link inside a sentence as plain text', () => {
    const doc = markdownToDoc('Read [the plan](plan.pdf) first.', { resolveFile });
    expect(doc.content![0]!.type).toBe('paragraph');
    expect(doc.content![0]!.content!.map((node) => node.text).join('')).toBe('Read the plan first.');
  });

  it('writes images and files with relative paths', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { fileId: 'a', alt: 'Roses' } },
        { type: 'fileAttachment', attrs: { fileId: 'b', name: 'plan.pdf' } },
      ],
    };
    const paths: Record<string, string> = { a: 'attachments/roses.png', b: 'attachments/plan.pdf' };
    expect(docToMarkdown(doc, { filePath: (id) => paths[id] ?? null })).toBe(
      '![Roses](attachments/roses.png)\n\n[plan.pdf](attachments/plan.pdf)\n',
    );
  });
});

describe('notion and folder imports', () => {
  const id = (n: string) => n.repeat(32).slice(0, 32);
  const entries = [
    {
      path: `Export-x/Projects ${id('a')}.md`,
      data: encode(
        `# Projects\n\nSee [Garden](Projects%20${id('a')}/Garden%20${id('b')}.md) and the [[Reading]] list.\n\n![](Projects%20${id('a')}/photo.png)`,
      ),
    },
    {
      path: `Export-x/Projects ${id('a')}/Garden ${id('b')}.md`,
      data: encode('# Garden\n\n- [ ] Order boards'),
    },
    { path: `Export-x/Projects ${id('a')}/photo.png`, data: new Uint8Array([137, 80, 78, 71]) },
    { path: `Export-x/Projects ${id('a')}/unused.png`, data: new Uint8Array([1]) },
    { path: `Export-x/Reading ${id('c')}.csv`, data: encode('Name,Status\nMiddlemarch,Reading\n') },
    {
      path: `Export-x/Reading ${id('c')}_all.csv`,
      data: encode('Name,Status\nMiddlemarch,Reading\n"Piranesi, a novel",Next\n'),
    },
    {
      path: `Export-x/Reading ${id('c')}/Middlemarch ${id('d')}.md`,
      data: encode('# Middlemarch\n\nStatus: Reading'),
    },
    { path: 'Export-x/Notes/Ideas.md', data: encode('Loose idea') },
    { path: 'Export-x/.obsidian/config.json', data: encode('{}') },
  ];

  let n = 0;
  const plan = planArchiveImport(emptyWorkspace(), entries, null, () => `p${n++}`, 5);
  const byTitle = (title: string) => plan.pages.find((page) => page.title === title)!;

  it('builds the page tree from files and folders without notion ids', () => {
    expect(plan.pages.map((page) => page.title).sort()).toEqual(
      ['Garden', 'Ideas', 'Middlemarch', 'Notes', 'Projects', 'Reading'].sort(),
    );
    expect(byTitle('Garden').parentId).toBe(byTitle('Projects').id);
    expect(byTitle('Middlemarch').parentId).toBe(byTitle('Reading').id);
    expect(byTitle('Ideas').parentId).toBe(byTitle('Notes').id);
    expect(byTitle('Projects').parentId).toBeNull();
  });

  it('links pages, imports only referenced files and reads every database row', () => {
    const projects = plan.docs[byTitle('Projects').id]!;
    const links = projects.content![0]!.content!.filter((node) => node.type === 'pageLink');
    expect(links.map((link) => link.attrs?.id)).toEqual([byTitle('Garden').id, byTitle('Reading').id]);
    expect(plan.files.map((file) => file.meta.name)).toEqual(['photo.png']);
    expect(plan.files[0]!.meta.type).toBe('image/png');
    expect(projects.content![1]).toEqual({
      type: 'image',
      attrs: { fileId: plan.files[0]!.meta.id, alt: '' },
    });
    const table = plan.docs[byTitle('Reading').id]!.content![0]!;
    expect(table.content).toHaveLength(3);
    expect(table.content![2]!.content![0]!.content![0]!.content![0]!.text).toBe('Piranesi, a novel');
  });

  it('produces pages the insert command accepts', () => {
    const state = run(emptyWorkspace(), { type: 'pages.insert', pages: plan.pages, docs: plan.docs });
    expect(livePages(state.pages)).toHaveLength(6);
  });

  it('parses quoted csv fields', () => {
    expect(parseCsv('a,"b ""c""",d\r\n1,2,3')).toEqual([
      ['a', 'b "c"', 'd'],
      ['1', '2', '3'],
    ]);
  });
});

describe('backups with files', () => {
  it('round trips attachments and still reads version 1 backups', () => {
    const state = run(emptyWorkspace(), {
      type: 'page.create',
      id: 'p',
      parentId: null,
      now: 1,
      doc: { type: 'doc', content: [{ type: 'image', attrs: { fileId: 'f1', alt: '' } }] },
    });
    expect([...referencedFileIds(state)]).toEqual(['f1']);
    const bytes = new Uint8Array([0, 255, 128, 7]);
    const backup = createBackup(state, new Date(0), [
      { id: 'f1', name: 'a.png', type: 'image/png', size: 4, createdAt: 1, data: bytesToBase64(bytes) },
    ]);
    const parsed = parseBackup(JSON.stringify(backup));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(base64ToBytes(parsed.value.files[0]!.data)).toEqual(bytes);
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);

    const v1 = parseBackup(
      JSON.stringify({ format: 'morrow-backup', schemaVersion: 1, pages: backup.pages, docs: backup.docs }),
    );
    expect(v1.ok && v1.value.pages).toHaveLength(1);
    expect(v1.ok && v1.value.files).toEqual([]);
  });

  it('rejects malformed attachments without losing pages', () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: 'morrow-backup',
        schemaVersion: 2,
        pages: [{ id: 'p' }],
        docs: {},
        files: [{ id: 'x', data: '***' }],
      }),
    );
    expect(parsed.ok && parsed.value.files).toEqual([]);
    expect(parsed.ok && parsed.value.problems).toHaveLength(1);
  });

  it('exports attachments into a shared folder with paths relative to each page', () => {
    const state = run(
      emptyWorkspace(),
      {
        type: 'page.create',
        id: 'a',
        parentId: null,
        now: 1,
        title: 'Top',
        doc: { type: 'doc', content: [{ type: 'image', attrs: { fileId: 'f', alt: 'x' } }] },
      },
      {
        type: 'page.create',
        id: 'b',
        parentId: 'a',
        now: 2,
        title: 'Child',
        doc: { type: 'doc', content: [{ type: 'image', attrs: { fileId: 'f', alt: 'x' } }] },
      },
    );
    const { files, attachments } = workspaceMarkdownFiles(state, {
      f: { id: 'f', name: 'photo.png', type: 'image/png', size: 1, createdAt: 0 },
    });
    expect([...attachments.values()]).toEqual(['attachments/photo.png']);
    expect(files.find((file) => file.path === 'Top.md')!.content).toContain('![x](attachments/photo.png)');
    expect(files.find((file) => file.path === 'Top/Child.md')!.content).toContain(
      '![x](../attachments/photo.png)',
    );
  });
});

describe('page history policy', () => {
  it('spaces versions out and keeps the newest ones', () => {
    expect(snapshotDue(undefined, 0)).toBe(true);
    expect(snapshotDue(1000, 1000 + SNAPSHOT_INTERVAL_MS - 1)).toBe(false);
    expect(snapshotDue(1000, 1000 + SNAPSHOT_INTERVAL_MS)).toBe(true);
    const many = Array.from({ length: MAX_SNAPSHOTS_PER_PAGE + 3 }, (_, i) => ({
      id: `s${i}`,
      createdAt: i,
    }));
    expect(snapshotsToPrune(many)).toEqual(['s2', 's1', 's0']);
  });
});

describe('large workspaces', () => {
  it('handles ten thousand pages quickly', () => {
    const pages: PageMeta[] = [];
    const docs: Record<string, DocNode> = {};
    for (let i = 0; i < 10_000; i++) {
      const id = `p${i}`;
      pages.push({
        id,
        parentId: i < 100 ? null : `p${i % 100}`,
        title: `Page number ${i}`,
        icon: null,
        kind: 'page',
        order: i,
        createdAt: i,
        updatedAt: i,
        trashedAt: null,
        favorite: false,
        dailyDate: null,
        lastOpenedAt: null,
      });
      docs[id] = {
        type: 'doc',
        content: Array.from({ length: 8 }, (_, j) => ({
          type: 'paragraph',
          content: [
            { type: 'text', text: `Paragraph ${j} of page ${i} about gardens, books and plans ${i * 7}` },
          ],
        })),
      };
    }
    let state = run(emptyWorkspace(), { type: 'pages.insert', pages, docs });

    const started = performance.now();
    for (let i = 0; i < 100; i++) childrenOf(state.pages, `p${i}`);
    flattenTree(state.pages);
    const treeMs = performance.now() - started;

    searchWorkspace(state, 'warm cache');
    const searchStart = performance.now();
    const results = searchWorkspace(state, 'gardens 69993');
    const searchMs = performance.now() - searchStart;

    const renameStart = performance.now();
    for (let i = 0; i < 20; i++)
      state = run(state, { type: 'page.rename', id: 'p5', title: `Renamed ${i}`, now: i });
    const renameMs = (performance.now() - renameStart) / 20;

    console.info(
      `10k pages: tree ${treeMs.toFixed(1)} ms, search ${searchMs.toFixed(1)} ms, rename ${renameMs.toFixed(2)} ms`,
    );
    expect(results[0]!.page.id).toBe('p9999');
    // generous limits that only catch accidental quadratic work
    expect(treeMs).toBeLessThan(500);
    expect(searchMs).toBeLessThan(500);
    expect(renameMs).toBeLessThan(50);
  });

  it('protects cached lists from accidental mutation', () => {
    const state = run(emptyWorkspace(), { type: 'page.create', id: 'a', parentId: null, now: 1 });
    expect(() => (childrenOf(state.pages, null) as PageMeta[]).push(state.pages.a!)).toThrow();
  });
});
