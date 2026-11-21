import { describe, expect, it } from 'vitest';
import { docToDocx } from './docx';
import { markdownToDoc } from './markdown/parse';

describe('word documents', () => {
  it('are written with the page as word paragraphs, lists starting from their own number', () => {
    const doc = markdownToDoc(
      '## Plan\n\nSome **bold** & [a link](https://example.org).\n\n3. three\n4. four\n',
    );
    const files = docToDocx(doc, { title: 'Plan & more', picture: () => null, titleOf: () => null });
    const body = String(files['word/document.xml']);
    expect(body).toContain('<w:pStyle w:val="Title"/>');
    expect(body).toContain('Plan &amp; more');
    expect(body).toContain('<w:pStyle w:val="Heading2"/>');
    expect(body).toContain('<w:b/>');
    expect(String(files['word/_rels/document.xml.rels'])).toContain('Target="https://example.org"');
    expect(String(files['word/numbering.xml'])).toContain('<w:startOverride w:val="3"/>');
    expect(Object.keys(files)).toContain('[Content_Types].xml');
  });
});
