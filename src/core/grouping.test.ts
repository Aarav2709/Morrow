import { describe, expect, it } from 'vitest';
import { arrangeGroups, groupRows, moveGroup, NO_VALUE_GROUP } from './database';
import { newPageMeta } from './model';
import type { DatabaseDef, ViewDef } from './model';

const database: DatabaseDef = {
  properties: [
    {
      id: 'status',
      name: 'Status',
      type: 'select',
      options: [
        { id: 'todo', name: 'To do', color: 'gray' },
        { id: 'doing', name: 'Doing', color: 'blue' },
        { id: 'done', name: 'Done', color: 'green' },
      ],
    },
  ],
  views: [],
};
const row = (id: string, status: string | null) =>
  newPageMeta({ id, parentId: 'db', properties: status ? { status } : {} });
const view: ViewDef = {
  id: 'v',
  name: 'Table',
  type: 'table',
  filters: [],
  sorts: [],
  groupBy: 'status',
  dateProp: null,
  hidden: [],
};

describe('grouping a view', () => {
  const groups = groupRows([row('a', 'todo'), row('b', 'done'), row('c', null)], 'status', database);

  it('puts the groups in the view order, leaving out hidden and empty ones', () => {
    const arranged = arrangeGroups(groups, {
      ...view,
      groupOrder: ['done', 'todo'],
      hiddenGroups: [NO_VALUE_GROUP],
      hideEmptyGroups: true,
    });
    expect(arranged.map((group) => group.key)).toEqual(['done', 'todo']);
  });

  it('moves a group a place up', () => {
    expect(moveGroup(groups, view, 'done', -1)).toEqual([NO_VALUE_GROUP, 'todo', 'done', 'doing']);
  });
});

describe('a dashboard', () => {
  it('works out its numbers and counts rows by month', async () => {
    const { widgetNumber, rowsByMonth } = await import('./database');
    const rows = [
      newPageMeta({ id: 'a', parentId: 'db', properties: { hours: 2, due: '2026-11-03' } }),
      newPageMeta({ id: 'b', parentId: 'db', properties: { hours: 4, due: '2026-10-20' } }),
    ];
    expect(widgetNumber({ id: 'w', kind: 'count', prop: null }, rows)).toBe(2);
    expect(widgetNumber({ id: 'w', kind: 'sum', prop: 'hours' }, rows)).toBe(6);
    expect(widgetNumber({ id: 'w', kind: 'average', prop: 'hours' }, rows)).toBe(3);
    const months = rowsByMonth(rows, 'due', new Date(2026, 10, 18));
    expect(months).toHaveLength(12);
    expect(months.slice(-2)).toEqual([
      { month: '2026-10', count: 1 },
      { month: '2026-11', count: 1 },
    ]);
  });
});
