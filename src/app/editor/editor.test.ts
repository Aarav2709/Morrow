// @vitest-environment happy-dom
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it } from 'vitest';
import type { DocNode } from '../../core/model';
import { selectBlockRange } from './BlockSelect';
import { changeCase, setBlockBackground, setHeading, turnInto } from './EditorMenus';
import { createExtensions } from './extensions';
import { tagDecorations } from './Extras';
import type { DecorationSet } from '@tiptap/pm/view';

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
      findPages: () => [],
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

  it('changes the case of words in a table cell', () => {
    const cell = (type: string, text: string) => ({ type, content: [p(text)] });
    const target = make({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('tableHeader', 'Name'), cell('tableHeader', 'Note')] },
            { type: 'tableRow', content: [cell('tableCell', 'ada'), cell('tableCell', 'quiet')] },
          ],
        },
      ],
    });
    let start = 0;
    target.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'quiet') start = pos;
    });
    target.commands.setTextSelection({ from: start, to: start + 5 });
    changeCase(target, (text) => text.toUpperCase());
    expect(target.getText()).toContain('QUIET');
    // dragging across cells picks whole cells
    const cells: number[] = [];
    target.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
    });
    target.view.dispatch(
      target.state.tr.setSelection(CellSelection.create(target.state.doc, cells[0]!, cells[1]!)),
    );
    changeCase(target, (text) => text.toLowerCase());
    expect(target.getText()).toContain('quiet');
    expect(target.getText()).toContain('ada');
  });

  it('changes the case of every cell picked, not only the first', () => {
    const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] });
    const target = make({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('one'), cell('two')] },
            { type: 'tableRow', content: [cell('three'), cell('four')] },
          ],
        },
      ],
    });
    const cells: number[] = [];
    target.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos);
    });
    target.view.dispatch(
      target.state.tr.setSelection(CellSelection.create(target.state.doc, cells[0]!, cells[3]!)),
    );
    changeCase(target, (text) => text.toUpperCase());
    expect(target.getText()).toMatch(/ONE.*TWO.*THREE.*FOUR/s);
  });

  it('makes a toggle heading from the toolbar inside a toggle title', () => {
    const target = make({ type: 'doc', content: [p('Plans')] });
    target.commands.setTextSelection(1);
    type(target, '> ');
    target.commands.setTextSelection({ from: 2, to: 7 });
    setHeading(target, 2);
    expect(json(target).content![0]!.content![0]!.attrs?.level).toBe(2);
    setHeading(target, 2);
    expect(json(target).content![0]!.content![0]!.attrs?.level ?? null).toBeNull();
  });

  it('copies pictures with the words when blocks are picked in the margin', () => {
    const target = make({
      type: 'doc',
      content: [p('Before'), { type: 'image', attrs: { src: 'https://example.org/cat.png', alt: 'cat' } }],
    });
    selectBlockRange(target.view, { from: 0, to: target.state.doc.content.size });
    const data = new DataTransfer();
    const event = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
    target.view.dom.dispatchEvent(event);
    expect(data.getData('text/plain')).toContain('Before');
    expect(data.getData('text/html')).toContain('cat.png');
  });

  it('keeps tag chips right while typing, updating only what changed', () => {
    const target = make({ type: 'doc', content: [p('Plan #garden and #home'), p('nothing'), p('#a #b')] });
    const shown = (set: DecorationSet) =>
      set
        .find()
        .map((item) => `${item.from}-${item.to}`)
        .sort()
        .join(' ');
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let step = 0; step < 400; step++) {
      const size = target.state.doc.content.size;
      const at = 1 + random(Math.max(1, size - 1));
      const action = random(6);
      target.commands.setTextSelection(Math.min(at, size - 1));
      if (action < 3) type(target, ['#', 'a', ' ', 'x', '#t'][random(5)]!);
      else if (action === 3)
        target.commands.deleteRange({ from: Math.max(1, at - 2), to: Math.min(at, size - 1) });
      else if (action === 4) target.commands.splitBlock();
      else target.commands.joinBackward();
      const plugin = target.state.plugins.find((item) =>
        (item as unknown as { key: string }).key.startsWith('tags'),
      );
      const live = (plugin ?? { getState: () => null }).getState(target.state) as DecorationSet | null;
      expect(live && shown(live)).toBe(shown(tagDecorations(target.state.doc)));
    }
  });
});

