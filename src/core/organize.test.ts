import { describe, expect, it } from 'vitest';
import { canvasDoc, readCanvas, writeCanvas } from './canvas';
import { applyCommand } from './commands';
import type { Command } from './commands';
import { convertValue, databaseFromTable, defaultDatabase, groupRows, inferType, visibleRows } from './database';
import { buildGraph, DEFAULT_GRAPH_OPTIONS } from './graph';
import { emptyWorkspace, newPageMeta } from './model';
import type { DocNode, PageMeta, ViewDef, WorkspaceState } from './model';
import { searchWorkspace } from './search';
import { collectTags, pagesWithTag } from './tags';
import { applyTemplate, fillTemplate, formatDate } from './templates';
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
      view({ filters: [{ id: 'f', prop: 'title', op: 'contains', value: 'p' }], sorts: [{ prop: date!.id, dir: 'asc' }] }),
      database,
    );
    expect(shown.map((page) => page.title)).toEqual(['Plant', 'Paint', 'Prune', 'Plan']);
    const notDone = visibleRows(rows, view({ filters: [{ id: 'f', prop: status!.id, op: 'isNot', value: done!.id }] }), database);
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
    const made = databaseFromTable(['Name', 'Tags', 'Note'], [['a', 'x', 'free text one'], ['b', 'y', 'free text two']], id);
    expect(made.properties.map((prop) => prop.name)).toEqual(['Tags', 'Note']);
    // the lower case name is morrow's own frontmatter key, so that column is renamed
    expect(databaseFromTable(['Name', 'tags'], [['a', 'x']], id).properties[0]!.name).toBe('tags 2');
  });

  it('accepts database commands and rejects bad values', () => {
    let state = run(emptyWorkspace(), { type: 'page.create', id: 'db', parentId: null, now: 1, kind: 'database', database });
    state = run(state, { type: 'page.create', id: 'r', parentId: 'db', now: 2 });
    state = run(state, { type: 'page.setProperties', id: 'r', values: { [status!.id]: todo!.id }, now: 3 });
    expect(state.pages.r!.properties).toEqual({ [status!.id]: todo!.id });
    state = run(state, { type: 'page.setProperties', id: 'r', values: { [status!.id]: null }, now: 4 });
    expect(state.pages.r!.properties).toEqual({});
    expect(applyCommand(state, { type: 'page.setProperties', id: 'r', values: { a: { x: 1 } as never }, now: 5 }).ok).toBe(false);
    expect(applyCommand(state, { type: 'database.set', id: 'r', database, now: 5 }).ok).toBe(false);
  });
});

describe('templates', () => {
  const date = new Date(2026, 9, 15, 9, 5);
  it('fills dates, times and titles like obsidian templates', () => {
    expect(fillTemplate('{{title}} on {{date}} at {{time}}', { title: 'Standup', date })).toBe('Standup on 2026-10-15 at 09:05');
    expect(formatDate(date, 'DD/MM/YY [week]', 'en-GB')).toBe('15/10/26 week');
    const filled = applyTemplate(doc(p('Notes for {{date:YYYY}}')), { title: '', date });
    expect(filled).toEqual(doc(p('Notes for 2026')));
  });
});

describe('tags and graph', () => {
  const state = run(
    emptyWorkspace(),
    { type: 'page.create', id: 'a', parentId: null, now: 1, title: 'Alpha', tags: ['project/garden'], doc: doc(p('See the #ideas list')) },
    { type: 'page.create', id: 'b', parentId: null, now: 2, title: 'Beta', doc: doc({ type: 'paragraph', content: [{ type: 'pageLink', attrs: { id: 'a', label: 'Alpha' } }] }) },
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
    expect(buildGraph(state, { ...DEFAULT_GRAPH_OPTIONS, orphans: false }).nodes.map((node) => node.id).sort()).toEqual(['a', 'b']);
    expect(buildGraph(state, { ...DEFAULT_GRAPH_OPTIONS, focus: 'c' }).nodes.map((node) => node.id)).toEqual(['c']);
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
    state = run(state, { type: 'page.rename', id: 'a', title: 'B', now: 3 }, { type: 'page.rename', id: 'b', title: 'A', now: 3 });
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
    const written = JSON.parse(writeCanvas(data, () => 'Notes/Plan.md')) as { nodes: Array<{ type: string; file?: string }> };
    expect(written.nodes[0]).toMatchObject({ type: 'file', file: 'Notes/Plan.md' });
    expect(canvasDoc(data).content![0]!.type).toBe('canvas');
  });
});
