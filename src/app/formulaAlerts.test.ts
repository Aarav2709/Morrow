import { describe, expect, it } from 'vitest';
import { alertMatches, dueAlerts } from './formulaAlerts';

const prop = (notifyWhen?: string) =>
  ({ id: 'f', name: 'Due', type: 'formula', options: [], notify: true, formula: '', notifyWhen }) as never;

describe('formula notifications', () => {
  it('match the words watched for, or a true value when none are given', () => {
    expect(alertMatches(prop('Overdue'), 'overdue')).toBe(true);
    expect(alertMatches(prop('Overdue'), 'Due tomorrow')).toBe(false);
    expect(alertMatches(prop(), true)).toBe(true);
    expect(alertMatches(prop(), false)).toBe(false);
  });

  it('come from rows whose formula says so, once a day each', () => {
    const database = {
      properties: [
        {
          id: 'f',
          name: 'Due',
          type: 'formula',
          options: [],
          notify: true,
          notifyWhen: 'Overdue',
          formula: 'prop("Late")',
        },
        { id: 'late', name: 'Late', type: 'text', options: [] },
      ],
      views: [],
    };
    const page = (id: string, extra: object) => ({
      id,
      title: id,
      parentId: null,
      trashedAt: null,
      archivedAt: null,
      properties: {},
      order: 0,
      ...extra,
    });
    const state = {
      pages: {
        db: page('db', { kind: 'database', database }),
        a: page('a', { parentId: 'db', properties: { late: 'Overdue' } }),
        b: page('b', { parentId: 'db', properties: { late: 'Fine' } }),
      },
      docs: {},
    } as never;
    const alerts = dueAlerts(state, new Date(2026, 10, 20));
    expect(alerts.map((alert) => [alert.pageId, alert.body, alert.key])).toEqual([
      ['a', 'Due: Overdue', 'a:f:2026-11-20'],
    ]);
  });
});
