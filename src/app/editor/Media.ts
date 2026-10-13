import { Extension, mergeAttributes, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { FileMeta } from '../../core/model';
import { downloadFile, fileUrl, formatBytes, storeFiles } from '../platform/attachments';

export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      fileId: { default: null, parseHTML: (element) => element.getAttribute('data-file-id') },
      alt: { default: '', parseHTML: (element) => element.getAttribute('alt') ?? '' },
    };
  },

  parseHTML() {
    return [{ tag: 'img[data-file-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'img',
      mergeAttributes(HTMLAttributes, { 'data-file-id': node.attrs.fileId, alt: node.attrs.alt }),
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
      void fileUrl(String(node.attrs.fileId ?? '')).then((url) => {
        dom.classList.remove('is-loading');
        if (url) img.src = url;
        else {
          dom.classList.add('is-missing');
          dom.textContent = 'This image is missing from your workspace.';
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
      save.textContent = 'Save a copy';
      save.addEventListener('click', (event) => {
        event.preventDefault();
        void downloadFile(String(node.attrs.fileId ?? ''));
      });
      dom.append(name, meta, save);
      return { dom };
    };
  },
});

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
