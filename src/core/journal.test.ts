import { describe, expect, it } from 'vitest';
import { journalGroups } from './daily';
import { newPageMeta } from './model';

const note = (key: string) => newPageMeta({ id: key, parentId: null, dailyDate: key, title: key });

describe('the journal', () => {
  it('folds daily notes into this week, last week, this month, last month and older', () => {
    // wednesday 18 november 2026, weeks starting on monday
    const today = new Date(2026, 10, 18);
    const groups = journalGroups(
      ['2026-11-18', '2026-11-16', '2026-11-12', '2026-11-03', '2026-10-20', '2026-09-01', '2026-11-20'].map(
        note,
      ),
      today,
      1,
    );
    expect(groups.map((entry) => [entry.group, entry.notes.map((page) => page.dailyDate)])).toEqual([
      ['thisWeek', ['2026-11-20', '2026-11-18', '2026-11-16']],
      ['lastWeek', ['2026-11-12']],
      ['thisMonth', ['2026-11-03']],
      ['lastMonth', ['2026-10-20']],
      ['older', ['2026-09-01']],
    ]);
  });
});

describe('tasks on a calendar', () => {
  it('puts a task on the day of its @date, or of the daily note it is in', async () => {
    const { tasksInDoc, tasksByDay } = await import('./tasks');
    const task = (text: string, date?: string, time?: string) => ({
      type: 'taskItem',
      attrs: { checked: false },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text },
            ...(date ? [{ type: 'dateMention', attrs: { date, time: time ?? null } }] : []),
          ],
        },
      ],
    });
    const doc = {
      type: 'doc',
      content: [{ type: 'taskList', content: [task('Call', '2026-11-20', '09:30'), task('Shop')] }],
    };
    const page = newPageMeta({ id: 'p', parentId: null, dailyDate: '2026-11-18' });
    const state = { pages: { p: page }, docs: { p: doc } } as never;
    const days = tasksByDay(state, tasksInDoc('p', doc));
    expect(days.get('2026-11-20')!.map((item) => [item.text, item.time])).toEqual([['Call', '09:30']]);
    expect(days.get('2026-11-18')!.map((item) => item.text)).toEqual(['Shop']);
  });
});
