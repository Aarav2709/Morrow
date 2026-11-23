// @vitest-environment happy-dom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { directionOf, hasRightToLeft, TextDirection } from './TextDirection';

let editor: Editor | null = null;

function make(content: unknown): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, TextDirection],
    content: content as never,
  });
  return editor;
}

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('text read from the right', () => {
  it('knows arabic and hebrew from latin letters', () => {
    expect(hasRightToLeft('مرحبا')).toBe(true);
    expect(hasRightToLeft('שלום')).toBe(true);
    expect(hasRightToLeft('Hello, 123')).toBe(false);
    // the first letter decides, numbers and marks before it do not
    expect(directionOf('12. مرحبا')).toBe('rtl');
    expect(directionOf('Hello مرحبا')).toBe('ltr');
  });

  it('lets only the blocks with arabic in them take their own direction', () => {
    const view = make({ type: 'doc', content: [paragraph('Hello'), paragraph('مرحبا بالعالم')] }).view;
    const blocks = view.dom.querySelectorAll('p');
    expect(blocks[0]!.getAttribute('dir')).toBeNull();
    expect(blocks[1]!.getAttribute('dir')).toBe('rtl');
  });

  it('gives a list its direction so its bullets sit on the right side', () => {
    const view = make({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph('عنصر')] }],
        },
      ],
    }).view;
    expect(view.dom.querySelector('ul')!.getAttribute('dir')).toBe('rtl');
    expect(view.dom.querySelector('li')!.getAttribute('dir')).toBe('rtl');
  });

  it('keeps english inside an arabic block reading from the left', () => {
    const view = make({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            paragraph('اقتباس'),
            { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('An English item')] }] },
          ],
        },
      ],
    }).view;
    expect(view.dom.querySelector('blockquote')!.getAttribute('dir')).toBe('rtl');
    expect(view.dom.querySelector('ul')!.getAttribute('dir')).toBe('ltr');
    expect(view.dom.querySelector('li p')!.getAttribute('dir')).toBe('ltr');
  });

  it('follows typing, and never stores the direction in the page', () => {
    const target = make({ type: 'doc', content: [paragraph('Hello'), { type: 'paragraph' }] });
    target.commands.setTextSelection(target.state.doc.content.size - 1);
    target.commands.insertContent('سلام');
    const [english, arabic] = target.view.dom.querySelectorAll('p');
    expect(english!.getAttribute('dir')).toBeNull();
    expect(arabic!.getAttribute('dir')).toBe('rtl');
    // an english line with an arabic word in it still starts on the left
    target.commands.setTextSelection(6);
    target.commands.insertContent(' سلام');
    expect(target.view.dom.querySelector('p')!.getAttribute('dir')).toBe('ltr');
    expect(JSON.stringify(target.getJSON())).not.toContain('dir');
  });
});
