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
