// @vitest-environment happy-dom
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocNode } from '../../core/model';
import { selectBlockRange } from './BlockSelect';
import { changeCase, setBlockBackground, setHeading, turnInto } from './EditorMenus';
import { createExtensions } from './extensions';
import { tagDecorations } from './Extras';
import type { DecorationSet } from '@tiptap/pm/view';

// code blocks watch the vault's pages for bases, there is no vault open here
vi.mock('./bases', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  onPagesChange: () => () => {},
}));

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

  it('colours one item of a list on its own', () => {
    const item = (text: string) => ({ type: 'listItem', content: [p(text)] });
    const target = make({
      type: 'doc',
      content: [{ type: 'bulletList', content: [item('One'), item('Two')] }],
    });
    setBlockBackground(target, [1], 'red');
    const list = json(target).content![0]!;
    expect(list.attrs?.backgroundColor ?? null).toBeNull();
    expect(list.content![0]!.attrs?.backgroundColor).toBe('red');
    expect(list.content![1]!.attrs?.backgroundColor ?? null).toBeNull();
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
      target.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, ctrlKey, bubbles: true }));
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

describe('copying from inside a toggle', () => {
  it('pastes the copied line, not a new toggle around it', async () => {
    const { unwrapHolders } = await import('./MarkdownPaste');
    const target = make({
      type: 'doc',
      content: [
        p('Above'),
        {
          type: 'details',
          content: [
            { type: 'detailsSummary', content: [{ type: 'text', text: 'Title' }] },
            { type: 'detailsContent', content: [p('Inside one'), p('Inside two')] },
          ],
        },
      ],
    });
    let from = 0;
    let to = 0;
    target.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Inside one') from = pos;
      if (node.isText && node.text === 'Inside two') to = pos + node.nodeSize;
    });
    const slice = unwrapHolders(target.state.doc.slice(from, to));
    expect(slice.content.firstChild!.type.name).toBe('paragraph');
    target.commands.setTextSelection(3);
    target.view.dispatch(target.state.tr.replaceSelection(slice));
    expect(json(target).content!.filter((node) => node.type === 'details')).toHaveLength(1);
  });
});

describe('turning a line into a toggle', () => {
  it('folds the blocks under it into the toggle, stopping at the next heading of any level', () => {
    const heading = (level: number, text: string) => ({
      type: 'heading',
      attrs: { level },
      content: [{ type: 'text', text }],
    });
    const target = make({
      type: 'doc',
      content: [
        heading(2, 'Plans'),
        p('One'),
        heading(3, 'Detail'),
        p('Two'),
        heading(2, 'Next'),
        p('Three'),
      ],
    });
    turnInto(target, 0, { kind: 'toggle', level: 2 });
    const doc = json(target);
    expect(doc.content!.map((node) => node.type)).toEqual([
      'details',
      'heading',
      'paragraph',
      'heading',
      'paragraph',
    ]);
    const inside = doc.content![0]!.content![1]!.content!.map((node) => node.type);
    expect(inside).toEqual(['paragraph']);
    expect(doc.content![0]!.attrs?.open).toBe(false);
  });
});

describe('turning several blocks at once', () => {
  it('turns every selected item of a list into a checklist', async () => {
    const { selectedTextBlocks } = await import('./BlockHandle');
    const { turnBlocks } = await import('./EditorMenus');
    const item = (text: string) => ({ type: 'listItem', content: [p(text)] });
    const target = make({
      type: 'doc',
      content: [{ type: 'bulletList', content: [item('One'), item('Two'), item('Three')] }],
    });
    target.commands.setTextSelection({ from: 3, to: target.state.doc.content.size - 3 });
    const range = selectedTextBlocks(target.state)!;
    expect(range).not.toBeNull();
    turnBlocks(target, range, { kind: 'taskList' });
    const doc = json(target);
    expect(doc.content!.map((node) => node.type)).toEqual(['taskList']);
    expect(doc.content![0]!.content).toHaveLength(3);
  });
});

describe('turning several lines at once', () => {
  it('makes one list of them', async () => {
    const { selectedTextBlocks } = await import('./BlockHandle');
    const { turnBlocks } = await import('./EditorMenus');
    const target = make({ type: 'doc', content: [p('One'), p('Two'), p('Three')] });
    target.commands.setTextSelection({ from: 2, to: target.state.doc.content.size - 2 });
    turnBlocks(target, selectedTextBlocks(target.state)!, { kind: 'bulletList' });
    const doc = json(target);
    expect(doc.content!.map((node) => node.type)).toEqual(['bulletList']);
    expect(doc.content![0]!.content).toHaveLength(3);
  });
});

