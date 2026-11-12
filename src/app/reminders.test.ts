// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { DocNode } from '../core/model';
import { reminderText } from './reminders';

const date = (key: string): DocNode => ({ type: 'dateMention', attrs: { date: key } });
const text = (words: string): DocNode => ({ type: 'text', text: words });
const doc = (...lines: DocNode[][]): DocNode => ({
  type: 'doc',
  content: lines.map((content) => ({ type: 'paragraph', content })),
});

describe('reminder notifications', () => {
  it('say what is written before the date', () => {
    const page = doc([text('Other line')], [text('Food for cats '), date('2026-11-10')]);
    expect(reminderText(page, '2026-11-10')).toBe('Food for cats');
  });

  it('have nothing to add for a date on its own', () => {
    expect(reminderText(doc([date('2026-11-10'), text(' later')]), '2026-11-10')).toBeNull();
    expect(reminderText(doc([text('No date here')]), '2026-11-10')).toBeNull();
  });
});
