import { mergeAttributes, Node } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { FilePlus2, FileText } from 'lucide-react';
import type { PageId } from '../../core/model';
import type { MenuItem } from './SuggestionMenu';
import { renderSuggestion } from './SuggestionMenu';

export interface PageLinkOptions {
  // live title or null when the page is missing or trashed
  getTitle: (id: PageId) => string | null;
  subscribe: (listener: () => void) => () => void;
  open: (id: PageId) => void;
  findPages: (query: string) => Array<{ id: PageId; title: string; path: string }>;
  createPage: (title: string) => PageId | null;
}

const CREATE_PREFIX = 'create:';

export const PageLink = Node.create<PageLinkOptions>({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      getTitle: () => null,
      subscribe: () => () => {},
      open: () => {},
      findPages: () => [],
      createPage: () => null,
    };
  },

  addAttributes() {
    return {
      id: { default: null, parseHTML: (element) => element.getAttribute('data-page-id') },
      label: { default: '', parseHTML: (element) => element.textContent ?? '' },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-page-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-page-id': node.attrs.id,
        href: `#/page/${node.attrs.id}`,
        class: 'page-link',
      }),
      String(node.attrs.label ?? ''),
    ];
  },

  renderText({ node }) {
    return String(node.attrs.label ?? '');
  },

  addNodeView() {
    return ({ node }) => {
      let current = node;
      const dom = document.createElement('a');
      dom.className = 'page-link';
      dom.contentEditable = 'false';
      const refresh = () => {
        const id = String(current.attrs.id ?? '');
        const title = this.options.getTitle(id);
        dom.textContent = title ?? String(current.attrs.label || 'Missing page');
        dom.href = `#/page/${id}`;
        dom.dataset.pageId = id;
        dom.classList.toggle('is-missing', title === null);
        dom.title = title === null ? 'This page was deleted or moved to the trash' : `Open ${title}`;
      };
      dom.addEventListener('click', (event) => {
        event.preventDefault();
        const id = String(current.attrs.id ?? '');
        if (this.options.getTitle(id) !== null) this.options.open(id);
      });
      refresh();
      const unsubscribe = this.options.subscribe(refresh);
      return {
        dom,
        update(updated) {
          if (updated.type !== current.type) return false;
          current = updated;
          refresh();
          return true;
        },
        destroy: unsubscribe,
      };
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      Suggestion<MenuItem, MenuItem>({
        editor: this.editor,
        pluginKey: new PluginKey('pageLinkSuggestion'),
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        allow: ({ state }) => state.selection.$from.parent.type.name !== 'codeBlock',
        items: ({ query }) => {
          const title = query.replace(/\]+$/, '').trim();
          const pages: MenuItem[] = options.findPages(title).map((page) => ({
            id: page.id,
            title: page.title,
            ...(page.path ? { description: page.path } : {}),
            icon: FileText,
          }));
          if (title && !pages.some((page) => page.title.toLowerCase() === title.toLowerCase())) {
            pages.push({ id: `${CREATE_PREFIX}${title}`, title: `New subpage “${title}”`, icon: FilePlus2 });
          }
          return pages;
        },
        command: ({ editor, range, props }) => {
          let id = props.id;
          let label = props.title;
          if (id.startsWith(CREATE_PREFIX)) {
            label = id.slice(CREATE_PREFIX.length);
            const created = options.createPage(label);
            if (!created) return;
            id = created;
          }
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'pageLink', attrs: { id, label } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: renderSuggestion('Link to page', 'No pages found'),
      }),
    ];
  },
});
