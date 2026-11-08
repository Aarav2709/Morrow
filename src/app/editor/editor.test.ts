// @vitest-environment happy-dom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { DocNode } from '../../core/model';
import { createExtensions } from './extensions';

const json = (target: Editor) => target.getJSON() as DocNode;

let editor: Editor | null = null;

function make(content: unknown): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createExtensions({
      onBlockMenu: () => {},
      resolvePage: () => null,
      openTag: () => {},
      createChild: () => null,
      openDate: () => {},
      pages: () => [],
      createPage: () => null,
      renderEmbed: () => {},
    } as never),
    content: content as never,
  });
  return editor;
}

// types text at the cursor the way a keyboard does, so input rules run
function type(target: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = target.state.selection;
    const handled = target.view.someProp('handleTextInput', (handler) =>
      handler(target.view, from, to, char, () => target.state.tr.insertText(char, from, to)),
    );
    if (!handled) target.view.dispatch(target.state.tr.insertText(char, from, to));
  }
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const p = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });

describe('the editor', () => {
  it('turns a line into a toggle titled with it when > is typed in front of it', () => {
    const target = make({ type: 'doc', content: [p('Shopping list')] });
    target.commands.setTextSelection(1);
    type(target, '> ');
    const toggle = json(target).content![0]!;
    expect(toggle.type).toBe('details');
    expect(toggle.content![0]!.type).toBe('detailsSummary');
    expect(toggle.content![0]!.content![0]!.text).toBe('Shopping list');
    const body = toggle.content![1]!.content!;
    expect(body).toHaveLength(1);
    expect(body[0]!.type).toBe('paragraph');
    expect(body[0]!.content ?? []).toEqual([]);
  });

  it('keeps a heading level when it becomes a toggle', () => {
    const target = make({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plans' }] }],
    });
    target.commands.setTextSelection(1);
    type(target, '> ');
    const summary = json(target).content![0]!.content![0]!;
    expect(summary.attrs?.level).toBe(2);
    expect(summary.content![0]!.text).toBe('Plans');
  });

  it('makes a toggle title a heading with #', () => {
    const target = make({ type: 'doc', content: [p('Notes')] });
    target.commands.setTextSelection(1);
    type(target, '> ');
    type(target, '### ');
    const summary = json(target).content![0]!.content![0]!;
    expect(summary.attrs?.level).toBe(3);
    expect(summary.content![0]!.text).toBe('Notes');
  });

  it('keeps no empty line at the end of a page', () => {
    const target = make({ type: 'doc', content: [p('One'), { type: 'horizontalRule' }] });
    expect(json(target).content!.map((node) => node.type)).toEqual(['paragraph', 'horizontalRule']);
  });
});
