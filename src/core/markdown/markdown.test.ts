import { describe, expect, it } from 'vitest';
import { anchorSlice } from '../anchors';
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

  it('resolves wiki links and keeps links to pages that do not exist yet', () => {
    const doc = markdownToDoc('See [[Garden]] and [[Nowhere]].', {
      resolvePage: (title) => (title === 'Garden' ? 'g1' : null),
    });
    const nodes = doc.content![0]!.content!;
    expect(nodes.map((node) => node.type)).toEqual(['text', 'pageLink', 'text', 'pageLink', 'text']);
    expect(nodes[1]!.attrs).toEqual({ id: 'g1', label: 'Garden' });
    expect(nodes[3]!.attrs).toEqual({ id: null, label: 'Nowhere', target: 'Nowhere' });
    const plain = markdownToDoc('See [[Nowhere]].', { keepUnresolved: false });
    expect(plain.content![0]!.content).toEqual([text('See [[Nowhere]].')]);
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

describe('obsidian flavoured markdown', () => {
  const roundTrip = (source: string) => docToMarkdown(markdownToDoc(source, { resolvePage: () => null }));

  it('reads aliases, headings and embeds in wiki links', () => {
    const doc = markdownToDoc('[[Projects/Garden#Beds|the beds]] ![[Diagram]]', {
      resolvePage: (target) => (target === 'Projects/Garden' ? 'g' : null),
    });
    const [link, , embed] = doc.content![0]!.content!;
    expect(link!.attrs).toEqual({ id: 'g', label: 'the beds', anchor: 'Beds', alias: 'the beds' });
    expect(embed!.attrs).toMatchObject({ id: null, target: 'Diagram', embed: true });
  });

  it('round trips wiki links, callouts, maths and highlights exactly', () => {
    const source = [
      'See [[Garden#Beds|the beds]] and ![[Sketch]].',
      '',
      '> [!warning]- Watch out',
      '> The ==soil== is wet.',
      '',
      'Energy is $E = mc^2$ but it costs $5 and $10.',
      '',
      '$$',
      '\\int_0^1 x\\,dx',
      '$$',
      '',
      '<div class="custom">kept as written</div>',
      '',
    ].join('\n');
    expect(roundTrip(source)).toBe(source);
  });

  it('reads callout types, titles and folding', () => {
    const doc = markdownToDoc('> [!TIP]+ Remember\n> Water daily.');
    expect(doc.content![0]).toEqual({
      type: 'callout',
      attrs: { tone: 'tip', kind: 'tip', title: 'Remember', fold: '+' },
      content: [p(text('Water daily.'))],
    });
  });

  it('keeps maths and highlights out of code', () => {
    const doc = markdownToDoc('`$x$` and `==y==`');
    expect(doc.content![0]!.content!.every((node) => node.type === 'text')).toBe(true);
  });

  it('does not escape ordinary punctuation', () => {
    const doc: DocNode = { type: 'doc', content: [p(text('snake_case [x] #tag 100% a+b'))] };
    expect(docToMarkdown(doc)).toBe('snake_case [x] #tag 100% a+b\n');
  });

  it('keeps remote images as images without loading them', () => {
    const doc = markdownToDoc('![logo](https://example.org/logo.png)');
    expect(doc.content![0]).toEqual({
      type: 'image',
      attrs: { fileId: null, src: 'https://example.org/logo.png', alt: 'logo' },
    });
    expect(docToMarkdown(doc)).toBe('![logo](https://example.org/logo.png)\n');
  });

  it('escapes text that would otherwise become a link, maths or a highlight', () => {
    const doc: DocNode = { type: 'doc', content: [p(text('[[not a link]] $a$ and $b$ ==no== [x](y)'))] };
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });
});

describe('colours', () => {
  it('round trips text colours and coloured highlights as html other apps show', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        p(
          { type: 'text', text: 'red words', marks: [{ type: 'textColor', attrs: { color: 'red' } }] },
          text(' and '),
          { type: 'text', text: 'blue marker', marks: [{ type: 'highlight', attrs: { color: 'blue' } }] },
          text(' and '),
          { type: 'text', text: 'plain marker', marks: [{ type: 'highlight' }] },
        ),
      ],
    };
    const out = docToMarkdown(doc);
    expect(out).toBe(
      '<span style="color: #d44c47">red words</span> and <mark style="background: #e7f3f8">blue marker</mark> and ==plain marker==\n',
    );
    expect(markdownToDoc(out)).toEqual(doc);
  });

  it('snaps other colours to the nearest one in the palette', () => {
    const doc = markdownToDoc('<span style="color: #ff0000">alarm</span>');
    expect(doc.content![0]!.content![0]!.marks).toEqual([{ type: 'textColor', attrs: { color: 'red' } }]);
  });
});

describe('layout blocks', () => {
  it('keeps columns, a table of contents and dates through a save and load', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'tableOfContents' },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plan' }] },
        {
          type: 'columns',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Left' }] }] },
            {
              type: 'column',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Right' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Due ' },
            { type: 'dateMention', attrs: { date: '2026-10-20' } },
          ],
        },
      ],
    };
    const markdown = docToMarkdown(doc);
    expect(markdown).toContain('<!-- toc -->');
    expect(markdown).toContain('[[2026-10-20]]');
    expect(markdownToDoc(markdown)).toEqual(doc);
  });
});

describe('block ids and anchors', () => {
  it('keeps an obsidian block id on its paragraph and writes it back the same', () => {
    const source = 'A thought worth linking to ^idea-1\n\n- [ ] A task ^task9\n\n^loose\n';
    const doc = markdownToDoc(source);
    expect(doc.content![0]).toEqual({
      type: 'paragraph',
      attrs: { blockId: 'idea-1' },
      content: [{ type: 'text', text: 'A thought worth linking to' }],
    });
    expect(docToMarkdown(doc)).toBe(source);
  });

  it('cuts out the block or the heading section an anchor points at', () => {
    const doc = markdownToDoc(
      '# Plan\n\nIntro\n\n## Goals\n\nShip it ^ship\n\n### Detail\n\nMore\n\n## Later\n\nAfter\n',
    );
    expect(anchorSlice(doc, '^ship')?.content?.[0]?.attrs?.blockId).toBe('ship');
    const goals = anchorSlice(doc, 'goals');
    expect(goals?.content?.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
    ]);
    expect(anchorSlice(doc, '^missing')).toBeNull();
  });
});

describe('things that used to change on a reload', () => {
  const files = {
    resolveFile: (href: string) => ({ fileId: href, name: href, image: href.endsWith('.png') }),
  };
  const settles = (markdown: string) => {
    let current = markdown;
    for (let i = 0; i < 3; i++)
      current = docToMarkdown(markdownToDoc(current, files), { filePath: (id) => id });
    return current;
  };

  it('keeps empty lines left between paragraphs', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph' },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
        { type: 'paragraph' },
      ],
    };
    const markdown = docToMarkdown(doc);
    expect(markdown).toBe('One\n\n<br>\n\n<br>\n\nTwo\n');
    expect(markdownToDoc(markdown).content?.map((node) => (node.content ?? []).length)).toEqual([1, 0, 0, 1]);
  });

  it('keeps a picture in a nested bullet as a bullet, not a heading', () => {
    expect(settles('- parent\n  - ![](attachments/pic.png)\n')).toBe(
      '- parent\n  - ![](attachments/pic.png)\n',
    );
    expect(settles('- parent\n  - <br>\n  - b\n')).toBe('- parent\n  - <br>\n  - b\n');
  });
});
