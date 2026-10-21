import type { Mermaid } from 'mermaid';
import {
  Extension,
  InputRule,
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
  Node,
} from '@tiptap/core';
import type { Editor, NodeViewRenderer } from '@tiptap/core';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { common, createLowlight } from 'lowlight';
import { CALLOUT_TONES, calloutTone, COLORS } from '../../core/model';
import type { CalloutTone, ColorName } from '../../core/model';
import { tagColor } from '../../core/tags';
import { emojiElement } from '../components/Emoji';
import { openDialog } from '../ui';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      toggleHighlight: () => ReturnType;
      setHighlightColor: (color: ColorName | null) => ReturnType;
    };
    textColor: {
      setTextColor: (color: ColorName | null) => ReturnType;
    };
  }
}

const colorAttribute = (prefix: 'text' | 'bg') => ({
  color: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const value = element.getAttribute('data-color');
      return COLORS.includes(value as ColorName) ? value : null;
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.color
        ? { 'data-color': attributes.color, class: `${prefix}-${String(attributes.color)}` }
        : {},
  },
});

// ==text== in markdown, <mark> on the page, optionally in one of the nine colours
export const Highlight = Mark.create({
  name: 'highlight',
  addAttributes() {
    return colorAttribute('bg');
  },
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      toggleHighlight:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      setHighlightColor:
        (color) =>
        ({ commands }) =>
          color === null ? commands.unsetMark(this.name) : commands.setMark(this.name, { color }),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => this.editor.commands.toggleHighlight() };
  },
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(==(?!\s+==)((?:[^=]+))==(?!\s+==))$/, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /(?:^|\s)(==(?!\s+==)((?:[^=]+))==(?!\s+==))/g, type: this.type })];
  },
});

// coloured text, written as a span with a colour so other markdown apps show it too
export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return colorAttribute('text');
  },
  parseHTML() {
    return [{ tag: 'span[data-color]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          color === null ? commands.unsetMark(this.name) : commands.setMark(this.name, { color }),
    };
  },
});

function setAttrs(view: EditorView, getPos: () => number | undefined, attrs: Record<string, unknown>): void {
  const pos = getPos();
  if (pos === undefined) return;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }));
}

// markdown or html morrow does not edit as blocks, shown as written and saved exactly as it was
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { text: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'pre[data-raw-block]', getAttrs: (element) => ({ text: element.textContent ?? '' }) }];
  },
  renderHTML({ node }) {
    return ['pre', { 'data-raw-block': '' }, String(node.attrs.text ?? '')];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'raw-block';
      dom.contentEditable = 'false';
      const label = document.createElement('span');
      label.className = 'raw-block-label';
      label.textContent = t('editor.keptAsWritten');
      const pre = document.createElement('pre');
      pre.textContent = String(node.attrs.text ?? '');
      dom.append(label, pre);
      const edit = () => {
        if (!editor.isEditable) return;
        openDialog({
          kind: 'source',
          title: t('editor.editAsWritten'),
          value: String(current.attrs.text ?? ''),
          language: 'markdown',
          onSave: (text) => setAttrs(editor.view, getPos, { text }),
        });
      };
      dom.addEventListener('dblclick', edit);
      return {
        dom,
        update(updated) {
          if (updated.type !== current.type) return false;
          current = updated;
          pre.textContent = String(updated.attrs.text ?? '');
          return true;
        },
      };
    };
  },
});

// a formula left empty is removed
const editMath = (view: EditorView, node: PmNode, pos: number) => {
  const removeIfEmpty = () => {
    const current = view.state.doc.nodeAt(pos);
    if (current?.type === node.type && !String(current.attrs.latex ?? '').trim())
      view.dispatch(view.state.tr.delete(pos, pos + current.nodeSize));
  };
  openDialog({
    kind: 'math',
    value: String(node.attrs.latex ?? ''),
    block: node.type.name === 'blockMath',
    onCancel: () => {
      removeIfEmpty();
      view.focus();
    },
    onSave: (latex) => {
      const current = view.state.doc.nodeAt(pos);
      if (!current || current.type !== node.type) return;
      const { tr } = view.state;
      if (!latex.trim()) tr.delete(pos, pos + current.nodeSize);
      else tr.setNodeMarkup(pos, undefined, { ...current.attrs, latex });
      view.dispatch(tr);
      view.focus();
    },
  });
};

