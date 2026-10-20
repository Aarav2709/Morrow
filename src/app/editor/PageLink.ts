import { InputRule, mergeAttributes, Node } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { FilePlus2, FileText } from 'lucide-react';
import { parseWikiLink } from '../../core/markdown/parse';
import type { WikiLink } from '../../core/markdown/parse';
import type { PageId } from '../../core/model';
import { emojiElement } from '../components/Emoji';
import type { MenuItem } from './SuggestionMenu';
import { renderSuggestion } from './SuggestionMenu';
import { t } from '../i18n';

export interface PageLinkOptions {
  // live title or null when the page is missing or trashed
  getTitle: (id: PageId) => string | null;
  // the linked page's emoji, shown in front of its name like notion does
  getIcon?: (id: PageId) => string | null;
  subscribe: (listener: () => void) => () => void;
  // the anchor is what follows # in the link: a heading, or ^id for a single block
  open: (id: PageId, anchor: string | null) => void;
  findPages: (query: string) => Array<{ id: PageId; title: string; path: string }>;
  createPage: (title: string) => PageId | null;
  // finds the page a written [[target]] means, for links made before the page existed
  resolveTarget: (target: string) => PageId | null;
  // makes the page a link points at, used when following a link to a page that does not exist yet
  createFromTarget: (target: string) => PageId | null;
  // an embedded page shows the other page's content as html, read only
  renderEmbed: (id: PageId, anchor: string | null) => string | null;
  // some pages, like databases, embed as a live view instead, the result removes it again
  mountEmbed?: (id: PageId, element: HTMLElement, editable: boolean) => (() => void) | null;
}

const CREATE_PREFIX = 'create:';

// a suggestion carries the heading or block and the shown text written after the page name
type LinkItem = MenuItem & { label?: string; anchor?: string | null; alias?: string | null };

// the attributes for a link as written, the same ones a page read from markdown gets
function linkAttrs(link: WikiLink, id: PageId | null, title: string | null): Record<string, unknown> {
  const label = link.alias ?? title ?? (link.target.split('/').pop() || link.target);
  const attrs: Record<string, unknown> = id ? { id, label } : { id: null, label, target: link.target };
  if (link.anchor) attrs.anchor = link.anchor;
  if (link.alias) attrs.alias = link.alias;
  if (link.embed) attrs.embed = true;
  return attrs;
}

