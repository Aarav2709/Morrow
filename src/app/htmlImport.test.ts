// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { htmlFileToMarkdown, htmlToMarkdown } from './htmlImport';
import { markdownToDoc } from '../core/markdown/parse';

describe('importing html', () => {
  it('turns a page into markdown, keeping its headings, lists, links, pictures and tables', () => {
    const { title, markdown } =
      htmlToMarkdown(`<!doctype html><html><head><title>Trip</title><style>p{}</style></head>
      <body><h1>Trip</h1><p>Pack <strong>light</strong> and read <a href="https://example.org">this</a>.</p>
      <ul><li>Passport<ul><li>Copy</li></ul></li><li><input type="checkbox" checked>Tickets</li></ul>
      <img src="Trip/map%20one.png" alt="Map"><img src="data:image/png;base64,AAAA">
      <table><tr><th>Day</th><th>Where</th></tr><tr><td>1</td><td>Lisbon</td></tr></table>
      <pre><code class="language-js">let a = 1;</code></pre><script>alert(1)</script></body></html>`);
    expect(title).toBe('Trip');
    expect(markdown).toContain('Pack **light** and read [this](https://example.org).');
    expect(markdown).toContain('- Passport\n  - Copy');
    expect(markdown).toContain('- [x] Tickets');
    expect(markdown).toContain('![Map](<Trip/map one.png>)');
    expect(markdown).not.toContain('data:image');
    expect(markdown).toContain('| Day | Where |');
    expect(markdown).toContain('```js\nlet a = 1;\n```');
    expect(markdown).not.toContain('alert');
    expect(markdown.startsWith('# Trip')).toBe(false);
  });

  it('reads back as the same blocks once in markdown', () => {
    const doc = markdownToDoc(
      htmlFileToMarkdown('<p>One</p><h2>Two</h2><blockquote><p>Three</p></blockquote>', 'Note'),
    );
    expect(doc.content!.map((node) => node.type)).toEqual(['heading', 'paragraph', 'heading', 'blockquote']);
  });
});
