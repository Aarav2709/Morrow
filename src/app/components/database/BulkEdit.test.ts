// @vitest-environment happy-dom
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { PropDef } from '../../../core/model';
import { MemoryVault } from '../../../storage/memoryVault';
import { WorkspaceSession } from '../../../storage/session';
import { VaultRepository } from '../../../storage/vaultRepository';
import { clearPropertyHistory, setSession, stepProperties } from '../../workspace';
import { resolveBulkValue, toggleRowSelection } from './BulkEdit';
import { DatabaseView } from './DatabaseView';

const makeProp = (partial: Partial<PropDef> & Pick<PropDef, 'id' | 'name' | 'type'>): PropDef => ({
  options: [],
  ...partial,
});

describe('toggleRowSelection', () => {
  const rows = ['r1', 'r2', 'r3', 'r4', 'r5'];

  it('toggles individual rows', () => {
    const a = toggleRowSelection(new Set(), rows, 'r2', null, false);
    expect([...a]).toEqual(['r2']);
    const b = toggleRowSelection(a, rows, 'r4', 'r2', false);
    expect([...b]).toEqual(['r2', 'r4']);
    const c = toggleRowSelection(b, rows, 'r2', 'r4', false);
    expect([...c]).toEqual(['r4']);
  });

  it('selects and deselects a range on shift-click', () => {
    const start = toggleRowSelection(new Set(), rows, 'r2', null, false);
    const forward = toggleRowSelection(start, rows, 'r4', 'r2', true);
    expect([...forward]).toEqual(['r2', 'r3', 'r4']);

    const backward = toggleRowSelection(new Set(['r4']), rows, 'r1', 'r4', true);
    expect([...backward].sort()).toEqual(['r1', 'r2', 'r3', 'r4']);

    const deselectRange = toggleRowSelection(new Set(['r1', 'r2', 'r3', 'r4']), rows, 'r2', 'r4', true);
    expect([...deselectRange]).toEqual(['r1']);
  });
});

describe('resolveBulkValue', () => {
  it('clears any property to null', () => {
    const prop = makeProp({ id: 'p1', name: 'Status', type: 'text' });
    expect(resolveBulkValue('hello', prop, { kind: 'clear' })).toBeNull();
  });

  it('resolves scalar property types', () => {
    expect(
      resolveBulkValue(null, makeProp({ id: 't', name: 'Text', type: 'text' }), {
        kind: 'scalar',
        text: 'hello',
        checked: false,
        optionId: null,
      }),
    ).toBe('hello');
    expect(
      resolveBulkValue(null, makeProp({ id: 'n', name: 'Num', type: 'number' }), {
        kind: 'scalar',
        text: '42.5',
        checked: false,
        optionId: null,
      }),
    ).toBe(42.5);
    expect(
      resolveBulkValue(null, makeProp({ id: 'n', name: 'Num', type: 'number' }), {
        kind: 'scalar',
        text: 'abc',
        checked: false,
        optionId: null,
      }),
    ).toBeNull();
    expect(
      resolveBulkValue(null, makeProp({ id: 'd', name: 'Date', type: 'date' }), {
        kind: 'scalar',
        text: '2026-11-20',
        checked: false,
        optionId: null,
      }),
    ).toBe('2026-11-20');
    expect(
      resolveBulkValue(null, makeProp({ id: 'c', name: 'Done', type: 'checkbox' }), {
        kind: 'scalar',
        text: '',
        checked: true,
        optionId: null,
      }),
    ).toBe(true);
    expect(
      resolveBulkValue(null, makeProp({ id: 's', name: 'Status', type: 'select' }), {
        kind: 'scalar',
        text: '',
        checked: false,
        optionId: 'opt-1',
      }),
    ).toBe('opt-1');
  });

  it('supports replace, add and remove for multiSelect', () => {
    const prop = makeProp({ id: 'tags', name: 'Tags', type: 'multiSelect' });
    expect(resolveBulkValue(['a', 'b'], prop, { kind: 'list', items: ['c'], mode: 'replace' })).toEqual([
      'c',
    ]);
    expect(resolveBulkValue(['a', 'b'], prop, { kind: 'list', items: ['b', 'c'], mode: 'add' })).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(resolveBulkValue(['a', 'b'], prop, { kind: 'list', items: ['a'], mode: 'remove' })).toEqual(['b']);
    expect(resolveBulkValue(['a'], prop, { kind: 'list', items: ['a'], mode: 'remove' })).toBeNull();
  });

  it('deduplicates and removes relations case-insensitively', () => {
    const prop = makeProp({ id: 'rel', name: 'Project', type: 'relation' });
    expect(
      resolveBulkValue(['Alpha'], prop, { kind: 'list', items: ['alpha', 'Beta'], mode: 'add' }),
    ).toEqual(['Alpha', 'Beta']);
    expect(
      resolveBulkValue(['Alpha', 'Beta'], prop, { kind: 'list', items: ['alpha'], mode: 'remove' }),
    ).toEqual(['Beta']);
  });
});

