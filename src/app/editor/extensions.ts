import { Extension, InputRule, wrappingInputRule } from '@tiptap/core';
import type { AnyExtension } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Code } from '@tiptap/extension-code';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { t } from '../i18n';
import { BlockHandle } from './BlockHandle';
import { BlockSelect } from './BlockSelect';
import { Callout, FindReplace } from './Blocks';
import { PasteMenu } from './PasteMenu';
import { ClickBelow } from './ClickBelow';
import { EmojiSuggest } from './EmojiSuggest';
import { CodeBlock, Highlight, mathExtensions, MathViewTracker, RawBlock, Tags, TextColor } from './Extras';
import { FileAttachment, FileDrop, Image } from './Media';
import type { BlockMenuRequest } from './BlockHandle';
import { MarkdownPaste, PasteOnEmptyLine } from './MarkdownPaste';
import { PageLink } from './PageLink';
import type { PageLinkOptions } from './PageLink';
import { SlashCommand } from './SlashCommand';
import { IndentedLines, KeepTab, lineContent, LineEdges } from './turnInto';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Column, Columns, DateMention, TableOfContents } from './Structure';

export interface ExtensionOptions extends PageLinkOptions {
  onBlockMenu: (request: BlockMenuRequest) => void;
  resolvePage: (title: string) => string | null;
  openTag: (tag: string) => void;
  createChild: (kind: 'database' | 'canvas') => string | null;
  openDate: (date: Date) => void;
  dateMenu?: (date: Date, anchor: HTMLElement, time: string | null) => void;
}

// obsidian block ids live on paragraphs and are written back as " ^id". pressing enter at the end of one
// never hands its id to the new paragraph
const BlockIds = Extension.create({
  name: 'blockIds',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockIdsPaste'),
        props: {
          transformPasted: (slice, view) => {
            const taken = new Set<string>();
            view.state.doc.descendants((node) => {
              if (typeof node.attrs.blockId === 'string' && node.attrs.blockId) taken.add(node.attrs.blockId);
            });
            if (!taken.size) return slice;
            const strip = (fragment: Fragment): Fragment => {
              const children: PMNode[] = [];
              fragment.forEach((child) => {
                const id = child.attrs.blockId;
                const attrs =
                  typeof id === 'string' && taken.has(id) ? { ...child.attrs, blockId: null } : child.attrs;
                children.push(
                  child.isText ? child : child.type.create(attrs, strip(child.content), child.marks),
                );
              });
              return Fragment.from(children);
            };
            return new Slice(strip(slice.content), slice.openStart, slice.openEnd);
          },
        },
      }),
    ];
  },
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            // a pasted copy of a block on the same page leaves its ^id behind, links go to the original
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attrs) => (attrs.blockId ? { 'data-block-id': attrs.blockId } : {}),
          },
        },
      },
    ];
  },
});

// a block's own background colour, from the colour in its Turn into menu
const BlockBackground = Extension.create({
  name: 'blockBackground',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'details'],
        attributes: {
          backgroundColor: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) => element.getAttribute('data-background'),
            renderHTML: (attrs) =>
              attrs.backgroundColor
                ? {
                    'data-background': attrs.backgroundColor,
                    class: `block-bg block-bg-${attrs.backgroundColor}`,
                  }
                : {},
          },
        },
      },
    ];
  },
});

// a toggle's title can be a heading, the way notion's toggle headings fold a whole section away. the level
// lives on the title, so opening and closing the toggle never touches it
const ToggleSummary = DetailsSummary.extend({
  addAttributes() {
    return {
      level: {
        default: null,
        parseHTML: (element) => {
          const level = Number(element.getAttribute('data-level'));
          return level >= 1 && level <= 6 ? level : null;
        },
        renderHTML: (attributes) => (attributes.level ? { 'data-level': String(attributes.level) } : {}),
      },
    };
  },
});

// typing " and a space starts a quote and > and a space starts a toggle, the way notion does
const Quote = Blockquote.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*["“]\s$/, type: this.type })];
  },
});

// a. and a space at the start of a line starts a list counted in letters
const LetteredShortcut = Extension.create({
  name: 'letteredShortcut',
  addInputRules() {
    const type = this.editor.schema.nodes.orderedList;
    return type ? [wrappingInputRule({ find: /^\s*a\.\s$/, type, getAttributes: { type: 'a' } })] : [];
  },
});

