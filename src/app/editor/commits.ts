import type { Editor } from '@tiptap/core';

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
  if (focused && !focused.isDestroyed && focused.view.dom.contains(active)) {
    if (direction === 'undo') focused.commands.undo();
    else focused.commands.redo();
    return;
  }
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    document.execCommand(direction);
}
