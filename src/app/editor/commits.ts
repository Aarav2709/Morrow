import type { Editor } from '@tiptap/core';
import { isMac } from '../platform/desktop';
import { stepProperties } from '../workspace';

// open editors register here so exports and shutdown can save the latest keystrokes first
const pending = new Set<() => void>();
let focused: Editor | null = null;

export function registerCommit(commit: () => void): () => void {
  pending.add(commit);
  return () => pending.delete(commit);
}

export function commitEditors(): void {
  for (const commit of pending) commit();
}

export function setFocusedEditor(editor: Editor | null): void {
  focused = editor;
}

// routes native menu undo and redo to the editor, or to a plain text field
export function undoRedo(direction: 'undo' | 'redo'): void {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    document.execCommand(direction);
    return;
  }
  // a canvas shown inside a page keeps its own history, the menu sends it the same keys
  const canvas = active instanceof HTMLElement ? active.closest('.canvas-view') : null;
  if (canvas) {
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        shiftKey: direction === 'redo',
        bubbles: true,
        ...(isMac ? { metaKey: true } : { ctrlKey: true }),
      }),
    );
    return;
  }
  if (focused && !focused.isDestroyed && focused.view.dom.contains(active)) {
    if (direction === 'undo') focused.commands.undo();
    else focused.commands.redo();
    return;
  }
  // anywhere else, such as a property's menu, it steps back through property changes
  stepProperties(direction);
}

// true when ctrl+z belongs to whatever has focus, text being typed, the page editor or a canvas
export function ownsUndo(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button'].includes(target.type);
  if (target instanceof HTMLTextAreaElement) return true;
  return (
    target instanceof HTMLElement && (target.isContentEditable || target.closest('.canvas-view') !== null)
  );
}