// opens the first formula found close to a position, used right after inserting one
export function editMathNear(editor: Editor, around: number): void {
  const { doc } = editor.state;
  let found: { node: PmNode; pos: number } | null = null;
  doc.nodesBetween(Math.max(0, around - 2), Math.min(doc.content.size, around + 4), (node, pos) => {
    if (!found && (node.type.name === 'blockMath' || node.type.name === 'inlineMath')) found = { node, pos };
    return !found;
  });
  const hit = found as { node: PmNode; pos: number } | null;
  if (hit) editMath(editor.view, hit.node, hit.pos);
}

// typing formulas: $inline$ as obsidian writes them, with prices like $5 and $10 staying text, and $$ to
// start one: on an empty line it is a formula of its own, inside a sentence an inline one. both open for typing
const InlineMathDollar = Extension.create({
  name: 'inlineMathDollar',
  addInputRules() {
    const editor = this.editor;
    const inline = editor.schema.nodes.inlineMath;
    const block = editor.schema.nodes.blockMath;
    if (!inline || !block) return [];
    const openSoon = (pos: number) => setTimeout(() => editMathNear(editor, pos));
    return [
      new InputRule({
        find: /(?<![\\$\w])\$([^\s$](?:[^$\n]*[^\s$])?)\$$/,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, inline.create({ latex: match[1] }));
        },
      }),
      new InputRule({
        find: /(?<!\$)\$\$$/,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const alone =
            $from.parent.type.name === 'paragraph' &&
            range.from === $from.start() &&
            range.to === $from.end();
          if (alone && $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), block)) {
            state.tr.replaceWith($from.before(), $from.after(), block.create({ latex: '' }));
            openSoon($from.before());
          } else {
            state.tr.replaceWith(range.from, range.to, inline.create({ latex: '' }));
            openSoon(range.from);
          }
        },
      }),
    ];
  },
});

export function mathExtensions() {
  return [
    InlineMath.configure({
      katexOptions: { throwOnError: false, strict: false },
      onClick: (node, pos) => {
        const view = currentView(node);
        if (view) editMath(view, node, pos);
      },
    }),
    BlockMath.configure({
      katexOptions: { throwOnError: false, displayMode: true, strict: false },
      onClick: (node, pos) => {
        const view = currentView(node);
        if (view) editMath(view, node, pos);
      },
    }),
    InlineMathDollar,
  ];
}

// the math click handler only gets the node, the editor that holds it is found through the dom
let activeView: EditorView | null = null;
const MathViewTracker = Extension.create({
  name: 'mathViewTracker',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('mathViewTracker'),
        view: (view) => {
          const track = () => (activeView = view);
          view.dom.addEventListener('mousedown', track, true);
          view.dom.addEventListener('focusin', track);
          return {
            destroy: () => {
              view.dom.removeEventListener('mousedown', track, true);
              view.dom.removeEventListener('focusin', track);
              if (activeView === view) activeView = null;
            },
          };
        },
      }),
    ];
  },
});
function currentView(_node: PmNode): EditorView | null {
  return activeView && !activeView.isDestroyed ? activeView : null;
}
export { MathViewTracker };

const lowlight = createLowlight(common);
export const CODE_LANGUAGES = [...lowlight.listLanguages(), 'mermaid'].sort();

// mermaid is large, it loads the first time a page has a diagram on it
let mermaidReady: Promise<Mermaid> | null = null;
let diagramCount = 0;
let diagramTheme: string | null = null;

