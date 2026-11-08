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
import { EmojiSuggest } from './EmojiSuggest';
import { CodeBlock, Highlight, mathExtensions, MathViewTracker, RawBlock, Tags, TextColor } from './Extras';
import { FileAttachment, FileDrop, Image } from './Media';
import type { BlockMenuRequest } from './BlockHandle';
import { MarkdownPaste } from './MarkdownPaste';
import { PageLink } from './PageLink';
import type { PageLinkOptions } from './PageLink';
import { SlashCommand } from './SlashCommand';
import { IndentedLines, KeepTab } from './turnInto';
import { Column, Columns, DateMention, TableOfContents } from './Structure';

export interface ExtensionOptions extends PageLinkOptions {
  onBlockMenu: (request: BlockMenuRequest) => void;
  resolvePage: (title: string) => string | null;
  openTag: (tag: string) => void;
  createChild: (kind: 'database' | 'canvas') => string | null;
  openDate: (date: Date) => void;
  dateMenu?: (date: Date, anchor: HTMLElement) => void;
}

// obsidian block ids live on paragraphs and are written back as " ^id". pressing enter at the end of one
// never hands its id to the new paragraph
const BlockIds = Extension.create({
  name: 'blockIds',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attrs) => (attrs.blockId ? { 'data-block-id': attrs.blockId } : {}),
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

const ToggleShortcut = Extension.create({
  name: 'toggleShortcut',
  addInputRules() {
    return [
      new InputRule({
        find: /^\s*>\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).setDetails().run();
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
      codeBlock: false,
      code: false,
      blockquote: false,
    }),
    Quote,
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
    PasteMenu,
    BlockHandle.configure({ onMenu: options.onBlockMenu }),
    BlockSelect,
    MarkdownPaste.configure({ resolvePage: options.resolvePage }),
  ];
}
