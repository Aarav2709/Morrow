// pasting a link on its own puts the link in, then offers what else it could be: a youtube link can play in
// the page, a picture's address can show the picture, and a sound or video file on this computer can play
// where it is. typing anything, or escape, keeps the link
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { t } from '../i18n';
import { mediaKind, youtubeId } from './Media';

type PastedKind = 'youtube' | 'picture' | 'local' | 'link';

const PICTURE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?[^\s]*)?$/i;

export function pastedKind(text: string): PastedKind | null {
  if (!text || /\s/.test(text) || text.length > 2000) return null;
  if (/^https?:\/\//i.test(text)) {
    if (youtubeId(text)) return 'youtube';
    return PICTURE.test(text) ? 'picture' : 'link';
  }
  // a path on this computer: file://, /home/... or C:\...
  const local = /^(file:\/\/|\/|[a-z]:[\\/])/i.test(text);
  if (local && (mediaKind(text) === 'audio' || mediaKind(text) === 'video' || PICTURE.test(text)))
    return 'local';
  return null;
}

let closeOpen: (() => void) | null = null;

function showMenu(
  editor: Editor,
  view: EditorView,
  from: number,
  to: number,
  text: string,
  kind: PastedKind,
): void {
  closeOpen?.();
  const choices: Array<{ label: string; run: () => void }> = [];
  const asBlock = () => {
    editor
      .chain()
      .focus()
      .deleteRange({ from, to })
      .insertContentAt(from, { type: 'image', attrs: { src: text, alt: '' } })
      .run();
  };
  if (kind === 'youtube') choices.push({ label: t('editor.pasteEmbedVideo'), run: asBlock });
  if (kind === 'picture') choices.push({ label: t('editor.pasteShowPicture'), run: asBlock });
  if (kind === 'local') choices.push({ label: t('editor.pastePlayHere'), run: asBlock });
  if (choices.length === 0) return;
  choices.push({ label: t('editor.pasteKeepLink'), run: () => editor.commands.focus() });

  const menu = document.createElement('div');
  menu.className = 'menu popover floating-layer paste-menu';
  menu.setAttribute('role', 'menu');
  let active = 0;
  const buttons = choices.map((choice, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-item';
    button.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = choice.label;
    button.append(label);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      close();
      choice.run();
    });
    button.addEventListener('mouseenter', () => highlight(index));
    menu.append(button);
    return button;
  });
  const highlight = (index: number) => {
    active = (index + buttons.length) % buttons.length;
    buttons.forEach((button, i) => button.classList.toggle('is-active', i === active));
  };
  highlight(0);
  const end = view.coordsAtPos(to);
  menu.style.position = 'fixed';
  menu.style.left = `${Math.max(8, Math.min(end.left, window.innerWidth - 240))}px`;
  menu.style.top = `${Math.min(end.bottom + 6, window.innerHeight - 140)}px`;
  document.body.append(menu);

  // the cursor stays in the page, the arrow keys and enter choose while the menu is open
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      close();
      choices[active]!.run();
    } else close();
  };
  const onPointer = (event: PointerEvent) => {
    if (!menu.contains(event.target as Node)) close();
  };
  const close = () => {
    if (closeOpen !== close) return;
    closeOpen = null;
    menu.remove();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('scroll', close, true);
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('scroll', close, true);
  closeOpen = close;
}

export const PasteMenu = Extension.create({
  name: 'pasteMenu',
  priority: 200,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('pasteMenu'),
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
            const kind = pastedKind(text);
            const { selection } = view.state;
            // pasting a link over selected words links them, and code stays exactly as pasted
            if (!kind || !selection.empty || selection.$from.parent.type.spec.code) return false;
            event.preventDefault();
            const from = selection.from;
            const link = view.state.schema.marks.link;
            // a path on this computer goes in as plain text, a web address as a link to it
            const node = view.state.schema.text(
              text,
              link && kind !== 'local' ? [link.create({ href: text })] : [],
            );
            view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
            showMenu(editor, view, from, from + text.length, text, kind);
            return true;
          },
        },
      }),
    ];
  },
  onDestroy() {
    closeOpen?.();
  },
});