function configureMermaid(mermaid: Mermaid): void {
  const dark = document.documentElement.dataset.theme === 'dark';
  // the base theme tinted with morrow's colours, so diagrams belong on the page
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: 'Inter Variable, system-ui, sans-serif',
    themeVariables: dark
      ? {
          background: '#191919',
          primaryColor: '#1d2b3f',
          primaryBorderColor: '#4c8df6',
          primaryTextColor: '#e8e8e8',
          secondaryColor: '#2a2140',
          tertiaryColor: '#202020',
          lineColor: '#8b9099',
          textColor: '#e8e8e8',
          fontSize: '14px',
        }
      : {
          background: '#ffffff',
          primaryColor: '#e9f2fe',
          primaryBorderColor: '#2f80ed',
          primaryTextColor: '#1f2328',
          secondaryColor: '#f1eafe',
          tertiaryColor: '#f7f7f5',
          lineColor: '#8a8f98',
          textColor: '#1f2328',
          fontSize: '14px',
        },
  });
}

// diagrams on screen draw themselves again when the theme changes
const redrawers = new Set<() => void>();
let themeWatcher: MutationObserver | null = null;
function onThemeChange(redraw: () => void): () => void {
  if (!themeWatcher) {
    themeWatcher = new MutationObserver(() => redrawers.forEach((fn) => fn()));
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  redrawers.add(redraw);
  return () => redrawers.delete(redraw);
}
export async function renderMermaid(source: string): Promise<{ html: string; error: boolean }> {
  if (!source.trim()) return { html: '', error: false };
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => mermaid);
  try {
    const mermaid = await mermaidReady;
    const theme = document.documentElement.dataset.theme ?? 'light';
    if (theme !== diagramTheme) {
      diagramTheme = theme;
      configureMermaid(mermaid);
    }
    const { svg } = await mermaid.render(`morrow-diagram-${++diagramCount}`, source);
    return { html: svg, error: false };
  } catch (error) {
    document.querySelectorAll('[id^="dmorrow-diagram-"]').forEach((element) => element.remove());
    return {
      html: t('editor.diagramMistake', {
        error: error instanceof Error ? (error.message.split('\n')[0] ?? '') : t('topBar.unknownError'),
      }),
      error: true,
    };
  }
}

// highlighted code, the language is picked from a list above each block
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'code-block';
      const select = document.createElement('select');
      select.className = 'code-language';
      select.contentEditable = 'false';
      select.setAttribute('aria-label', t('editor.codeLanguage'));
      const plain = document.createElement('option');
      plain.value = '';
      plain.textContent = t('editor.plainText');
      select.append(plain);
      for (const language of CODE_LANGUAGES) {
        const option = document.createElement('option');
        option.value = language;
        option.textContent = language;
        select.append(option);
      }
      const sync = () => {
        const language = String(current.attrs.language ?? '');
        if (
          language &&
          !CODE_LANGUAGES.includes(language) &&
          ![...select.options].some((o) => o.value === language)
        ) {
          const option = document.createElement('option');
          option.value = language;
          option.textContent = language;
          select.append(option);
        }
        select.value = language;
        select.disabled = !editor.isEditable;
      };
      sync();
      select.addEventListener('change', () =>
        setAttrs(editor.view, getPos, { language: select.value || null }),
      );
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      pre.append(code);
      // mermaid blocks draw their diagram underneath, the code folds away once there is one
      const diagram = document.createElement('div');
      diagram.className = 'mermaid-diagram';
      diagram.contentEditable = 'false';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'code-toggle';
      toggle.contentEditable = 'false';
      let showCode = current.textContent.trim() === '';
      let drawn = '';
      let timer: ReturnType<typeof setTimeout> | null = null;
      const isMermaid = () => current.attrs.language === 'mermaid';
      const layout = () => {
        const mermaid = isMermaid();
        dom.classList.toggle('is-mermaid', mermaid);
        dom.classList.toggle('hide-code', mermaid && !showCode);
        diagram.hidden = !mermaid;
        toggle.hidden = !mermaid;
        toggle.textContent = showCode ? 'Hide code' : 'Edit diagram';
      };
      const draw = () => {
        if (!isMermaid()) return;
        const source = current.textContent;
        if (source === drawn) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          drawn = source;
          void renderMermaid(source).then((result) => {
            if (drawn !== source) return;
            diagram.classList.toggle('is-error', result.error);
            if (result.error) diagram.textContent = result.html;
            else diagram.innerHTML = result.html;
          });
        }, 350);
      };
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        showCode = !showCode;
        layout();
      });
      diagram.addEventListener('dblclick', () => {
        showCode = true;
        layout();
      });
      // code and diagram share a row while editing a wide enough block, see blocks.css
      const split = document.createElement('div');
      split.className = 'code-split';
      split.append(pre, diagram);
      dom.append(select, toggle, split);
      layout();
      draw();
      const stopWatching = onThemeChange(() => {
        drawn = '';
        draw();
      });
      const ours = (target: EventTarget | globalThis.Node | null) =>
        select.contains(target as globalThis.Node) ||
        toggle.contains(target as globalThis.Node) ||
        diagram.contains(target as globalThis.Node);
      return {
        dom,
        contentDOM: code,
        update(updated) {
          if (updated.type !== current.type) return false;
          current = updated;
          sync();
          layout();
          draw();
          return true;
        },
        stopEvent: (event) => ours(event.target),
        // the toggle switches classes on the block itself, otherwise the editor redraws it and the code folds away again
        ignoreMutation: (mutation) =>
          ours(mutation.target) || (mutation.type === 'attributes' && mutation.target === dom),
        destroy: () => {
          if (timer) clearTimeout(timer);
          stopWatching();
        },
      };
    };
  },
}).configure({
  // a block with no language is plain text, never guessed at and coloured as something it is not
  lowlight: { ...lowlight, highlightAuto: (value: string) => lowlight.highlight('plaintext', value) },
  defaultLanguage: null,
  HTMLAttributes: { spellcheck: 'false' },
});