describe('turn into', () => {
  it('puts a line in the first of several columns', () => {
    const target = make({ type: 'doc', content: [p('Left'), p('After')] });
    turnInto(target, 0, { kind: 'columns', count: 4 });
    const columns = json(target).content![0]!;
    expect(columns.type).toBe('columns');
    expect(columns.content).toHaveLength(4);
    expect(columns.content![0]!.content![0]!.content![0]!.text).toBe('Left');
    expect(json(target).content![1]!.content![0]!.text).toBe('After');
  });

  it('makes a lettered list and a callout', () => {
    const target = make({ type: 'doc', content: [p('First'), p('Second')] });
    turnInto(target, 0, { kind: 'letteredList' });
    const list = json(target).content![0]!;
    expect(list.type).toBe('orderedList');
    expect(list.attrs?.type).toBe('a');
    const second = target.state.doc.child(0).nodeSize;
    turnInto(target, second, { kind: 'callout' });
    expect(json(target).content![1]!.type).toBe('callout');
  });

  it('colours the whole block rather than its words', () => {
    const target = make({ type: 'doc', content: [p('Shaded')] });
    setBlockBackground(target, [0], 'green');
    const line = json(target).content![0]!;
    expect(line.attrs?.backgroundColor).toBe('green');
    expect(line.content![0]!.marks).toBeUndefined();
    setBlockBackground(target, [0], null);
    expect(json(target).content![0]!.attrs?.backgroundColor ?? null).toBeNull();
  });

  it('starts a lettered list from a. and a space', () => {
    const target = make({ type: 'doc', content: [p('')] });
    target.commands.setTextSelection(1);
    type(target, 'a. ');
    expect(json(target).content![0]!.attrs?.type).toBe('a');
  });
});

describe('nested lists', () => {
  const item = (text: string, ...nested: unknown[]) => ({ type: 'listItem', content: [p(text), ...nested] });
  const list = (...items: unknown[]) => ({ type: 'bulletList', content: items });
  const press = (target: Editor, key: string) => {
    const event = new KeyboardEvent('keydown', { key });
    target.view.someProp('handleKeyDown', (handler) => handler(target.view, event));
  };
  const endOf = (target: Editor, text: string) => {
    let at = 0;
    target.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === text) at = pos + node.nodeSize;
    });
    return at;
  };

  // the json without the attributes that are all empty, to compare the shape
  const shape = (node: DocNode): unknown => ({
    type: node.type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.content?.length ? { content: node.content.map(shape) } : {}),
  });
  const plain = (doc: unknown) => shape(doc as DocNode);

  it('indents the new line, not the item under it, when tab is pressed between them', () => {
    const target = make({ type: 'doc', content: [list(item('One', list(item('Two'))))] });
    target.commands.setTextSelection(endOf(target, 'One'));
    press(target, 'Enter');
    press(target, 'Tab');
    expect(shape(json(target))).toEqual(
      plain({ type: 'doc', content: [list(item('One', list(item(''), item('Two'))))] }),
    );
    // the cursor stays on the line that moved
    expect(target.state.selection.$from.parent.content.size).toBe(0);
    expect(target.state.selection.$from.depth).toBe(5);
  });

  it('takes the new line away again with backspace or delete, keeping the item under it', () => {
    for (const key of ['Backspace', 'Delete']) {
      const target = make({ type: 'doc', content: [list(item('One', list(item('Two'))))] });
      target.commands.setTextSelection(endOf(target, 'One'));
      press(target, 'Enter');
      press(target, key);
      expect(shape(json(target))).toEqual(
        plain({ type: 'doc', content: [list(item('One', list(item('Two'))))] }),
      );
      target.destroy();
    }
  });
});

