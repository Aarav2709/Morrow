import { describe, expect, it } from 'vitest';
import { computeFormula } from './formula';

const props: Record<string, number | string | boolean | null> = {
  Price: 12.5,
  Count: 4,
  Done: true,
  Due: '2026-10-20',
  Name: 'Tea',
};
const run = (source: string) => computeFormula(source, (name) => props[name] ?? null, new Date(2026, 9, 16));

describe('formulas', () => {
  it('does arithmetic with properties in the usual order', () => {
    expect(run('prop("Price") * prop("Count") + 1').value).toBe(51);
    expect(run('2 ^ 3 ^ 2').value).toBe(512);
    expect(run('-(1 + 2) * 3').value).toBe(-9);
    expect(run('round(10 / 3, 2)').value).toBe(3.33);
    expect(run('1 / 0').value).toBeNull();
  });

  it('handles text, conditions and logic', () => {
    expect(run('if(prop("Done"), "✅ done", "⏳ open")').value).toBe('✅ done');
    expect(run('concat(upper(prop("Name")), "!")').value).toBe('TEA!');
    expect(run('prop("Name") + " x" + prop("Count")').value).toBe('Tea x4');
    expect(run('prop("Count") > 3 and not empty(prop("Name"))').value).toBe(true);
    expect(run('contains(prop("Name"), "e")').value).toBe(true);
  });

  it('works with dates', () => {
    expect(run('dateBetween(prop("Due"), today(), "days")').value).toBe(4);
    expect(run('dateAdd(prop("Due"), 1, "months")').value).toBe('2026-11-20');
  });

  it('reports mistakes instead of throwing', () => {
    expect(run('prop("Price" *').error).toBeTruthy();
    expect(run('nope(1)').error).toContain('nope');
    expect(run('"open').error).toContain('quote');
    expect(run('').value).toBeNull();
  });
});

describe('rollups over a relation', () => {
  it('work out a number from the rows a relation points at', async () => {
    const { formulaResult, rollupOf, setRelatedLookup } = await import('./database');
    expect(rollupOf([1, 2, 3], 'sum')).toBe(6);
    expect(rollupOf([true, false, true, true], 'percentChecked')).toBe(75);
    expect(rollupOf(['a', null, 'b'], 'list')).toBe('a, b');
    const tasks = {
      properties: [
        { id: 'hours', name: 'Hours', type: 'number' as const, options: [] },
        { id: 'done', name: 'Done', type: 'checkbox' as const, options: [] },
      ],
      views: [],
    };
    const row = (title: string, hours: number, done: boolean) =>
      ({ id: title, title, properties: { hours, done } }) as never;
    setRelatedLookup((titles) =>
      [row('Write', 3, true), row('Edit', 2, false)]
        .filter((page) => titles.includes((page as { title: string }).title))
        .map((page) => ({ page, database: tasks })),
    );
    const project = {
      properties: [
        { id: 'rel', name: 'Tasks', type: 'relation' as const, options: [] },
        {
          id: 'f',
          name: 'Hours',
          type: 'formula' as const,
          options: [],
          formula: 'rollup("Tasks", "Hours", "sum")',
        },
      ],
      views: [],
    };
    const page = { id: 'p', title: 'Book', properties: { rel: ['Write', 'Edit'] } } as never;
    expect(formulaResult(page, project.properties[1]!, project).value).toBe(5);
    const done = { ...project.properties[1]!, formula: 'rollup("Tasks", "Done", "percentChecked")' };
    expect(formulaResult(page, done, project).value).toBe(50);
    setRelatedLookup(null);
  });
});