const TONE_LABELS: Record<CalloutTone, TranslationKey> = {
  note: 'editor.note',
  tip: 'editor.tip',
  warning: 'editor.warning',
  danger: 'editor.danger',
};

// the emoji each obsidian callout type is shown with
const KIND_EMOJI: Record<string, string> = {
  note: '📝',
  info: 'ℹ️',
  abstract: '📄',
  summary: '📄',
  tldr: '📄',
  todo: '☑️',
  tip: '💡',
  hint: '💡',
  important: '❗',
  success: '✅',
  check: '✅',
  done: '✅',
  question: '❓',
  help: '❓',
  faq: '❓',
  warning: '⚠️',
  caution: '⚠️',
  attention: '⚠️',
  failure: '❌',
  fail: '❌',
  missing: '❌',
  danger: '🔥',
  error: '🛑',
  bug: '🐞',
  example: '🧪',
  quote: '💬',
  cite: '💬',
};

// the emoji a callout shows: its own obsidian type's while that still matches the colour, else the colour's
function calloutEmoji(kind: string, tone: CalloutTone): string {
  const own = KIND_EMOJI[kind.toLowerCase()];
  return own && calloutTone(kind) === tone ? own : KIND_EMOJI[tone]!;
}

// callouts keep their obsidian type, an optional title and whether they start folded. the icon sits beside
// the text like notion's and changes the colour when clicked, the title row only shows when there is one
export function calloutNodeView(): NodeViewRenderer {
  return ({ node, getPos, editor }) => {
    let current = node;
    const dom = document.createElement('div');
    dom.className = 'callout';
    const icon = document.createElement('button');
    icon.type = 'button';
    icon.className = 'callout-icon';
    icon.contentEditable = 'false';
    const main = document.createElement('div');
    main.className = 'callout-main';
    const header = document.createElement('div');
    header.className = 'callout-header';
    header.contentEditable = 'false';
    const title = document.createElement('input');
    title.className = 'callout-title';
    title.placeholder = t('editor.addATitle');
    title.setAttribute('aria-label', t('editor.calloutTitle'));
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'callout-fold';
    header.append(title, fold);
    const body = document.createElement('div');
    body.className = 'callout-body';
    main.append(header, body);
    dom.append(icon, main);
    const sync = () => {
      const tone = (CALLOUT_TONES as readonly string[]).includes(String(current.attrs.tone))
        ? (current.attrs.tone as CalloutTone)
        : 'note';
      dom.dataset.tone = tone;
      icon.replaceChildren(emojiElement(calloutEmoji(String(current.attrs.kind ?? tone), tone)));
      icon.title = t('editor.clickToChange', { tone: t(TONE_LABELS[tone]) });
      icon.setAttribute('aria-label', icon.title);
      const text = String(current.attrs.title ?? '');
      if (document.activeElement !== title) title.value = text;
      title.readOnly = !editor.isEditable;
      const folded = current.attrs.fold === '-';
      dom.classList.toggle('is-folded', folded);
      fold.hidden = !current.attrs.fold;
      fold.setAttribute('aria-label', folded ? t('common.expand') : t('common.collapse'));
      fold.setAttribute('aria-expanded', String(!folded));
      // an empty title, rather than none, is one being added: its row shows until it is left empty
      header.hidden = current.attrs.title == null && !current.attrs.fold;
    };
    sync();
    icon.addEventListener('click', () => {
      if (!editor.isEditable) return;
      const tones = CALLOUT_TONES;
      const next = tones[(tones.indexOf(current.attrs.tone as CalloutTone) + 1) % tones.length]!;
      const kind = String(current.attrs.kind ?? '');
      // a custom obsidian type keeps its name while it already looks right
      setAttrs(editor.view, getPos, { tone: next, kind: kind && calloutTone(kind) === next ? kind : next });
    });
    title.addEventListener('change', () =>
      setAttrs(editor.view, getPos, { title: title.value.trim() || null }),
    );
    title.addEventListener('blur', () => {
      if (!title.value.trim() && current.attrs.title === '') setAttrs(editor.view, getPos, { title: null });
    });
    title.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        title.blur();
        editor.commands.focus();
      }
    });
    fold.addEventListener('click', () =>
      setAttrs(editor.view, getPos, { fold: current.attrs.fold === '-' ? '+' : '-' }),
    );
    return {
      dom,
      contentDOM: body,
      update(updated) {
        if (updated.type !== current.type) return false;
        current = updated;
        sync();
        return true;
      },
      stopEvent: (event) =>
        header.contains(event.target as globalThis.Node) || icon.contains(event.target as globalThis.Node),
      ignoreMutation: (mutation) =>
        header.contains(mutation.target as globalThis.Node) ||
        icon.contains(mutation.target as globalThis.Node),
    };
  };
}

