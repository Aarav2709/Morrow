import { Extension, mergeAttributes, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as ProseNode, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { FileMeta } from '../../core/model';
import { downloadFile, fileUrl, formatBytes, storeFiles } from '../platform/attachments';
import { desktop } from '../platform/desktop';
import { getSession } from '../workspace';
import { t } from '../i18n';

export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      fileId: { default: null, parseHTML: (element) => element.getAttribute('data-file-id') },
      // an image on the web or at a path morrow could not find, kept as written
      src: { default: null, parseHTML: (element) => element.getAttribute('data-src') },
      alt: { default: '', parseHTML: (element) => element.getAttribute('alt') ?? '' },
    };
  },

  parseHTML() {
    return [
      { tag: 'img[data-file-id]' },
      { tag: 'img[data-src]' },
      // a picture pasted from the web or another app, such as notion, saved into the vault once it lands
      {
        tag: 'img[src]',
        getAttrs: (element) => {
          const src = element.getAttribute('src') ?? '';
          return PASTED_IMAGE.test(src) ? { src, alt: element.getAttribute('alt') ?? '' } : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-file-id': node.attrs.fileId,
        'data-src': node.attrs.src,
        alt: node.attrs.alt,
      }),
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('figure');
      dom.className = 'image-block is-loading';
      dom.contentEditable = 'false';
      const img = document.createElement('img');
      img.alt = String(node.attrs.alt ?? '');
      img.draggable = false;
      dom.appendChild(img);
      const src = typeof node.attrs.src === 'string' ? node.attrs.src : null;
      if (!node.attrs.fileId && src) {
        // pictures from the web are only fetched when asked, opening a page never contacts anyone
        dom.classList.remove('is-loading');
        const remote = /^https:\/\//i.test(src);
        const box = document.createElement('div');
        box.className = 'image-remote';
        const label = document.createElement('span');
        label.textContent = remote
          ? t('editor.imageFrom', { host: safeHost(src) })
          : t('editor.imageNotFound', { src });
        box.append(label);
        if (remote) {
          const load = document.createElement('button');
          load.type = 'button';
          load.className = 'button small';
          load.textContent = t('editor.loadImage');
          load.addEventListener('click', (event) => {
            event.preventDefault();
            img.src = src;
            box.remove();
          });
          box.append(load);
        }
        dom.prepend(box);
        return { dom };
      }
      img.addEventListener('error', () => {
        dom.classList.add('is-missing');
        dom.textContent = t('editor.imageMissing');
      });
      void fileUrl(String(node.attrs.fileId ?? '')).then((url) => {
        dom.classList.remove('is-loading');
        if (url) img.src = url;
        else {
          dom.classList.add('is-missing');
          dom.textContent = t('editor.imageMissing');
        }
      });
      return { dom };
    };
  },
});

export const FileAttachment = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      fileId: { default: null, parseHTML: (element) => element.getAttribute('data-file-id') },
      name: { default: 'file', parseHTML: (element) => element.textContent ?? 'file' },
      size: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file-attachment]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-file-attachment': '', 'data-file-id': node.attrs.fileId }),
      String(node.attrs.name ?? 'file'),
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'file-block';
      dom.contentEditable = 'false';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = String(node.attrs.name ?? 'file');
      const meta = document.createElement('span');
      meta.className = 'file-meta';
      meta.textContent = typeof node.attrs.size === 'number' ? formatBytes(node.attrs.size) : '';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'file-save';
      save.textContent = t('editor.saveACopy');
      save.addEventListener('click', (event) => {
        event.preventDefault();
        void downloadFile(String(node.attrs.fileId ?? ''));
      });
      dom.append(name, meta, save);
      // sound, video and pdfs play right on the page
      const kind = mediaKind(String(node.attrs.name ?? ''));
      if (!kind) return { dom };
      const shell = document.createElement('div');
      shell.className = `media-block media-${kind}`;
      shell.contentEditable = 'false';
      const player =
        kind === 'pdf'
          ? document.createElement('iframe')
          : document.createElement(kind === 'audio' ? 'audio' : 'video');
      if (player instanceof HTMLMediaElement) {
        player.controls = true;
        player.preload = 'metadata';
      } else {
        player.title = String(node.attrs.name ?? 'PDF');
      }
      dom.classList.add('is-compact');
      shell.append(player, dom);
      void fileUrl(String(node.attrs.fileId ?? '')).then((url) => {
        if (url) player.src = url;
        else shell.classList.add('is-missing');
      });
      return {
        dom: shell,
        stopEvent: (event) => event.target === player,
        ignoreMutation: () => true,
      };
    };
  },
});

export function mediaKind(name: string): 'audio' | 'video' | 'pdf' | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'].includes(extension)) return 'audio';
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(extension)) return 'video';
  if (extension === 'pdf') return 'pdf';
  return null;
}

function safeHost(src: string): string {
  try {
    return new URL(src).host;
  } catch {
    return 'the web';
  }
}

export function mediaNodes(files: FileMeta[]) {
  return files.map((file) =>
    file.type.startsWith('image/')
      ? { type: 'image', attrs: { fileId: file.id, alt: file.name.replace(/\.[^.]+$/, '') } }
      : { type: 'fileAttachment', attrs: { fileId: file.id, name: file.name, size: file.size } },
  );
}

