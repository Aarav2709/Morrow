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
  // finds the page a written [[target]] means, for links made before the page existed
  resolveTarget: (target: string) => PageId | null;
  // makes the page a link points at, used when following a link to a page that does not exist yet
  createFromTarget: (target: string) => PageId | null;
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
      resolveTarget: () => null,
      createFromTarget: () => null,
    };
  },

  addAttributes() {
    const optional = (name: string) => ({
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`),
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes[name] ? { [`data-${name}`]: String(attributes[name]) } : {},
    });
    return {
      id: { default: null, parseHTML: (element) => element.getAttribute('data-page-id') },
      label: { default: '', parseHTML: (element) => element.textContent ?? '' },
      // the target as written, kept while the page does not exist
      target: optional('target'),
      anchor: optional('anchor'),
      alias: optional('alias'),
      embed: {
        default: null,
        parseHTML: (element) => (element.hasAttribute('data-embed') ? true : null),
        renderHTML: (attributes) => (attributes.embed ? { 'data-embed': '' } : {}),
      },
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
    return String(node.attrs.alias ?? node.attrs.label ?? '');
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('a');
      dom.className = 'page-link';
      dom.contentEditable = 'false';
      const target = () => (typeof current.attrs.target === 'string' ? current.attrs.target : '');
      const resolved = (): PageId | null => {
        const id = typeof current.attrs.id === 'string' ? current.attrs.id : null;
        if (id && this.options.getTitle(id) !== null) return id;
        return target() ? this.options.resolveTarget(target()) : null;
      };
      const refresh = () => {
        const id = resolved();
        const title = id ? this.options.getTitle(id) : null;
        const alias = typeof current.attrs.alias === 'string' ? current.attrs.alias : null;
        const anchor = typeof current.attrs.anchor === 'string' ? current.attrs.anchor : null;
        const name = title ?? String(current.attrs.label || target() || 'Missing page');
        dom.textContent = alias ?? (anchor ? `${name} › ${anchor}` : name);
        dom.href = id ? `#/page/${id}` : '#';
        dom.dataset.pageId = id ?? '';
        const unresolved = id === null && target() !== '';
        dom.classList.toggle('is-unresolved', unresolved);
        dom.classList.toggle('is-missing', id === null && !unresolved);
        dom.classList.toggle('is-embed', current.attrs.embed === true);
        dom.title = unresolved
          ? `“${target()}” does not exist yet, click to create it`
          : title === null
            ? 'This page was deleted or moved to the trash'
            : `Open ${title}`;
      };
      dom.addEventListener('click', (event) => {
        event.preventDefault();
        const id = resolved();
        if (id) {
          this.options.open(id);
          return;
        }
        if (!target()) return;
        const created = this.options.createFromTarget(target());
        if (!created) return;
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos !== undefined && editor.isEditable) {
          const live = editor.state.doc.nodeAt(pos);
          if (live?.type === current.type)
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...live.attrs, id: created, target: null }));
        }
        this.options.open(created);
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
