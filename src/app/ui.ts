import { useSyncExternalStore } from 'react';
import type { PageId } from '../core/model';

export type SettingsSection = 'general' | 'appearance' | 'assistant' | 'sync' | 'vault' | 'about';

export type Dialog =
  | { kind: 'settings'; section?: SettingsSection }
  | { kind: 'shortcuts' }
  | { kind: 'move'; pageId: PageId }
  | { kind: 'history'; pageId: PageId }
  | { kind: 'icon'; pageId: PageId }
  // edit a formula or markdown kept as written, with a live preview for formulas
  | {
      kind: 'source';
      title: string;
      value: string;
      language: 'latex' | 'markdown';
      displayMode?: boolean;
      onSave: (value: string) => void;
    }
  // edit a formula with a live preview
  | {
      kind: 'math';
      value: string;
      block: boolean;
      onSave: (latex: string) => void;
      onCancel?: () => void;
    }
  // pick a template for a new page
  | { kind: 'template'; parentId: PageId | null }
  | { kind: 'encrypt'; pageId: PageId }
  | { kind: 'pair' }
  | { kind: 'capture' }
  | {
      kind: 'confirm';
      title: string;
      body: string;
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => void;
    };

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export interface UiState {
  palette: boolean;
  dialog: Dialog | null;
  toasts: Toast[];
  mobileSidebar: boolean;
  renaming: PageId | null;
  // page whose title should take focus once it opens
  focusTitle: PageId | null;
  // writing with nothing else on screen
  focusMode: boolean;
  // page shown as its markdown source instead of in the editor
  sourceMode: PageId | null;
}

let state: UiState = {
  palette: false,
  dialog: null,
  toasts: [],
  mobileSidebar: false,
  renaming: null,
  focusTitle: null,
  focusMode: false,
  sourceMode: null,
};
const listeners = new Set<() => void>();
let toastId = 0;

export function getUi(): UiState {
  return state;
}

export function setUi(patch: Partial<UiState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function useUi(): UiState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function openDialog(dialog: Dialog): void {
  setUi({ dialog, palette: false });
}

export function closeDialog(): void {
  setUi({ dialog: null });
}

export function confirmAction(options: Omit<Extract<Dialog, { kind: 'confirm' }>, 'kind'>): void {
  openDialog({ kind: 'confirm', ...options });
}

export function toast(
  message: string,
  options: { tone?: Toast['tone']; action?: Toast['action']; durationMs?: number } = {},
): void {
  const id = ++toastId;
  const entry: Toast = {
    id,
    message,
    tone: options.tone ?? 'info',
    ...(options.action ? { action: options.action } : {}),
  };
  setUi({ toasts: [...state.toasts.slice(-3), entry] });
  const duration = options.durationMs ?? (options.tone === 'error' ? 8000 : 5000);
  setTimeout(() => dismissToast(id), duration);
}

export function dismissToast(id: number): void {
  if (state.toasts.some((entry) => entry.id === id))
    setUi({ toasts: state.toasts.filter((entry) => entry.id !== id) });
}
