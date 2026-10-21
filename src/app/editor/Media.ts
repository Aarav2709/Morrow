import { Extension, mergeAttributes, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { FileMeta } from '../../core/model';
import { downloadFile, fileUrl, formatBytes, storeFiles } from '../platform/attachments';
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
    return [{ tag: 'img[data-file-id]' }, { tag: 'img[data-src]' }];
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

export const FileDrop = Extension.create({
  name: 'fileDrop',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('fileDrop'),
        props: {
          handlePaste(_view: EditorView, event: ClipboardEvent) {
            const files = filesFrom(event.clipboardData);
            if (files.length === 0) return false;
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
