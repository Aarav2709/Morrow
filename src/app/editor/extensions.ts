import { Extension } from '@tiptap/core';
import type { AnyExtension } from '@tiptap/core';
import { Code } from '@tiptap/extension-code';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { t } from '../i18n';
import { BlockHandle } from './BlockHandle';
import { Callout, FindReplace } from './Blocks';
import { CodeBlock, Highlight, mathExtensions, MathViewTracker, RawBlock, Tags, TextColor } from './Extras';
import { FileAttachment, FileDrop, Image } from './Media';
import type { BlockMenuRequest } from './BlockHandle';
import { MarkdownPaste } from './MarkdownPaste';
import { PageLink } from './PageLink';
import type { PageLinkOptions } from './PageLink';
import { SlashCommand } from './SlashCommand';
import { Column, Columns, DateMention, TableOfContents } from './Structure';

export interface ExtensionOptions extends PageLinkOptions {
  onBlockMenu: (request: BlockMenuRequest) => void;
  resolvePage: (title: string) => string | null;
  openTag: (tag: string) => void;
  createChild: (kind: 'database' | 'canvas') => string | null;
  openDate: (date: Date) => void;
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
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
      },
      dropcursor: { color: 'var(--accent)', width: 2 },
      codeBlock: false,
      code: false,
    }),
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
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({
      showOnlyCurrent: true,
      includeChildren: false,
      placeholder: ({ node, editor }) => {
        if (node.type.name === 'heading') return t('editor.headingPlaceholder', { level: node.attrs.level });
        if (node.type.name === 'detailsSummary') return t('editor.toggleTitlePlaceholder');
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
    Image,
    FileAttachment,
    FileDrop,
    Callout,
    Columns,
    Column,
    TableOfContents,
    DateMention.configure({ openDate: options.openDate, findPages: options.findPages }),
    Details.configure({ persist: true, HTMLAttributes: { class: 'toggle' } }),
    DetailsSummary,
    DetailsContent,
    FindReplace,
    BlockHandle.configure({ onMenu: options.onBlockMenu }),
    MarkdownPaste.configure({ resolvePage: options.resolvePage }),
  ];
}
