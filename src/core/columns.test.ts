import { describe, expect, it } from 'vitest';
import { moveKey, TITLE_PROP, viewColumns } from './database';
import { normalizeDatabase } from './migrations';
import type { PropDef, ViewDef } from './model';

const prop = (id: string): PropDef => ({ id, name: id, type: 'text', options: [] }) as PropDef;
const view: ViewDef = {
  id: 'v',
  name: 'Table',
  type: 'table',
  filters: [],
  sorts: [],
  groupBy: null,
  dateProp: null,
  hidden: [],
};

describe('database columns', () => {
  it('keep the order they were dragged into, the name column included', () => {
    const props = [prop('a'), prop('b'), prop('c')];
    const keys = (columns: ReturnType<typeof viewColumns>) =>
      columns.map((column) => (column === TITLE_PROP ? TITLE_PROP : column.id));
    expect(keys(viewColumns(view, props))).toEqual(['title', 'a', 'b', 'c']);
    const moved = moveKey(keys(viewColumns(view, props)), 'title', 'c');
    expect(moved).toEqual(['a', 'b', 'title', 'c']);
    // a property added later goes after the ones in the saved order
    expect(keys(viewColumns({ ...view, columns: moved }, [...props, prop('d')]))).toEqual([
      'a',
      'b',
      'title',
      'c',
      'd',
    ]);
  });

  it('read the saved order back from the file', () => {
    const database = normalizeDatabase({
      properties: [],
      views: [{ id: 'v', name: 'Table', type: 'table', columns: ['b', 'title', 7] }],
    });
    expect(database?.views[0]?.columns).toEqual(['b', 'title']);
  });
});