// stores the files first and only then inserts blocks that point at them
export async function insertFiles(editor: Editor, files: File[], at?: number): Promise<void> {
  const stored = await storeFiles(files);
  if (stored.length === 0 || editor.isDestroyed) return;
  const position = at ?? editor.state.selection.to;
  // the empty line after the media takes the cursor, so typing never replaces the new block
  editor
    .chain()
    .focus()
    .insertContentAt(Math.min(position, editor.state.doc.content.size), [
      ...mediaNodes(stored),
      { type: 'paragraph' },
    ])
    .run();
}

function filesFrom(data: DataTransfer | null): File[] {
  return data ? Array.from(data.files) : [];
}

const PASTED_IMAGE = /^(https?:\/\/|data:image\/)/i;

// the bytes of a picture pasted by its address, or held in the address itself
async function pastedImage(src: string): Promise<File | null> {
  try {
    const inline = /^data:(image\/[\w.+-]+);base64,(.*)$/is.exec(src);
    if (inline) {
      const binary = atob(inline[2]!.replace(/\s+/g, ''));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const type = inline[1]!.toLowerCase();
      return new File([bytes], `image.${type.split('/')[1]!.replace('svg+xml', 'svg')}`, { type });
    }
    if (src.startsWith('data:')) return null;
    const fetched = desktop?.fetchImage ? await desktop.fetchImage(src) : null;
    if (!fetched) return null;
    const name = decodeURIComponent(new URL(src).pathname.split('/').pop() ?? '') || 'image';
    return new File([fetched.data], name, { type: fetched.type });
  } catch {
    return null;
  }
}

// pictures that came in by address are saved into the vault and pointed at there. one that cannot be
// fetched stays as a link to the web, with its button to load it
async function adoptPastedImages(editor: Editor, sources: string[]): Promise<void> {
  for (const src of sources) {
    const file = await pastedImage(src);
    const stored = file ? await storeFiles([file]) : [];
    if (!stored[0] || editor.isDestroyed) continue;
    const { tr } = editor.state;
    tr.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && !node.attrs.fileId && node.attrs.src === src)
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, fileId: stored[0]!.id, src: null });
    });
    if (tr.docChanged) editor.view.dispatch(tr);
  }
  // a picture that stayed as a data address would fill the page's markdown with it
  if (editor.isDestroyed) return;
  const { tr } = editor.state;
  tr.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && !node.attrs.fileId && String(node.attrs.src ?? '').startsWith('data:'))
      tr.delete(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize));
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

function pastedSources(slice: Slice): string[] {
  const sources = new Set<string>();
  slice.content.descendants((node) => {
    if (node.type.name === 'image' && !node.attrs.fileId && PASTED_IMAGE.test(String(node.attrs.src ?? '')))
      sources.add(String(node.attrs.src));
  });
  return [...sources];
}

function bytesToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// the browser copies pictures as references only morrow understands. once the copy is done the clipboard is
// written again with the pictures inside it, so pasting into another app brings them along with the words
async function copyWithImages(view: EditorView, slice: Slice): Promise<void> {
  const images: ProseNode[] = [];
  slice.content.descendants((node) => {
    if (node.type.name === 'image' && node.attrs.fileId) images.push(node);
  });
  const lone = slice.content.childCount === 1 && slice.content.firstChild?.type.name === 'image';
  if (images.length === 0 || lone) return;
  // the same html and text the browser was given, so pasting back into morrow still works as before
  const { dom: container, text } = view.serializeForClipboard(slice);
  for (const img of container.querySelectorAll<HTMLImageElement>('img[data-file-id]')) {
    const file = await getSession().getFile(img.dataset.fileId ?? '');
    if (file) img.src = `data:${file.meta.type};base64,${bytesToBase64(file.data)}`;
  }
  if (desktop?.copyRich) await desktop.copyRich(text, container.innerHTML);
  else
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([container.innerHTML], { type: 'text/html' }),
      }),
    ]);
}

export const FileDrop = Extension.create({
  name: 'fileDrop',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('fileDrop'),
        props: {
          // pictures in what was pasted are saved once the paste is in
          transformPasted(slice: Slice) {
            const sources = pastedSources(slice);
            if (sources.length) setTimeout(() => void adoptPastedImages(editor, sources), 0);
            return slice;
          },
          handleDOMEvents: {
            copy: (view: EditorView) => {
              if (!view.state.selection.empty)
                void copyWithImages(view, view.state.selection.content()).catch(() => {});
              return false;
            },
            cut: (view: EditorView) => {
              if (!view.state.selection.empty)
                void copyWithImages(view, view.state.selection.content()).catch(() => {});
              return false;
            },
          },
          handlePaste(_view: EditorView, event: ClipboardEvent) {
            const files = filesFrom(event.clipboardData);
            if (files.length === 0) return false;
            // words and pictures copied together come as html, files alongside it are only copies of the pictures
            const html = event.clipboardData?.getData('text/html') ?? '';
            if (html && new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim())
              return false;
            event.preventDefault();
            void insertFiles(editor, files);
            return true;
          },
          handleDrop(view: EditorView, event: DragEvent, _slice, moved: boolean) {
            const files = filesFrom(event.dataTransfer);
            if (moved || files.length === 0) return false;
            event.preventDefault();
            const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            void insertFiles(editor, files, position);
            return true;
          },
        },
      }),
    ];
  },
});
