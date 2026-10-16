// tabs remember a place each, like a browser: the open tab follows wherever you go
import { useSyncExternalStore } from 'react';

export interface Tab {
  id: string;
  hash: string;
}

interface TabState {
  tabs: Tab[];
  active: string;
}

const KEY = 'morrow.tabs';
const MAX_TABS = 20;
const listeners = new Set<() => void>();
let counter = 0;
const newTabId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`;

function load(): TabState {
  const here = window.location.hash || '#/';
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TabState> | null;
    const tabs = Array.isArray(raw?.tabs)
      ? raw.tabs
          .filter((tab): tab is Tab => typeof tab?.id === 'string' && typeof tab.hash === 'string')
          .slice(0, MAX_TABS)
      : [];
    const active = tabs.find((tab) => tab.id === raw?.active) ?? tabs[0];
    if (active) {
      // the window opens where it was, so the open tab starts there too
      active.hash = here;
      return { tabs, active: active.id };
    }
  } catch {
    // tabs are a convenience, a fresh start is fine
  }
  const id = newTabId();
  return { tabs: [{ id, hash: here }], active: id };
}

let state: TabState | null = null;
const current = (): TabState => (state ??= load());

function set(next: TabState): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // not remembering tabs is harmless
  }
  for (const listener of listeners) listener();
}

function go(hash: string): void {
  if (window.location.hash !== hash) window.location.hash = hash;
}

export function startTabs(): () => void {
  current();
  const onHash = () => {
    const now = current();
    const hash = window.location.hash || '#/';
    if (now.tabs.find((tab) => tab.id === now.active)?.hash === hash) return;
    set({ ...now, tabs: now.tabs.map((tab) => (tab.id === now.active ? { ...tab, hash } : tab)) });
  };
  // ctrl or cmd click, or a middle click, on anything that points at a page opens it in a new tab
  const onClick = (event: MouseEvent) => {
    const wanted =
      event.type === 'auxclick' ? event.button === 1 : event.button === 0 && (event.ctrlKey || event.metaKey);
    if (!wanted) return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-page-id]');
    const id = target?.dataset.pageId;
    if (!id || target.closest('.tab-bar')) return;
    event.preventDefault();
    event.stopPropagation();
    openTab(`#/page/${encodeURIComponent(id)}`);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Tab' && event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      stepTab(event.shiftKey ? -1 : 1);
    }
  };
  window.addEventListener('hashchange', onHash);
  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('auxclick', onClick, true);
    window.removeEventListener('keydown', onKey, true);
  };
}

export function openTab(hash = '#/'): void {
  const now = current();
  if (now.tabs.length >= MAX_TABS) {
    go(hash);
    return;
  }
  const tab = { id: newTabId(), hash };
  const index = now.tabs.findIndex((item) => item.id === now.active);
  const tabs = [...now.tabs];
  tabs.splice(index + 1, 0, tab);
  set({ tabs, active: tab.id });
  go(hash);
}

export function activateTab(id: string): void {
  const tab = current().tabs.find((item) => item.id === id);
  if (!tab) return;
  set({ ...current(), active: id });
  go(tab.hash);
}

export function closeTab(id = current().active): void {
  const now = current();
  if (now.tabs.length <= 1) return;
  const index = now.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  const tabs = now.tabs.filter((tab) => tab.id !== id);
  if (id !== now.active) {
    set({ ...now, tabs });
    return;
  }
  const next = tabs[Math.min(index, tabs.length - 1)]!;
  set({ tabs, active: next.id });
  go(next.hash);
}

export function stepTab(direction: 1 | -1): void {
  const now = current();
  if (now.tabs.length <= 1) return;
  const index = now.tabs.findIndex((tab) => tab.id === now.active);
  activateTab(now.tabs[(index + direction + now.tabs.length) % now.tabs.length]!.id);
}

export function moveTab(id: string, to: number): void {
  const now = current();
  const tab = now.tabs.find((item) => item.id === id);
  if (!tab) return;
  const tabs = now.tabs.filter((item) => item.id !== id);
  tabs.splice(Math.max(0, Math.min(tabs.length, to)), 0, tab);
  set({ ...now, tabs });
}

export function useTabs(): TabState {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, current);
}
