// the web in a page: a website shown live in a frame, a bookmark card with a link's title and description,
// and a mention, a link drawn as a small chip with the page's title
import { mergeAttributes, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { t } from '../i18n';
import { desktop, openExternal } from '../platform/desktop';

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export interface LinkPreview {
  title: string;
  description: string;
  site: string;
}

// what a link is about, read from the top of its page: its own title for sharing first, then the page's
// title, and the description it gives. without a connection, the site's name stands in
export async function linkPreview(url: string): Promise<LinkPreview> {
  const fallback = { title: hostOf(url), description: '', site: hostOf(url) };
  const html = await desktop?.fetchPageHead?.(url).catch(() => null);
  if (!html) return fallback;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (...names: string[]) => {
    for (const name of names) {
      const value = doc
        .querySelector(`meta[property="${name}"], meta[name="${name}"]`)
        ?.getAttribute('content')
        ?.trim();
      if (value) return value;
    }
    return '';
  };
  const title = meta('og:title', 'twitter:title') || doc.querySelector('title')?.textContent?.trim() || '';
  return {
    title: (title || fallback.title).replace(/\s+/g, ' ').slice(0, 200),
    description: meta('og:description', 'twitter:description', 'description')
      .replace(/\s+/g, ' ')
      .slice(0, 300),
    site: meta('og:site_name') || fallback.site,
  };
}

const globe =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

// a website shown in the page. it only loads when asked, opening a page never contacts anyone, and it runs
// walled off from morrow, unable to reach it or move it elsewhere
export const WebEmbed = Node.create({
  name: 'webEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: '' },
      height: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'iframe[src]',
        getAttrs: (element) => {
          const src = element.getAttribute('src') ?? '';
          if (!/^https:\/\//i.test(src)) return false;
          const height = Number(element.getAttribute('height'));
          return { src, height: Number.isFinite(height) && height > 0 ? height : null };
        },
      },
      {
        tag: 'div[data-web-embed]',
        getAttrs: (element) => ({ src: element.getAttribute('data-web-embed') }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-web-embed': node.attrs.src }),
      ['a', { href: node.attrs.src }, String(node.attrs.src)],
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'web-embed';
      dom.contentEditable = 'false';
      const bar = document.createElement('div');
      bar.className = 'web-embed-bar';
      const host = document.createElement('span');
      host.className = 'web-embed-host';
      host.innerHTML = globe;
      host.append(hostOf(String(node.attrs.src)));
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'link-button small';
      open.textContent = t('editor.web.openInBrowser');
      open.addEventListener('click', () => openExternal(String(current.attrs.src)));
      bar.append(host, open);
      const body = document.createElement('div');
      body.className = 'web-embed-body';
      const height = () => (typeof current.attrs.height === 'number' ? current.attrs.height : 420);
      body.style.height = `${height()}px`;
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'button small web-embed-load';
      load.textContent = t('editor.web.load');
      load.addEventListener('click', async (event) => {
        event.preventDefault();
        // the window lets the site load in the frame rather than sending it to the browser
        await desktop?.allowFrame?.(String(current.attrs.src)).catch(() => false);
        const frame = document.createElement('iframe');
        frame.src = String(current.attrs.src);
        frame.title = hostOf(String(current.attrs.src));
        // scripts and forms of its own, never the window it is in
        frame.setAttribute(
          'sandbox',
          'allow-scripts allow-same-origin allow-forms allow-popups allow-presentation',
        );
        frame.allow = 'fullscreen; clipboard-write; encrypted-media; picture-in-picture';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        body.replaceChildren(frame);
      });
      body.append(load);
      dom.append(bar, body);
      // dragged at its bottom edge to make it taller or shorter
      if (editor.isEditable) {
        const grip = document.createElement('div');
        grip.className = 'web-embed-grip';
        grip.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          const startY = event.clientY;
          const start = height();
          let next = start;
          // the frame would take the pointer while it passes over it
          body.style.pointerEvents = 'none';
          const move = (moved: PointerEvent) => {
            next = Math.round(Math.min(1600, Math.max(160, start + moved.clientY - startY)));
            body.style.height = `${next}px`;
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            body.style.pointerEvents = '';
            const pos = typeof getPos === 'function' ? getPos() : undefined;
            if (pos === undefined || next === start) return;
            editor.view.dispatch(
              editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, height: next }),
            );
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
        dom.append(grip);
      }
      return {
        dom,
        update: (updated) => {
          if (updated.type !== current.type || updated.attrs.src !== current.attrs.src) return false;
          current = updated;
          body.style.height = `${height()}px`;
          return true;
        },
        stopEvent: (event) =>
          event.target instanceof HTMLButtonElement ||
          (event.target as Element)?.closest?.('.web-embed-body') !== null,
        ignoreMutation: () => true,
      };
    };
  },
});

