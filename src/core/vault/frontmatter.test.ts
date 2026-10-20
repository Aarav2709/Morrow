import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseSimple } from './frontmatter';

// whenever the quick reader answers, it must read exactly what yaml itself reads
const VALUES = [
  '4',
  '4.5',
  '1e3',
  '0x1A',
  '0o17',
  '007',
  '-0',
  '+3',
  '-2.5e-3',
  '.5',
  '5.',
  '.inf',
  '.nan',
  '1_000',
  'true',
  'True',
  'TRUE',
  'tRue',
  'false',
  'yes',
  'no',
  'on',
  'null',
  'Null',
  '~',
  '',
  '2024-05-01',
  '2024-05-01T10:00:00Z',
  'Ursula K. Le Guin',
  'a, b',
  'a: b',
  'a:b',
  'a #c',
  'a#c',
  "'q'",
  '"q"',
  'x y',
  '#tag',
  '@x',
  '`x`',
  'a/b',
  'café',
  "it's",
  '-x',
  '- x',
  '? x',
  '| x',
  '> x',
  '%x',
  '&a',
  '*a',
  '!x',
  '[a, b]',
  '[]',
  '[ ]',
  '[a, 1, true]',
  '[a, ]',
  '[a b, c]',
  '[[a]]',
  '{a: 1}',
  'C++',
  'v1.2.3',
  '+',
];
const KEYS = ['title', 'date', 'my key', 'k2', 'Status', '_x', 'a-b', '1key', 'tags', 'key:x'];

let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)]!;

function sample(): string {
  const lines: string[] = [];
  const count = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    const key = pick(KEYS);
    if (rand() < 0.2) {
      lines.push(`${key}:`);
      const indent = pick(['', '  ', '    ']);
      for (let j = Math.floor(rand() * 3); j > 0; j--)
        lines.push(`${rand() < 0.1 ? ' ' : ''}${indent}- ${pick(VALUES)}`);
    } else lines.push(`${key}:${pick([' ', '  ', '\t', ''])}${pick(VALUES)}${pick(['', ' ', ' # note'])}`);
    if (rand() < 0.05) lines.push(pick(['', '# comment', '  nested: 1']));
  }
  return lines.join('\n');
}

describe('the quick frontmatter reader', () => {
  it('agrees with yaml whenever it answers', () => {
    let answered = 0;
    for (let i = 0; i < 20_000; i++) {
      const text = sample();
      const quick = parseSimple(text);
      if (quick === null) continue;
      answered++;
      let full: unknown;
      try {
        full = parse(text, { uniqueKeys: false }) ?? {};
      } catch {
        throw new Error(`answered where yaml fails:\n${text}`);
      }
      expect(quick, text).toEqual(full);
    }
    // it should still take the common shapes itself
    expect(answered).toBeGreaterThan(1000);
  });

  it('reads the usual note frontmatter', () => {
    expect(
      parseSimple(
        'date: 2024-05-01\ntags: [a, b]\nrating: 4\ndone: true\naliases:\n  - One\n  - Two\nempty:',
      ),
    ).toEqual({
      date: '2024-05-01',
      tags: ['a', 'b'],
      rating: 4,
      done: true,
      aliases: ['One', 'Two'],
      empty: null,
    });
  });
});