describe('home and end', () => {
  it('move to the start and end of the line, and shift selects', () => {
    const target = make({ type: 'doc', content: [p('Hello world'), p('Next')] });
    target.commands.setTextSelection(4);
    const press = (key: string, shiftKey = false, ctrlKey = false) =>
      target.view.someProp('handleKeyDown', (handler) =>
        handler(target.view, new KeyboardEvent('keydown', { key, shiftKey, ctrlKey })),
      );
    press('End');
    expect(target.state.selection.head).toBe(12);
    press('Home', true);
    expect(target.state.selection.from).toBe(1);
    expect(target.state.selection.to).toBe(12);
    press('End', false, true);
    expect(target.state.selection.head).toBe(target.state.doc.content.size - 1);
  });
});

describe('the / and @ menus', () => {
  const active = (target: Editor, name: string) => {
    const plugin = target.state.plugins.find((entry) =>
      (entry as unknown as { key: string }).key.startsWith(name),
    );
    return Boolean((plugin?.getState(target.state) as { active?: boolean } | undefined)?.active);
  };

  it('stay away after a space or words that match nothing', () => {
    for (const [char, key] of [
      ['/', 'slashCommand'],
      ['@', 'dateMentionSuggestion'],
    ] as const) {
      const target = make({ type: 'doc', content: [p('')] });
      target.commands.setTextSelection(1);
      type(target, `${char}to`);
      expect(active(target, key)).toBe(true);
      type(target, 'qqzz');
      expect(active(target, key)).toBe(false);
      target.commands.setContent({ type: 'doc', content: [p('')] });
      target.commands.setTextSelection(1);
      type(target, `a ${char} b`);
      expect(active(target, key)).toBe(false);
      // coming back to it later doesn't open it either
      target.commands.setTextSelection(6);
      expect(active(target, key)).toBe(false);
      target.destroy();
    }
  });
});

describe('dates with a time', () => {
  it('reads a time typed after a date', async () => {
    const { typedTime } = await import('./Structure');
    expect(typedTime('today 17:05')).toEqual({ rest: 'today', time: '17:05' });
    expect(typedTime('friday 5pm')).toEqual({ rest: 'friday', time: '17:00' });
    expect(typedTime('next 5')).toBeNull();
    expect(typedTime('today 25:00')).toBeNull();
  });
});

describe('finding words in a folded toggle', () => {
  it('opens the toggle to show the match', async () => {
    const { setFindQuery } = await import('./Blocks');
    const target = make({
      type: 'doc',
      content: [
        {
          type: 'details',
          attrs: { open: false },
          content: [
            { type: 'detailsSummary', content: [{ type: 'text', text: 'Title' }] },
            { type: 'detailsContent', content: [p('hidden treasure')] },
          ],
        },
      ],
    });
    setFindQuery(target.state, target.view.dispatch, 'treasure');
    expect(json(target).content![0]!.attrs?.open).toBe(true);
  });
});

describe('pasting a list', () => {
  it('fills the empty line it is pasted on rather than going under it', () => {
    const item = (text: string) => ({ type: 'listItem', content: [p(text)] });
    const target = make({
      type: 'doc',
      content: [p('Above'), p(''), p('Below'), { type: 'bulletList', content: [item('One'), item('Two')] }],
    });
    const list = target.state.doc.child(3);
    const at =
      target.state.doc.child(0).nodeSize +
      target.state.doc.child(1).nodeSize +
      target.state.doc.child(2).nodeSize;
    // copied from inside the list, the way selecting its items and copying gives it
    const slice = target.state.doc.slice(at + 2, at + list.nodeSize - 2);
    target.commands.setTextSelection(target.state.doc.child(0).nodeSize + 1);
    const handled = target.view.someProp('handlePaste', (handler) =>
      handler(target.view, new Event('paste') as ClipboardEvent, slice),
    );
    if (!handled) target.view.dispatch(target.state.tr.replaceSelection(slice));
    const types = json(target).content!.map((node) => node.type);
    expect(types.slice(0, 3)).toEqual(['paragraph', 'bulletList', 'paragraph']);
    expect(json(target).content![1]!.content![0]!.content![0]!.content![0]!.text).toBe('One');
  });
});
