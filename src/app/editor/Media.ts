import { Extension, mergeAttributes, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as ProseNode, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { FileMeta } from '../../core/model';
import { downloadFile, fileUrl, formatBytes, storeFiles } from '../platform/attachments';
import { desktop, nativeFileUrl } from '../platform/desktop';
import { activeRoute } from '../router';
import { selectedBlocks } from './BlockSelect';
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
      // the width the picture was dragged to, null to fit the page
      width: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('width')) || null,
        renderHTML: (attributes) => (attributes.width ? { width: String(attributes.width) } : {}),
      },
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
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('figure');
      dom.className = 'image-block is-loading';
      dom.contentEditable = 'false';
      const img = document.createElement('img');
      img.alt = String(node.attrs.alt ?? '');
      img.draggable = false;
      const frame = document.createElement('span');
      frame.className = 'image-frame';
      frame.appendChild(img);
      dom.appendChild(frame);
      const width = typeof node.attrs.width === 'number' ? node.attrs.width : null;
      if (width) img.style.width = `${width}px`;
      // the picture's sides drag to make it smaller or larger. it stays centred, so it grows both ways
      if (editor.isEditable)
        for (const side of ['left', 'right'] as const) {
          const handle = document.createElement('span');
          handle.className = `image-resize is-${side}`;
          handle.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const startX = event.clientX;
            const start = img.getBoundingClientRect().width;
            const most = dom.getBoundingClientRect().width;
            let next = start;
            const onMove = (move: PointerEvent) => {
              const delta = (move.clientX - startX) * (side === 'right' ? 2 : -2);
              next = Math.round(Math.min(most, Math.max(60, start + delta)));
              img.style.width = `${next}px`;
            };
            const onUp = () => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              const pos = getPos();
              if (typeof pos !== 'number' || next === start) return;
              // as wide as the page is the same as no width at all
              const value = next >= most - 2 ? null : next;
              editor.view.dispatch(
                editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: value }),
              );
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          });
          frame.appendChild(handle);
        }
      const src = typeof node.attrs.src === 'string' ? node.attrs.src : null;
      const video = src && !node.attrs.fileId ? youtubeId(src) : null;
      if (video) return { dom: youtubeEmbed(dom, video), stopEvent: () => true, ignoreMutation: () => true };
      const local = src && !node.attrs.fileId ? localMediaUrl(src) : null;
      if (local) {
        dom.classList.remove('is-loading');
        const kind = mediaKind(src!);
        if (kind === 'audio' || kind === 'video') {
          const player = document.createElement(kind);
          player.controls = true;
          player.preload = 'metadata';
          player.src = local;
          player.addEventListener('error', () => dom.classList.add('is-missing'));
          frame.replaceWith(player);
          return { dom, stopEvent: (event) => event.target === player, ignoreMutation: () => true };
        }
        img.src = local;
        img.addEventListener('error', () => {
          dom.classList.add('is-missing');
          dom.textContent = t('editor.imageNotFound', { src: src! });
        });
        return { dom };
      }
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

// a youtube video written as a picture, ![](https://www.youtube.com/watch?v=…), the way obsidian embeds one
const YOUTUBE =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;

export function youtubeId(src: string): string | null {
  return YOUTUBE.exec(src)?.[1] ?? null;
}

// like pictures from the web, the video only loads once asked, so opening a page never contacts anyone
function youtubeEmbed(dom: HTMLElement, id: string): HTMLElement {
  dom.className = 'image-block media-block media-youtube';
  dom.replaceChildren();
  const box = document.createElement('div');
  box.className = 'image-remote';
  const label = document.createElement('span');
  label.textContent = t('editor.videoFrom', { host: 'YouTube' });
  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'button small';
  play.textContent = t('editor.playVideo');
  play.addEventListener('click', (event) => {
    event.preventDefault();
    const player = document.createElement('iframe');
    player.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
    player.title = 'YouTube';
    player.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    player.allowFullscreen = true;
    player.referrerPolicy = 'strict-origin-when-cross-origin';
    dom.replaceChildren(player);
  });
  box.append(label, play);
  dom.append(box);
  return dom;
}

