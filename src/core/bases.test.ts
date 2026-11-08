import { describe, expect, it } from 'vitest';
import { display, parseExpression, runBase } from './bases';
import { newPageMeta } from './model';
import type { DocNode, PageMeta, WorkspaceState } from './model';

const NOW = Date.parse('2026-11-10T12:00:00');

function vault(): { state: WorkspaceState; paths: Record<string, string> } {
  const pages: Record<string, PageMeta> = {};
  const docs: Record<string, DocNode> = {};
  const paths: Record<string, string> = {};
  const add = (
    id: string,
    title: string,
    path: string,
    extra: Record<string, unknown>,
    tags: string[] = [],
  ) => {
    pages[id] = newPageMeta({
      id,
      parentId: null,
      title,
      extra,
      tags,
      updatedAt: NOW - 86_400_000,
      createdAt: NOW,
    });
    docs[id] = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
    paths[id] = path;
  };
  add('dune', 'Dune', 'Reading/Dune.md', { author: 'Herbert', rating: 5, status: 'done', pages: 412 }, [
    'book',
  ]);
  add('emma', 'Emma', 'Reading/Emma.md', { author: 'Austen', rating: 4, status: 'reading', pages: 474 }, [
    'book',
  ]);
  add('ulysses', 'Ulysses', 'Reading/Later/Ulysses.md', { author: 'Joyce', rating: 3, status: 'later' }, [
    'book',
  ]);
  add('groceries', 'Groceries', 'Lists/Groceries.md', {});
  return { state: { pages, docs }, paths };
}

const run = (source: string) => {
  const { state, paths } = vault();
  return runBase(source, state, { pathOf: (id) => paths[id] ?? null, now: NOW });
};

describe('bases', () => {
  it('filters by tag and folder, with columns, sorting and a limit', () => {
    const [view] = run(`
filters:
  and:
    - file.hasTag("book")
    - file.inFolder("Reading")
views:
  - type: table
    name: Books
    order: [file.name, author, rating]
    sort:
      - property: rating
        direction: DESC
    limit: 2
`);
    expect(view!.error).toBeNull();
    expect(view!.name).toBe('Books');
    expect(view!.columns.map((column) => column.label)).toEqual(['Name', 'Author', 'Rating']);
    expect(view!.rows.map((row) => row.values['file.name'])).toEqual(['Dune', 'Emma']);
  });

  it('works out formulas and compares values', () => {
    const [view] = run(`
formulas:
  long: 'if(pages > 450, "long", "short")'
  stars: 'rating * 2'
views:
  - type: table
    filters: 'status != "later" && !file.inFolder("Lists")'
    order: [file.name, formula.long, formula.stars]
    sort:
      - property: file.name
`);
    expect(
      view!.rows.map((row) => [
        row.values['file.name'],
        row.values['formula.long'],
        row.values['formula.stars'],
      ]),
    ).toEqual([
      ['Dune', 'short', 10],
      ['Emma', 'long', 8],
    ]);
  });

  it('reads or and not groups, methods and dates', () => {
    const [view] = run(`
filters:
  or:
    - author.startsWith("aus")
    - file.name.contains("uly")
views:
  - type: cards
    filters:
      not:
        - file.mtime < now() - "2 days"
`);
    expect(view!.type).toBe('cards');
    expect(view!.rows.map((row) => row.pageId).sort()).toEqual(['emma', 'ulysses']);
  });

  it('shows a mistake instead of failing the page', () => {
    const [view] = run(`views:\n  - type: table\n    filters: 'rating >'`);
    expect(view!.error).toMatch(/ends too soon/);
    expect(() => run('views: [')).toThrow(/YAML/);
  });

  it('parses operator precedence the usual way', () => {
    const tree = parseExpression('1 + 2 * 3 == 7 && true');
    expect(tree.type).toBe('binary');
    expect(display({ date: Date.parse('2026-01-05T00:00:00') })).toBe('2026-01-05');
  });
});