// a link as a card: the page's title, what it says about itself, and its site
export const Bookmark = Node.create({
  name: 'bookmark',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      href: { default: '' },
      title: { default: '' },
      description: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-bookmark]',
        getAttrs: (element) => ({
          href: element.getAttribute('data-bookmark'),
          title: element.querySelector('a')?.textContent ?? '',
          description: element.querySelector('p')?.textContent ?? '',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-bookmark': node.attrs.href }),
      ['a', { href: node.attrs.href }, String(node.attrs.title || node.attrs.href)],
      ['p', {}, String(node.attrs.description ?? '')],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('a');
      dom.className = 'bookmark-card';
      dom.contentEditable = 'false';
      dom.href = String(node.attrs.href);
      const text = document.createElement('span');
      text.className = 'bookmark-text';
      const title = document.createElement('span');
      title.className = 'bookmark-title';
      title.textContent = String(node.attrs.title || hostOf(String(node.attrs.href)));
      text.append(title);
      if (node.attrs.description) {
        const description = document.createElement('span');
        description.className = 'bookmark-description';
        description.textContent = String(node.attrs.description);
        text.append(description);
      }
      const site = document.createElement('span');
      site.className = 'bookmark-site';
      site.innerHTML = globe;
      site.append(String(node.attrs.href).replace(/^https?:\/\//, ''));
      text.append(site);
      dom.append(text);
      dom.addEventListener('click', (event) => {
        event.preventDefault();
        openExternal(String(node.attrs.href));
      });
      return { dom, ignoreMutation: () => true };
    };
  },
});

// a link drawn as a chip with the title of the page it goes to, among the words of a line
export const LinkMention = Node.create({
  name: 'linkMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      href: { default: '' },
      title: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-link-mention]',
        getAttrs: (element) => ({ href: element.getAttribute('href'), title: element.textContent ?? '' }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, { href: node.attrs.href, 'data-link-mention': '' }),
      String(node.attrs.title || node.attrs.href),
    ];
  },

  renderText({ node }) {
    return String(node.attrs.title || node.attrs.href);
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('a');
      dom.className = 'link-mention';
      dom.contentEditable = 'false';
      dom.href = String(node.attrs.href);
      dom.title = String(node.attrs.href);
      dom.innerHTML = globe;
      const label = document.createElement('span');
      label.textContent = String(node.attrs.title || hostOf(String(node.attrs.href)));
      dom.append(label);
      dom.addEventListener('click', (event) => {
        event.preventDefault();
        openExternal(String(node.attrs.href));
      });
      return { dom, ignoreMutation: () => true };
    };
  },
});

// a link pasted or typed in turned into a mention, a bookmark or a website shown in the page. the card
// shows the site's name at once and its own title once it has been read
export function insertLinkAs(
  editor: Editor,
  from: number,
  to: number,
  url: string,
  kind: 'mention' | 'bookmark' | 'embed',
): void {
  const chain = editor.chain().focus().deleteRange({ from, to });
  if (kind === 'embed') {
    chain.insertContentAt(from, { type: 'webEmbed', attrs: { src: url } }).run();
    return;
  }
  const placeholder = hostOf(url);
  chain
    .insertContentAt(
      from,
      kind === 'mention'
        ? { type: 'linkMention', attrs: { href: url, title: placeholder } }
        : { type: 'bookmark', attrs: { href: url, title: placeholder, description: '' } },
    )
    .run();
  void linkPreview(url).then((preview) => {
    if (editor.isDestroyed) return;
    const { tr } = editor.state;
    const type = kind === 'mention' ? 'linkMention' : 'bookmark';
    tr.doc.descendants((node, pos) => {
      if (node.type.name !== type || node.attrs.href !== url || node.attrs.title !== placeholder) return true;
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        title: preview.title,
        ...(kind === 'bookmark' ? { description: preview.description } : {}),
      });
      return false;
    });
    if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false));
  });
}
