import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands';
import type { Command } from './commands';
import { emptyWorkspace } from './model';
import type { DocNode, WorkspaceState } from './model';
import { archivedPages, childrenOf, isEffectivelyTrashed, livePages } from './tree';

function run(state: WorkspaceState, ...commands: Command[]): WorkspaceState {
  return commands.reduce((current, command) => {
    const result = applyCommand(current, command);
    if (!result.ok) throw new Error(result.error);
    return result.value.state;
  }, state);
}

const create = (id: string, parentId: string | null = null, extra: Partial<Command> = {}): Command =>
  ({ type: 'page.create', id, parentId, now: 1, title: id, ...extra }) as Command;

const paragraph = (text: string): DocNode => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('page creation and hierarchy', () => {
  it('creates nested pages in order', () => {
    const state = run(
      emptyWorkspace(),
      create('a'),
      create('b'),
      create('a1', 'a'),
      create('a0', 'a', { index: 0 } as Partial<Command>),
    );
    expect(childrenOf(state.pages, null).map((p) => p.id)).toEqual(['a', 'b']);
    expect(childrenOf(state.pages, 'a').map((p) => p.id)).toEqual(['a0', 'a1']);
    expect(state.docs.a1).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('rejects duplicate ids and missing parents', () => {
    const state = run(emptyWorkspace(), create('a'));
    expect(applyCommand(state, create('a')).ok).toBe(false);
    expect(applyCommand(state, create('b', 'missing')).ok).toBe(false);
  });

  it('refuses to move a page inside itself or its descendants', () => {
    const state = run(emptyWorkspace(), create('a'), create('b', 'a'), create('c', 'b'));
    expect(applyCommand(state, { type: 'page.move', id: 'a', parentId: 'a' }).ok).toBe(false);
    expect(applyCommand(state, { type: 'page.move', id: 'a', parentId: 'c' }).ok).toBe(false);
    const moved = run(state, { type: 'page.move', id: 'c', parentId: null, index: 0 });
    expect(childrenOf(moved.pages, null).map((p) => p.id)).toEqual(['c', 'a']);
  });

  it('reorders siblings without touching unrelated pages', () => {
    const state = run(emptyWorkspace(), create('a'), create('b'), create('c'));
    const result = applyCommand(state, { type: 'page.move', id: 'c', parentId: null, index: 0 });
    expect(result.ok && childrenOf(result.value.state.pages, null).map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(result.ok && [...result.value.changes.pages].sort()).toEqual(['a', 'b', 'c']);
  });

  it('normalises titles', () => {
    const state = run(emptyWorkspace(), create('a'), {
      type: 'page.rename',
      id: 'a',
      title: 'Line\none',
      now: 2,
    });
    expect(state.pages.a!.title).toBe('Line one');
    expect(state.pages.a!.updatedAt).toBe(2);
  });
});

describe('archive', () => {
  const base = () => run(emptyWorkspace(), create('a'), create('b', 'a'));

  it('archives a page and brings it back', () => {
    const archived = run(base(), { type: 'page.setArchived', id: 'b', now: 5 });
    expect(archivedPages(archived.pages).map((page) => page.id)).toEqual(['b']);
    expect(livePages(archived.pages)).toHaveLength(2);
    const back = run(archived, { type: 'page.setArchived', id: 'b', now: null });
    expect(archivedPages(back.pages)).toHaveLength(0);
  });

  it('leaves archived pages inside the trash out of the archive', () => {
    const state = run(
      base(),
      { type: 'page.setArchived', id: 'b', now: 5 },
      { type: 'page.trash', id: 'a', now: 6 },
    );
    expect(archivedPages(state.pages)).toHaveLength(0);
  });
});

describe('trash', () => {
  const base = () => run(emptyWorkspace(), create('a'), create('b', 'a'), create('c', 'b'));

  it('hides a trashed page and its subpages', () => {
    const state = run(base(), { type: 'page.trash', id: 'a', now: 5 });
    expect(livePages(state.pages)).toHaveLength(0);
    expect(isEffectivelyTrashed(state.pages, 'c')).toBe(true);
  });

  it('restores a page to its original parent', () => {
    const state = run(base(), { type: 'page.trash', id: 'b', now: 5 }, { type: 'page.restore', id: 'b' });
    expect(state.pages.b!.parentId).toBe('a');
    expect(livePages(state.pages)).toHaveLength(3);
  });

  it('restores to the top level when the parent is still trashed', () => {
    const state = run(
      base(),
      { type: 'page.trash', id: 'b', now: 5 },
      { type: 'page.trash', id: 'a', now: 6 },
      { type: 'page.restore', id: 'b' },
    );
    expect(state.pages.b!.parentId).toBeNull();
    expect(isEffectivelyTrashed(state.pages, 'c')).toBe(false);
  });

  it('only deletes permanently from the trash, including subpages', () => {
    const state = base();
    expect(applyCommand(state, { type: 'page.deleteForever', id: 'a' }).ok).toBe(false);
    const deleted = run(
      state,
      { type: 'page.trash', id: 'a', now: 1 },
      { type: 'page.deleteForever', id: 'a' },
    );
    expect(Object.keys(deleted.pages)).toEqual([]);
    expect(Object.keys(deleted.docs)).toEqual([]);
  });

  it('empties the trash and keeps live pages', () => {
    const state = run(base(), create('d'), { type: 'page.trash', id: 'b', now: 1 }, { type: 'trash.empty' });
    expect(Object.keys(state.pages).sort()).toEqual(['a', 'd']);
  });

  it('cannot create pages inside a trashed page', () => {
    const state = run(base(), { type: 'page.trash', id: 'a', now: 1 });
    expect(applyCommand(state, create('x', 'b')).ok).toBe(false);
  });
});

describe('content', () => {
  it('stores valid documents and rejects invalid ones without changing state', () => {
    const state = run(emptyWorkspace(), create('a'));
    const next = run(state, { type: 'page.setDoc', id: 'a', doc: paragraph('hello'), now: 9 });
    expect(next.docs.a).toEqual(paragraph('hello'));
    const bad = applyCommand(next, {
      type: 'page.setDoc',
      id: 'a',
      doc: { type: 'paragraph' } as DocNode,
      now: 10,
    });
    expect(bad.ok).toBe(false);
    expect(next.docs.a).toEqual(paragraph('hello'));
  });

  it('toggles a checklist item by index', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    };
    const state = run(emptyWorkspace(), create('a', null, { doc } as Partial<Command>), {
      type: 'task.setChecked',
      pageId: 'a',
      index: 1,
      checked: true,
      now: 3,
    });
    const items = state.docs.a!.content![0]!.content!;
    expect(items.map((item) => item.attrs?.checked)).toEqual([false, true]);
    expect(
      applyCommand(state, { type: 'task.setChecked', pageId: 'a', index: 7, checked: true, now: 3 }).ok,
    ).toBe(false);
  });

  it('duplicates a page next to the original with copied content', () => {
    const state = run(
      emptyWorkspace(),
      create('a'),
      create('b'),
      { type: 'page.setDoc', id: 'a', doc: paragraph('x'), now: 2 },
      { type: 'page.duplicate', id: 'a', newId: 'a2', now: 3 },
    );
    expect(childrenOf(state.pages, null).map((p) => p.id)).toEqual(['a', 'a2', 'b']);
    expect(state.pages.a2!.title).toBe('a (copy)');
    expect(state.docs.a2).toEqual(paragraph('x'));
    expect(state.docs.a2).not.toBe(state.docs.a);
  });
});

describe('robustness', () => {
  const junk: unknown[] = [
    null,
    undefined,
    0,
    -1,
    NaN,
    Infinity,
    '',
    '../../x',
    {},
    [],
    'a'.repeat(5000),
    { type: 'doc' },
  ];

  it('never throws on hostile command parameters', () => {
    const state = run(emptyWorkspace(), create('a'), create('b', 'a'));
    const types: Command['type'][] = [
      'page.create',
      'page.rename',
      'page.setIcon',
      'page.move',
      'page.duplicate',
      'page.setDoc',
      'page.setFavorite',
      'page.markOpened',
      'page.trash',
      'page.restore',
      'page.deleteForever',
      'trash.empty',
      'task.setChecked',
      'pages.insert',
    ];
    for (const type of types) {
      for (const value of junk) {
        const command = {
          type,
          id: value,
          newId: value,
          parentId: value,
          pageId: value,
          title: value,
          icon: value,
          doc: value,
          index: value,
          now: value,
          pages: value,
          docs: value,
          checked: value,
        } as unknown as Command;
        expect(() => applyCommand(state, command)).not.toThrow();
      }
    }
    expect(applyCommand(state, { type: 'nope' } as unknown as Command).ok).toBe(false);
  });

  it('survives a corrupted parent cycle in stored data', () => {
    const state = run(emptyWorkspace(), create('a'), create('b'));
    const corrupted: WorkspaceState = {
      ...state,
      pages: { a: { ...state.pages.a!, parentId: 'b' }, b: { ...state.pages.b!, parentId: 'a' } },
    };
    expect(() => livePages(corrupted.pages)).not.toThrow();
    expect(applyCommand(corrupted, { type: 'page.move', id: 'a', parentId: null }).ok).toBe(true);
  });
});