describe('DatabaseView bulk selection and editing', () => {
  let host: HTMLElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    host?.remove();
    host = null;
    clearPropertyHistory();
    document.body.innerHTML = '';
  });

  it('selects pages with checkboxes and edits a property across all selected rows in one undo step', async () => {
    let seq = 0;
    const newId = () => `id${++seq}`;
    const opened = await WorkspaceSession.open(new VaultRepository(new MemoryVault(), newId), { delayMs: 0 });
    if (!opened.ok) throw new Error(opened.error);
    const session = opened.value;
    setSession(session);
    clearPropertyHistory();

    const now = 1000;
    const seeded = session.executeAll([
      {
        type: 'page.create',
        id: 'db1',
        parentId: null,
        title: 'Tasks',
        kind: 'database',
        now,
        database: {
          properties: [
            {
              id: 'status',
              name: 'Status',
              type: 'select',
              options: [
                { id: 'todo', name: 'To do', color: 'gray' },
                { id: 'done', name: 'Done', color: 'green' },
              ],
            },
            { id: 'flag', name: 'Approved', type: 'checkbox', options: [] },
          ],
          views: [
            {
              id: 'v1',
              name: 'Table',
              type: 'table',
              filters: [],
              sorts: [],
              hidden: [],
              groupBy: null,
              dateProp: null,
            },
          ],
        },
      },
      {
        type: 'page.create',
        id: 'row1',
        parentId: 'db1',
        title: 'Alpha',
        now,
        properties: { status: 'todo' },
      },
      {
        type: 'page.create',
        id: 'row2',
        parentId: 'db1',
        title: 'Beta',
        now,
        properties: { status: 'todo' },
      },
      {
        type: 'page.create',
        id: 'row3',
        parentId: 'db1',
        title: 'Gamma',
        now,
        properties: { status: 'todo' },
      },
    ]);
    if (!seeded.ok) throw new Error(seeded.error);

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root!.render(createElement(DatabaseView, { page: session.getState().pages['db1']!, editable: true }));
    });

    const row1Box = host.querySelector<HTMLInputElement>('input[aria-label="Select Alpha"]');
    const row3Box = host.querySelector<HTMLInputElement>('input[aria-label="Select Gamma"]');
    expect(row1Box).not.toBeNull();
    expect(row3Box).not.toBeNull();

    await act(async () => {
      row1Box!.click();
      row3Box!.click();
    });

    const bulkBar = host.querySelector('.db-bulk-bar');
    expect(bulkBar?.textContent).toContain('2 selected');

    const editButton = Array.from(bulkBar!.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Edit property'),
    );
    expect(editButton).toBeDefined();

    await act(async () => {
      editButton!.click();
    });

    const popover = document.body.querySelector('.db-bulk-popover');
    expect(popover).not.toBeNull();

    const doneOption = Array.from(popover!.querySelectorAll<HTMLButtonElement>('.option-row')).find((b) =>
      b.textContent?.includes('Done'),
    );
    expect(doneOption).toBeDefined();

    await act(async () => {
      doneOption!.click();
    });

    const applyButton = Array.from(popover!.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === 'Apply',
    );
    expect(applyButton?.disabled).toBe(false);

    await act(async () => {
      applyButton!.click();
    });

    expect(session.getState().pages['row1']!.properties['status']).toBe('done');
    expect(session.getState().pages['row2']!.properties['status']).toBe('todo');
    expect(session.getState().pages['row3']!.properties['status']).toBe('done');

    // Reverts both selected pages in one undo step
    expect(stepProperties('undo')).toBe(true);
    expect(session.getState().pages['row1']!.properties['status']).toBe('todo');
    expect(session.getState().pages['row3']!.properties['status']).toBe('todo');

    // Select all checkbox selects every visible row
    const selectAll = host.querySelector<HTMLInputElement>('input[aria-label="Select all rows"]');
    expect(selectAll).not.toBeNull();
    await act(async () => {
      selectAll!.click();
    });
    expect(host.querySelector('.db-bulk-bar')?.textContent).toContain('3 selected');
  });
});
