import { describe, expect, it } from 'vitest';
import { formatRepeat, nextOccurrence, parseRepeat, stepDate } from './repeat';

describe('repeating dates', () => {
  it('read and write the words obsidian tasks uses', () => {
    for (const text of [
      'every day',
      'every 2 weeks',
      'every weekday',
      'every month when done',
      'every year until 2027-01-01',
      'every week for 3 times',
    ])
      expect(formatRepeat(parseRepeat(text)!.rule)).toBe(text);
    expect(parseRepeat('every fortnight')).toBeNull();
    expect(parseRepeat('every 3 days and more')!.length).toBe('every 3 days'.length);
  });

  it('step to the next day the rule falls on', () => {
    const friday = new Date(2026, 10, 20);
    expect(stepDate(friday, { every: 1, unit: 'weekday' }).getDate()).toBe(23);
    // the 31st of a short month falls on its last day
    expect(stepDate(new Date(2026, 0, 31), { every: 1, unit: 'month' }).getDate()).toBe(28);
  });

  it('come round again after being done, until the rule runs out', () => {
    const rule = parseRepeat('every week for 2 times')!.rule;
    const next = nextOccurrence('2026-11-20', rule, new Date(2026, 10, 20), '2026-11-21')!;
    expect(next).toEqual({
      date: '2026-11-27',
      end: '2026-11-28',
      rule: { every: 1, unit: 'week', count: 1 },
    });
    expect(nextOccurrence(next.date, next.rule, new Date(2026, 10, 27))).toBeNull();
    expect(
      nextOccurrence('2026-11-20', parseRepeat('every day until 2026-11-20')!.rule, new Date(2026, 10, 20)),
    ).toBeNull();
    // done late it still comes next in the future, done when done counts from today
    expect(nextOccurrence('2026-11-01', { every: 1, unit: 'week' }, new Date(2026, 10, 20))!.date).toBe(
      '2026-11-22',
    );
    expect(
      nextOccurrence('2026-11-01', { every: 3, unit: 'day', whenDone: true }, new Date(2026, 10, 20))!.date,
    ).toBe('2026-11-23');
  });
});

describe('a repeating task ticked off', () => {
  it('comes round again just above it, with its date moved on', async () => {
    const { markdownToDoc } = await import('./markdown/parse');
    const { docToMarkdown } = await import('./markdown/serialize');
    const { setTaskChecked } = await import('./tasks');
    const doc = markdownToDoc('- [ ] Water plants [[2026-11-20]] 🔁 every 3 days\n- [ ] Other\n');
    const next = setTaskChecked(doc, 0, true, new Date(2026, 10, 20))!;
    expect(docToMarkdown(next)).toBe(
      '- [ ] Water plants [[2026-11-23]] 🔁 every 3 days\n- [x] Water plants [[2026-11-20]] 🔁 every 3 days\n- [ ] Other\n',
    );
    // a task that doesn't repeat is only ticked
    expect(docToMarkdown(setTaskChecked(doc, 1, true)!)).toContain('- [x] Other');
  });
});

describe('a task changed from its details', () => {
  it('keeps its words and formatting when only its date changes, and takes new words when they change', async () => {
    const { markdownToDoc } = await import('./markdown/parse');
    const { docToMarkdown } = await import('./markdown/serialize');
    const { updateTask } = await import('./tasks');
    const doc = markdownToDoc('- [ ] Call **Ana** [[2026-11-20]]\n');
    const moved = updateTask(
      doc,
      0,
      {
        text: 'Call Ana',
        date: '2026-11-21',
        time: '10:00',
        end: null,
        endTime: null,
        repeat: 'every month',
      },
      'Call Ana',
    )!;
    expect(docToMarkdown(moved)).toBe('- [ ] Call **Ana** [[2026-11-21]] 10:00 🔁 every month\n');
    const renamed = updateTask(
      doc,
      0,
      { text: 'Call Bo', date: '2026-11-20', time: null, end: '2026-11-22', endTime: null, repeat: null },
      'Call Ana',
    )!;
    expect(docToMarkdown(renamed)).toBe('- [ ] Call Bo [[2026-11-20]] → [[2026-11-22]]\n');
  });
});

describe('a synced block edited where it is shown', () => {
  it('is written back into its page, keeping its id', async () => {
    const { markdownToDoc } = await import('./markdown/parse');
    const { docToMarkdown } = await import('./markdown/serialize');
    const { anchorSlice, replaceAnchorSlice } = await import('./anchors');
    const page = markdownToDoc('Intro\n\nShared words ^abc123\n\n## Part\n\nOne\n\n## Next\n\nTwo\n');
    const edited = { type: 'paragraph', content: [{ type: 'text', text: 'Shared and changed' }] };
    expect(docToMarkdown(replaceAnchorSlice(page, '^abc123', [edited])!)).toContain(
      'Shared and changed ^abc123',
    );
    const part = anchorSlice(page, 'Part')!;
    const more = [...part.content!, { type: 'paragraph', content: [{ type: 'text', text: 'Added' }] }];
    expect(docToMarkdown(replaceAnchorSlice(page, 'Part', more)!)).toContain(
      '## Part\n\nOne\n\nAdded\n\n## Next',
    );
    expect(replaceAnchorSlice(page, '^gone', [edited])).toBeNull();
  });
});