// pages dragged out of the sidebar carry their id under this type
export const PAGE_DRAG_TYPE = 'application/x-morrow-page';

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
      renderEmbed: () => null,
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
      // ![[embeds]] show the other page below the link, kept up to date as it changes
      const embedded = node.attrs.embed === true;
      const wrapper = embedded ? document.createElement('span') : null;
      const body = embedded ? document.createElement('span') : null;
      let lastHtml: string | null = null;
      let mounted: { id: PageId; unmount: () => void } | null = null;
      if (wrapper && body) {
        wrapper.className = 'page-embed';
        wrapper.contentEditable = 'false';
        body.className = 'page-embed-body';
        wrapper.append(dom, body);
      }
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
        const icon = id ? (this.options.getIcon?.(id) ?? null) : null;
        if (icon) {
          const image = emojiElement(icon);
          image.classList.add('page-link-icon');
          dom.prepend(image);
        }
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
        if (body && mounted && mounted.id !== id) {
          mounted.unmount();
          mounted = null;
          body.replaceChildren();
        }
        // a part of a page embeds as that part only, a whole database or canvas as the live thing
        if (body && id && !mounted && !anchor && this.options.mountEmbed) {
          const unmount = this.options.mountEmbed(id, body, editor.isEditable);
          if (unmount) {
            mounted = { id, unmount };
            lastHtml = null;
            body.hidden = false;
            wrapper?.classList.add('is-live');
          }
        }
        if (body && !mounted) {
          wrapper?.classList.remove('is-live');
          const html = id ? this.options.renderEmbed(id, anchor) : null;
          if (html !== lastHtml) {
            lastHtml = html;
            body.innerHTML = html ?? '';
            body.hidden = !html;
          }
        }
      };
      dom.addEventListener('click', (event) => {
        event.preventDefault();
        const id = resolved();
        if (id) {
          this.options.open(id, typeof current.attrs.anchor === 'string' ? current.attrs.anchor : null);
          return;
        }
        if (!target()) return;
        const created = this.options.createFromTarget(target());
        if (!created) return;
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos !== undefined && editor.isEditable) {
          const live = editor.state.doc.nodeAt(pos);
          if (live?.type === current.type)
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(pos, undefined, { ...live.attrs, id: created, target: null }),
            );
        }
        this.options.open(created, null);
      });
      refresh();
      const unsubscribe = this.options.subscribe(refresh);
      return {
        dom: wrapper ?? dom,
        update(updated) {
          // switching between a link and an embed needs a different view
          if (updated.type !== current.type || (updated.attrs.embed === true) !== embedded) return false;
          current = updated;
          refresh();
          return true;
        },
        // a live embed handles its own clicks and typing, the editor leaves it alone
        stopEvent: (event) => !!mounted && !!body?.contains(event.target as globalThis.Node),
        ignoreMutation: () => true,
        destroy: () => {
          unsubscribe();
          mounted?.unmount();
        },
      };
    };
  },

  // typing the closing ]] turns [[Page#heading|shown text]] into a link straight away. a page that doesn't
  // exist yet stays a link to it, created when clicked, and a date with no page of its own is a date
  addInputRules() {
    const options = this.options;
    const dateType = this.editor.schema.nodes.dateMention;
    return [
      new InputRule({
        find: /(!?)\[\[([^[\]\n]+)\]\]$/,
        handler: ({ state, range, match }) => {
          const link = parseWikiLink(match[2]!, match[1] === '!');
          if (!link.target) return null;
          const id = options.resolveTarget(link.target);
          if (
            !id &&
            dateType &&
            !link.embed &&
            !link.anchor &&
            !link.alias &&
            /^\d{4}-\d{2}-\d{2}$/.test(link.target)
          ) {
            state.tr.replaceWith(range.from, range.to, dateType.create({ date: link.target }));
            return;
          }
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create(linkAttrs(link, id, id ? options.getTitle(id) : null)),
          );
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const editor = this.editor;
    return [
      // a page dropped from the sidebar becomes a link to it, not a copy of its title
      new Plugin({
        key: new PluginKey('pageLinkDrop'),
        props: {
          handleDrop(view, event) {
            const id = event.dataTransfer?.getData(PAGE_DRAG_TYPE);
            if (!id || !view.editable) return false;
            const label = options.getTitle(id);
            const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            if (label === null || position === undefined) return false;
            event.preventDefault();
            // dropped right after a word, the link gets a space so the two do not run together
            const before = position > 0 ? view.state.doc.textBetween(position - 1, position, '\n', '\n') : '';
            editor
              .chain()
              .focus()
              .insertContentAt(position, [
                ...(before && !/\s/.test(before) ? [{ type: 'text', text: ' ' }] : []),
                { type: 'pageLink', attrs: { id, label } },
                { type: 'text', text: ' ' },
              ])
              .run();
            return true;
          },
        },
      }),
      Suggestion<LinkItem, LinkItem>({
        editor: this.editor,
        pluginKey: new PluginKey('pageLinkSuggestion'),
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        allow: ({ state }) => state.selection.$from.parent.type.name !== 'codeBlock',
        items: ({ query }) => {
          // only the page name is searched, a #heading or |shown text after it goes along with the choice
          const link = parseWikiLink(query.replace(/\]+$/, ''), false);
          const title = link.target;
          const extra = { anchor: link.anchor, alias: link.alias };
          const pages: LinkItem[] = options.findPages(title).map((page) => ({
            id: page.id,
            title: link.anchor ? `${page.title} › ${link.anchor}` : page.title,
            label: page.title,
            ...extra,
            ...(page.path ? { description: page.path } : {}),
            icon: FileText,
          }));
          if (title && !pages.some((page) => page.label?.toLowerCase() === title.toLowerCase())) {
            pages.push({
              id: `${CREATE_PREFIX}${title}`,
              title: t('editor.newSubpage', { title }),
              label: title,
              ...extra,
              icon: FilePlus2,
            });
          }
          return pages;
        },
        command: ({ editor, range, props }) => {
          let id = props.id;
          let label = props.label ?? props.title;
          if (id.startsWith(CREATE_PREFIX)) {
            label = id.slice(CREATE_PREFIX.length);
            const created = options.createPage(label);
            if (!created) return;
            id = created;
          }
          // typing ![[ embeds the page instead of linking it
          const before = range.from > 1 ? editor.state.doc.textBetween(range.from - 1, range.from) : '';
          const embed = before === '!';
          const from = embed ? range.from - 1 : range.from;
          editor
            .chain()
            .focus()
            .insertContentAt({ from, to: range.to }, [
              {
                type: 'pageLink',
                attrs: {
                  id,
                  label: props.alias ?? label,
                  ...(props.anchor ? { anchor: props.anchor } : {}),
                  ...(props.alias ? { alias: props.alias } : {}),
                  ...(embed ? { embed: true } : {}),
                },
              },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: renderSuggestion(
          () => t('editor.linkToPage'),
          () => t('editor.noPagesFound'),
          'link',
        ),
      }),
    ];
  },
});
