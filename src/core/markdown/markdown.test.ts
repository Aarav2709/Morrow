import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model';
import { markdownToDoc, markdownToPage } from './parse';
import { docToMarkdown } from './serialize';

const text = (value: string, marks?: string[]): DocNode =>
  marks
    ? { type: 'text', text: value, marks: marks.map((type) => ({ type })) }
    : { type: 'text', text: value };
const p = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content });

// a realistic note touching every supported block
const NOTE = `## Weekly review

Shipped the **sidebar** rewrite, fixed *two* bugs and wrote \`docs\`. See [the plan](https://example.org/plan).

Also <u>underlined</u> and ~~struck~~ text.

- Groceries
  - oat milk
  - bread
- Post office

1. Draft
2. Edit
3. Publish

- [x] Book train tickets
- [ ] Call the landlord

> Simplicity is prerequisite for reliability.

\`\`\`ts
const answer = 42;
\`\`\`

---

| Book | Author |
| --- | --- |
| Middlemarch | George Eliot |
| Piranesi | Susanna Clarke |
`;

describe('markdown import', () => {
  const doc = markdownToDoc(NOTE);
  const types = doc.content!.map((node) => node.type);

  it('maps every supported block', () => {
    expect(types).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'bulletList',
      'orderedList',
      'taskList',
      'blockquote',
      'codeBlock',
      'horizontalRule',
      'table',
    ]);
  });

  it('keeps inline formatting', () => {
    const marks = doc.content![1]!.content!.flatMap((node) => (node.marks ?? []).map((mark) => mark.type));
    expect(marks).toEqual(expect.arrayContaining(['bold', 'italic', 'code', 'link']));
    const second = doc.content![2]!.content!.flatMap((node) => (node.marks ?? []).map((mark) => mark.type));
    expect(second).toEqual(['underline', 'strike']);
  });

  it('reads checklists, nesting and code languages', () => {
    const tasks = doc.content![5]!.content!;
    expect(tasks.map((item) => item.attrs?.checked)).toEqual([true, false]);
    expect(tasks[0]!.content![0]!.content![0]!.text).toBe('Book train tickets');
    expect(doc.content![3]!.content![0]!.content![1]!.type).toBe('bulletList');
    expect(doc.content![7]!.attrs?.language).toBe('ts');
  });

  it('builds tables with a header row', () => {
    const rows = doc.content![9]!.content!;
    expect(rows).toHaveLength(3);
    expect(rows[0]!.content![0]!.type).toBe('tableHeader');
    expect(rows[1]!.content![1]!.content![0]!.content![0]!.text).toBe('George Eliot');
  });

  it('uses the first level one heading as the title', () => {
    const page = markdownToPage('# Trip notes\n\nPack light.', 'file');
    expect(page.title).toBe('Trip notes');
    expect(page.doc.content).toHaveLength(1);
    expect(markdownToPage('Just text', 'fallback').title).toBe('fallback');
  });

  it('resolves wiki links only when the page exists', () => {
    const doc = markdownToDoc('See [[Garden]] and [[Nowhere]].', {
      resolvePage: (title) => (title === 'Garden' ? 'g1' : null),
    });
    const nodes = doc.content![0]!.content!;
    expect(nodes.map((node) => node.type)).toEqual(['text', 'pageLink', 'text']);
    expect(nodes[1]!.attrs).toEqual({ id: 'g1', label: 'Garden' });
    expect(nodes[2]!.text).toBe(' and [[Nowhere]].');
  });

  it('splits mixed task and bullet lists', () => {
    const doc = markdownToDoc('- [ ] task\n- plain\n- [x] done\n- [ ]');
    expect(doc.content!.map((node) => node.type)).toEqual(['taskList', 'bulletList', 'taskList']);
    expect(doc.content![2]!.content).toHaveLength(2);
  });

  it('handles empty and hostile input', () => {
    expect(markdownToDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(() => markdownToDoc('>'.repeat(5000))).not.toThrow();
    expect(() => markdownToDoc('['.repeat(10000))).not.toThrow();
  });
});

describe('markdown export', () => {
  it('round trips a realistic note without losing structure or text', () => {
    const first = markdownToDoc(NOTE);
    const exported = docToMarkdown(first);
    expect(markdownToDoc(exported)).toEqual(first);
  });

  it('writes the expected syntax', () => {
    const out = docToMarkdown(markdownToDoc(NOTE));
    expect(out).toContain('## Weekly review');
    expect(out).toContain('**sidebar**');
    expect(out).toContain('- [x] Book train tickets');
    expect(out).toContain('  - oat milk');
    expect(out).toContain('```ts\nconst answer = 42;\n```');
    expect(out).toContain('| Middlemarch | George Eliot |');
  });

  it('escapes characters that would otherwise become formatting', () => {
    const doc: DocNode = { type: 'doc', content: [p(text('# not a heading *nor* _this_ [x]'))] };
    const out = docToMarkdown(doc);
    expect(markdownToDoc(out)).toEqual(doc);
  });

  it('keeps whitespace outside of marks', () => {
    const doc: DocNode = { type: 'doc', content: [p(text('a'), text(' bold ', ['bold']), text('b'))] };
    expect(docToMarkdown(doc)).toBe('a **bold** b\n');
  });

  it('writes page links as wiki links with current titles', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [p(text('see '), { type: 'pageLink', attrs: { id: 'x', label: 'Old' } })],
    };
    expect(docToMarkdown(doc, { titleOf: () => 'New title' })).toBe('see [[New title]]\n');
  });

  it('fences code that contains backticks', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: null }, content: [text('```\nx')] }],
    };
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });
});
