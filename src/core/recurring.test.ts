import { describe, expect, it } from 'vitest';
import { emptyWorkspace, newPageMeta } from './model';
import type { PageMeta, WorkspaceState } from './model';
import { dueRecurrences, pageAtPath, periodKey, withRecurrence } from './recurring';

function workspace(templateExtra: Record<string, unknown>): WorkspaceState {
  const pages: Record<string, PageMeta> = {};
  const add = (page: Partial<PageMeta> & { id: string; title: string }) => {
    pages[page.id] = { ...newPageMeta({ ...page, parentId: page.parentId ?? null, createdAt: 1 }), ...page };
  };
  add({ id: 'templates', title: 'Templates', kind: 'templates' });
  add({ id: 'review', title: 'Weekly review', parentId: 'templates', extra: templateExtra });
  add({ id: 'work', title: 'Work' });
  add({ id: 'meetings', title: 'Meetings', parentId: 'work' });
  add({ id: 'other', title: 'Meetings' });
  return { ...emptyWorkspace(), pages };
}

describe('recurring templates', () => {
  it('names the period a day falls in', () => {
    const wednesday = new Date(2026, 9, 21);
    expect(periodKey('daily', wednesday)).toBe('2026-10-21');
    expect(periodKey('weekly', wednesday)).toBe('2026-10-19');
    expect(periodKey('weekly', new Date(2026, 9, 25))).toBe('2026-10-19');
    expect(periodKey('monthly', wednesday)).toBe('2026-10');
    expect(periodKey('weekdays', new Date(2026, 9, 24))).toBeNull();
  });

  it('is due once per period, into the page it names', () => {
    const now = new Date(2026, 9, 21);
    const state = workspace({ Repeat: 'Weekly', 'repeat-into': '[[Work/Meetings]]' });
    const due = dueRecurrences(state, now);
    expect(due.map((item) => [item.template.id, item.key, item.recurrence.into])).toEqual([
      ['review', '2026-10-19', 'meetings'],
    ]);
    const done = workspace(withRecurrence(state.pages.review!.extra, { 'repeat-last': '2026-10-19' }));
    expect(done.pages.review!.extra).toEqual({
      Repeat: 'Weekly',
      'repeat-into': '[[Work/Meetings]]',
      'repeat-last': '2026-10-19',
    });
    expect(dueRecurrences(done, now)).toEqual([]);
    expect(dueRecurrences(done, new Date(2026, 9, 26))).toHaveLength(1);
  });

  it('finds a page by its path first and its name second', () => {
    const state = workspace({});
    expect(pageAtPath(state, '[[Work/Meetings]]')).toBe('meetings');
    expect(pageAtPath(state, 'meetings')).not.toBeNull();
    expect(pageAtPath(state, '[[Nowhere]]')).toBeNull();
  });

  it('ignores templates without a repeat it understands', () => {
    expect(dueRecurrences(workspace({ repeat: 'hourly' }), new Date())).toEqual([]);
    expect(dueRecurrences(workspace({}), new Date())).toEqual([]);
  });
});
