import { describe, expect, it } from 'vitest';
import { formFields, formValues } from './FormView';
import { rowSpan, shiftSpan } from './TimelineView';

const row = (properties: Record<string, unknown>) => ({ id: 'r', title: 'Row', properties }) as never;

describe('a timeline', () => {
  it('places a row from its start to its end, one day without an end', () => {
    const span = rowSpan(row({ s: '2026-11-02', e: '2026-11-05' }), 's', 'e')!;
    expect([span.start.getDate(), span.end.getDate()]).toEqual([2, 5]);
    expect(rowSpan(row({ s: '2026-11-02' }), 's', 'e')!.end.getDate()).toBe(2);
    // an end before the start is taken as the start
    expect(rowSpan(row({ s: '2026-11-09', e: '2026-11-05' }), 's', 'e')!.end.getDate()).toBe(9);
    expect(rowSpan(row({}), 's', 'e')).toBeNull();
  });

  it('moves a bar whole, or stretches one end without passing the other', () => {
    const span = { start: new Date(2026, 10, 2), end: new Date(2026, 10, 5) };
    const moved = shiftSpan(span, 'move', 3);
    expect([moved.start.getDate(), moved.end.getDate()]).toEqual([5, 8]);
    expect(shiftSpan(span, 'end', -10).end.getDate()).toBe(2);
    expect(shiftSpan(span, 'start', 10).start.getDate()).toBe(5);
  });
});

describe('a form', () => {
  it('asks for every property but formulas and turns the answers into values', () => {
    const database = {
      properties: [
        { id: 'n', name: 'Count', type: 'number' as const, options: [] },
        { id: 'r', name: 'People', type: 'relation' as const, options: [] },
        { id: 'f', name: 'Total', type: 'formula' as const, options: [], formula: '1' },
        { id: 't', name: 'Notes', type: 'text' as const, options: [] },
      ],
      views: [],
    };
    const fields = formFields(database, []);
    expect(fields.map((prop) => prop.id)).toEqual(['n', 'r', 't']);
    expect(formValues(fields, { n: '3', r: 'Ana, Bo', t: '' })).toEqual({ n: 3, r: ['Ana', 'Bo'] });
  });
});
