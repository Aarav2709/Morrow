// your own styles for the app, kept in the vault as .morrow/style.css so they travel with your notes
import { useSyncExternalStore } from 'react';
import { getSession } from './workspace';

const FILE = 'style.css';
const MAX_LENGTH = 200_000;
let css = '';
const listeners = new Set<() => void>();

function apply(text: string): void {
  let element = document.getElementById('morrow-custom-css') as HTMLStyleElement | null;
  if (!element) {
    element = document.createElement('style');
    element.id = 'morrow-custom-css';
    document.head.append(element);
  }
  element.textContent = text;
}

export async function loadCustomCss(): Promise<void> {
  try {
    css = ((await getSession().readMeta(FILE)) ?? '').slice(0, MAX_LENGTH);
  } catch {
    css = '';
  }
  apply(css);
  for (const listener of listeners) listener();
}

export async function saveCustomCss(text: string): Promise<void> {
  css = text.slice(0, MAX_LENGTH);
  apply(css);
  for (const listener of listeners) listener();
  await getSession().writeMeta(FILE, css);
}

export function previewCustomCss(text: string): void {
  apply(text.slice(0, MAX_LENGTH));
}

export function useCustomCss(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => css,
  );
}
