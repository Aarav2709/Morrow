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
