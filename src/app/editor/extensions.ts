import type { AnyExtension } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { BlockHandle } from './BlockHandle';
import type { BlockMenuRequest } from './BlockHandle';
import { MarkdownPaste } from './MarkdownPaste';
import { PageLink } from './PageLink';
import type { PageLinkOptions } from './PageLink';
import { SlashCommand } from './SlashCommand';

export interface ExtensionOptions extends PageLinkOptions {
  onBlockMenu: (request: BlockMenuRequest) => void;
  resolvePage: (title: string) => string | null;
}

export function createExtensions(options: ExtensionOptions): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
      },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
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
        if (node.type.name === 'heading') return `Heading ${node.attrs.level}`;
        if (editor.isEmpty) return 'Start writing, or press / for blocks';
        return 'Press / for blocks';
      },
    }),
    PageLink.configure({
      getTitle: options.getTitle,
      subscribe: options.subscribe,
      open: options.open,
      findPages: options.findPages,
      createPage: options.createPage,
    }),
    SlashCommand,
    BlockHandle.configure({ onMenu: options.onBlockMenu }),
    MarkdownPaste.configure({ resolvePage: options.resolvePage }),
  ];
}