// > and a space at the start of a line turns that line into a toggle's title, a heading keeping its level,
// with an empty line inside to write in. # to ###### and a space at the start of a toggle's title make it a
// toggle heading
const ToggleShortcut = Extension.create({
  name: 'toggleShortcut',
  priority: 1000,
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*>\s$/,
        handler: ({ state, range, chain }) => {
          const $from = state.doc.resolve(range.from);
          const line = $from.parent;
          const { details, detailsSummary, detailsContent, paragraph } = state.schema.nodes;
          const start = $from.before();
          const parent = $from.node($from.depth - 1);
          const index = $from.index($from.depth - 1);
          const fits =
            details &&
            detailsSummary &&
            detailsContent &&
            paragraph &&
            (line.type.name === 'paragraph' || line.type.name === 'heading') &&
            parent.canReplaceWith(index, index + 1, details);
          if (!fits) {
            chain().deleteRange(range).setDetails().run();
            return;
          }
          const { tr } = state;
          tr.delete(range.from, range.to);
          const rest = tr.doc.nodeAt(start)!;
          const level = line.type.name === 'heading' ? (line.attrs.level as number) : null;
          const toggle = details.create({ open: true }, [
            detailsSummary.create(level ? { level } : null, lineContent(detailsSummary, rest)),
            detailsContent.create(null, paragraph.create()),
          ]);
          tr.replaceWith(start, start + rest.nodeSize, toggle);
          tr.setSelection(TextSelection.create(tr.doc, start + 2));
        },
      }),
      new InputRule({
        find: /^(#{1,6})\s$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== 'detailsSummary') return null;
          const { tr } = state;
          tr.delete(range.from, range.to);
          tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, level: match[1]!.length });
        },
      }),
    ];
  },
});

// inline code can be bold, italic, struck through or coloured like any other text, as it can in notion and
// in markdown. tiptap's own code shuts every other mark out
const InlineCode = Code.extend({ excludes: '' });

export function createExtensions(options: ExtensionOptions): AnyExtension[] {
  return [
    BlockIds,
    BlockBackground,
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto', 'file'],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
      },
      dropcursor: { color: 'var(--accent)', width: 2 },
      // no empty line is kept at the end of every page, ClickBelow adds one when the space under it is clicked
      trailingNode: false,
      codeBlock: false,
      code: false,
      blockquote: false,
    }),
    Quote,
    LetteredShortcut,
    ToggleShortcut,
    InlineCode,
    CodeBlock,
    Highlight,
    TextColor,
    RawBlock,
    ...mathExtensions(),
    MathViewTracker,
    Tags(options.openTag),
    TaskList,
    TaskItem.configure({ nested: true }),
    IndentedLines,
    LineEdges,
    KeepTab,
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({
      showOnlyCurrent: true,
      includeChildren: false,
      placeholder: ({ node, editor }) => {
        if (node.type.name === 'heading') return t('editor.headingPlaceholder', { level: node.attrs.level });
        if (node.type.name === 'detailsSummary')
          return node.attrs.level
            ? t('editor.headingPlaceholder', { level: node.attrs.level })
            : t('editor.toggleTitlePlaceholder');
        if (editor.isEmpty) return t('editor.placeholderEmpty');
        return t('editor.placeholder');
      },
    }),
    PageLink.configure({
      getTitle: options.getTitle,
      ...(options.getIcon ? { getIcon: options.getIcon } : {}),
      subscribe: options.subscribe,
      open: options.open,
      findPages: options.findPages,
      createPage: options.createPage,
      resolveTarget: options.resolveTarget,
      createFromTarget: options.createFromTarget,
      renderEmbed: options.renderEmbed,
      ...(options.mountEmbed ? { mountEmbed: options.mountEmbed } : {}),
    }),
    SlashCommand.configure({ createChild: options.createChild }),
    EmojiSuggest,
    Image,
    FileAttachment,
    FileDrop,
    Callout,
    Columns,
    Column,
    TableOfContents,
    DateMention.configure({
      openDate: options.openDate,
      findPages: options.findPages,
      ...(options.dateMenu ? { dateMenu: options.dateMenu } : {}),
    }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'toggle' } }),
    ToggleSummary,
    DetailsContent,
    FindReplace,
    PasteOnEmptyLine,
    PasteMenu,
    ClickBelow,
    BlockHandle.configure({ onMenu: options.onBlockMenu }),
    BlockSelect,
    MarkdownPaste.configure({ resolvePage: options.resolvePage }),
  ];
}
