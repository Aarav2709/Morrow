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