// a picture, sound or video elsewhere on the computer, shown from where it is: a file:// address, a full path
// or one relative to the page, like ../Videos/talk.mp4
function localMediaUrl(src: string): string | null {
  const value = src.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^file:/i.test(value) && !/^[a-z]:[\\/]/i.test(value))
    return null;
  let absolute: string;
  if (/^file:/i.test(value)) {
    try {
      absolute = decodeURIComponent(new URL(value).pathname);
    } catch {
      return null;
    }
  } else if (value.startsWith('/') || /^[a-z]:[\\/]/i.test(value)) absolute = value;
  else if (/^\.{1,2}[\\/]/.test(value)) {
    const session = getSession();
    const route = activeRoute();
    const page = route.name === 'page' ? session.pathOf(route.id) : null;
    if (!session.location) return null;
    absolute = `${session.location}/${page ? page.split('/').slice(0, -1).join('/') : ''}/${value}`;
  } else return null;
  const parts: string[] = [];
  for (const part of absolute.replace(/\\/g, '/').split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  // a windows drive keeps its colon, C:/Videos/talk.mp4
  const path = parts
    .map(encodeURIComponent)
    .join('/')
    .replace(/^([a-z])%3A/i, '$1:');
  return nativeFileUrl('local', path);
}

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

async function pictureSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size.width && size.height ? size : null;
  } catch {
    return null;
  }
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
    if (!file) continue;
    img.src = `data:${file.meta.type};base64,${bytesToBase64(file.data)}`;
    // a size in the html of its own, apps that read only the width drew the picture as a thin line
    const size = await pictureSize(new Blob([file.data], { type: file.meta.type }));
    if (size) {
      const width = Math.min(Number(img.getAttribute('width')) || size.width, size.width, 720);
      const height = Math.round((size.height * width) / size.width);
      img.setAttribute('width', String(width));
      img.setAttribute('height', String(height));
      img.style.width = `${width}px`;
      img.style.height = `${height}px`;
    }
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

// blocks picked in the margin are copied whole, pictures at either end included, which a text selection
// spread over them would leave out. pictures then go to other apps as part of the copied html
function copyBlocks(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const range = selectedBlocks(view.state);
  const slice = range ? view.state.doc.slice(range.from, range.to) : view.state.selection.content();
  if (!range && view.state.selection.empty) return false;
  if (range && event.clipboardData) {
    const { dom, text } = view.serializeForClipboard(slice);
    event.clipboardData.clearData();
    event.clipboardData.setData('text/html', dom.innerHTML);
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    if (cut) view.dispatch(view.state.tr.delete(range.from, range.to).scrollIntoView());
  }
  void copyWithImages(view, slice).catch(() => {});
  return range !== null;
}

// a picture or video copied in the file manager reaches the page on windows as its name alone. its name is
// held back while morrow asks the system for the file, and goes in as text if there is none
const MEDIA_NAME =
  /^[^\\/:*?"<>|\n]+\.(png|jpe?g|gif|webp|bmp|svg|avif|mp3|wav|ogg|m4a|flac|mp4|webm|mov|m4v|pdf)$/i;
function pasteCopiedFiles(editor: Editor, event: ClipboardEvent): boolean {
  const data = event.clipboardData;
  const text = data?.getData('text/plain').trim() ?? '';
  const names = text.split(/\r?\n/).filter(Boolean);
  if (!desktop?.clipboardFiles || data?.getData('text/html') || !names.length) return false;
  if (!names.every((name) => MEDIA_NAME.test(name))) return false;
  event.preventDefault();
  const at = editor.state.selection.from;
  void desktop
    .clipboardFiles()
    .catch(() => [])
    .then((copied) => {
      if (editor.isDestroyed) return;
      if (copied.length) void insertFiles(editor, copied, at);
      else editor.chain().focus().insertContent(text).run();
    });
  return true;
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
            copy: (view: EditorView, event: ClipboardEvent) => copyBlocks(view, event, false),
            cut: (view: EditorView, event: ClipboardEvent) => copyBlocks(view, event, true),
          },
          handlePaste(_view: EditorView, event: ClipboardEvent) {
            const files = filesFrom(event.clipboardData);
            if (files.length === 0) return pasteCopiedFiles(editor, event);
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
