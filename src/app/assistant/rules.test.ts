import { describe, expect, it } from 'vitest';
import type { DocNode } from '../../core/model';
import { markdownToDoc } from '../../core/markdown/parse';
import { docToMarkdown } from '../../core/markdown/serialize';
import { assistantRules } from './rules';

// one example of every form the assistant is told about, as it would write them
const EXAMPLE = `## Plan

Talk to [[Garden]] and [[Garden|the garden]] about [[2026-10-17]] #project/home.

![[Garden]]

- [ ] Buy seeds
- [x] Dig beds

> [!tip] Water early
> Before the sun is high.

<details>
<summary>More</summary>

Hidden text.

</details>

**bold** *italic* ~~gone~~ ==bright== \`code\` and $x^2$.

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

$$
E = mc^2
$$

| Plant | Month |
| --- | --- |
| Tomato | May |

Capital of France :: Paris

<!-- toc -->

---

<div data-columns>
<div data-column>

Left.

</div>
<div data-column>

Right.

</div>
</div>`;

function types(doc: DocNode, found = new Set<string>()): Set<string> {
  found.add(doc.type);
  for (const mark of doc.marks ?? []) found.add(`mark:${mark.type}`);
  for (const child of doc.content ?? []) types(child, found);
  return found;
}

describe('the assistant rules', () => {
  it('describe markdown that morrow reads into its own blocks', () => {
    const doc = markdownToDoc(EXAMPLE, { resolvePage: (target) => (target === 'Garden' ? 'g' : null) });
    const seen = types(doc);
    for (const type of [
      'heading',
      'pageLink',
      'taskList',
      'callout',
      'details',
      'codeBlock',
      'blockMath',
      'inlineMath',
      'table',
      'tableOfContents',
      'horizontalRule',
      'columns',
      'mark:bold',
      'mark:italic',
      'mark:strike',
      'mark:highlight',
      'mark:code',
    ])
      expect(seen, type).toContain(type);
    const embed = JSON.stringify(doc).includes('"embed":true');
    expect(embed).toBe(true);
  });

  it('come back out the same when morrow saves the page', () => {
    const resolve = (target: string) => (target === 'Garden' ? 'g' : null);
    const once = docToMarkdown(markdownToDoc(EXAMPLE, { resolvePage: resolve }), {
      titleOf: (id) => (id === 'g' ? 'Garden' : null),
    });
    const twice = docToMarkdown(markdownToDoc(once, { resolvePage: resolve }), {
      titleOf: (id) => (id === 'g' ? 'Garden' : null),
    });
    expect(twice).toBe(once);
    expect(once).toContain('> [!tip] Water early');
    expect(once).toContain('Capital of France :: Paris');
  });

  it('carry the date so relative days make sense', () => {
    expect(assistantRules(new Date(2026, 9, 17))).toContain('(2026-10-17)');
  });
});