describe('blocks inside columns', () => {
  it('turn on their own, inside a toggle in a column too', () => {
    const item = (text: string) => ({ type: 'listItem', content: [p(text)] });
    const target = make({
      type: 'doc',
      content: [
        {
          type: 'columns',
          content: [
            {
              type: 'column',
              content: [
                {
                  type: 'details',
                  attrs: { open: true },
                  content: [
                    { type: 'detailsSummary', content: [{ type: 'text', text: 'Title' }] },
                    {
                      type: 'detailsContent',
                      content: [{ type: 'bulletList', content: [item('Buy milk')] }],
                    },
                  ],
                },
              ],
            },
            { type: 'column', content: [p('Right')] },
          ],
        },
      ],
    });
    let at = 0;
    target.state.doc.descendants((node, pos) => {
      if (node.type.name === 'listItem') at = pos;
    });
    turnInto(target, at, { kind: 'taskList' });
    const toggle = json(target).content![0]!.content![0]!.content![0]!;
    expect(toggle.type).toBe('details');
    expect(toggle.content![1]!.content![0]!.type).toBe('taskList');
  });
});

describe('dragging a block by its handle', () => {
  it('moves the block to where the pointer lets go', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const target = new Editor({
      element: host,
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
      content: { type: 'doc', content: [p('One'), p('Two'), p('Three')] } as never,
    });
    editor = target;
    // the page has no layout here, every block sits at the top, so the pointer is over the first
    target.view.dom.parentElement!.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 0, clientY: 0, bubbles: true }),
    );
    const end = target.state.doc.content.size;
    target.view.posAtCoords = () => ({ pos: end, inside: -1 });
    const handle = host.querySelector<HTMLElement>('.block-handle')!;
    handle.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }),
    );
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 40, bubbles: true }));
    expect(document.querySelector('.block-drag-ghost')?.textContent).toBe('One');
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 40, clientY: 40, bubbles: true }));
    expect(json(target).content!.map((node) => node.content![0]!.text)).toEqual(['Two', 'Three', 'One']);
    expect(document.querySelector('.block-drag-ghost')).toBeNull();
    host.remove();
  });
});

describe('pasting words and pictures from another app', () => {
  it('keeps a picture word or libreoffice put on the clipboard as a file', async () => {
    const { DOMParser: PmParser } = await import('@tiptap/pm/model');
    const target = make({ type: 'doc', content: [p('')] });
    const html = new window.DOMParser().parseFromString(
      '<p>Before</p><img src="file:///C:/Users/me/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png"><p>After</p>',
      'text/html',
    );
    const doc = PmParser.fromSchema(target.schema).parse(html.body);
    const types: string[] = [];
    doc.forEach((node) => types.push(node.type.name));
    expect(types).toEqual(['paragraph', 'image', 'paragraph']);
    expect(String(doc.child(1).attrs.src)).toMatch(/^file:\/\/\//);
  });
});

describe('picking words in several places', () => {
  it('copies every piece kept with ctrl, in page order', async () => {
    const { allPieces, keepPiece, piecesForClipboard } = await import('./MultiSelect');
    const target = make({ type: 'doc', content: [p('Alpha beta'), p('Gamma delta'), p('Epsilon')] });
    // "beta" picked first, then "Epsilon" with ctrl held
    target.view.dispatch(keepPiece(target.state.tr, { from: 7, to: 11 }, target.state));
    const end = target.state.doc.content.size - 1;
    target.commands.setTextSelection({ from: end - 7, to: end });
    const pieces = allPieces(target.state);
    expect(pieces).toHaveLength(2);
    expect(piecesForClipboard(target.view, pieces).text).toBe('beta\nEpsilon');
    // an edit lets the kept pieces go
    target.commands.insertContent('!');
    expect(allPieces(target.state)).toHaveLength(0);
  });
});

describe('columns', () => {
  it('move a column to another place among the others', async () => {
    const { moveColumn } = await import('./ColumnGrip');
    const column = (text: string) => ({ type: 'column', content: [p(text)] });
    const target = make({
      type: 'doc',
      content: [{ type: 'columns', content: [column('A'), column('B'), column('C')] }],
    });
    // a position inside the first column
    moveColumn(target.state, target.view.dispatch, 2, 2);
    const texts = json(target).content![0]!.content!.map((item) => item.content![0]!.content![0]!.text);
    expect(texts).toEqual(['B', 'C', 'A']);
  });
});

describe('html blocks', () => {
  it('draw their page in a frame that runs no scripts once the preview is on', async () => {
    const code = (preview: boolean | null) => ({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'html', preview },
          content: [{ type: 'text', text: '<b>Hi</b><script>parent.hacked = 1</script>' }],
        },
      ],
    });
    const plain = make(code(null));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(plain.view.dom.querySelector('iframe')).toBeNull();
    plain.destroy();
    const target = make(code(true));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const frame = target.view.dom.querySelector('iframe')!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame.srcdoc).toContain('<b>Hi</b>');
    expect(target.view.dom.querySelector('.code-block')!.classList.contains('hide-code')).toBe(true);
    // turning it off brings the code back and takes the frame away
    target.view.dispatch(target.state.tr.setNodeMarkup(0, undefined, { language: 'html', preview: null }));
    expect(target.view.dom.querySelector('.code-block')!.classList.contains('hide-code')).toBe(false);
    expect(target.view.dom.querySelector('iframe')).toBeNull();
  });
});