const TAG_PATTERN = /(^|[\s(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
const tagKey = new PluginKey<DecorationSet>('tags');

function tagDecorations(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (parent?.type.name === 'codeBlock') return false;
    if (
      !node.isText ||
      !node.text ||
      node.marks.some((mark) => mark.type.name === 'code' || mark.type.name === 'link')
    )
      return true;
    for (const match of node.text.matchAll(TAG_PATTERN)) {
      const from = pos + match.index + match[1]!.length;
      const to = from + match[2]!.length + 1;
      decorations.push(
        Decoration.inline(from, to, { class: `tag-chip tag-${tagColor(match[2]!)}`, 'data-tag': match[2]! }),
      );
    }
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

// #tags written in text are shown as chips and open the tag's page when clicked with ctrl or cmd
export function Tags(open: (tag: string) => void) {
  return Extension.create({
    name: 'tags',
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: tagKey,
          state: {
            init: (_config, state) => tagDecorations(state.doc),
            apply: (tr, value) => (tr.docChanged ? tagDecorations(tr.doc) : value),
          },
          props: {
            decorations: (state) => tagKey.getState(state),
            handleClick: (view, _pos, event) => {
              const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.tag-chip');
              if (!target?.dataset.tag || (view.editable && !(event.ctrlKey || event.metaKey))) return false;
              event.preventDefault();
              open(target.dataset.tag);
              return true;
            },
          },
        }),
      ];
    },
  });
}
