// tabs remember a place each, like a browser: the open tab follows wherever you go.
// a tab can be split in two, each side with its own back and forward history
import { createContext, useContext, useSyncExternalStore } from 'react';

export type PaneId = 'main' | 'side';

export interface PaneHistory {
  hash: string;
  back: string[];
  forward: string[];
}

export interface Tab extends PaneHistory {
  id: string;
  // the second page shown beside the first, null when the tab is not split
  side: PaneHistory | null;
}

interface TabState {
  tabs: Tab[];
  active: string;
  // the side of a split tab that navigation goes to, the one last clicked or typed in
  pane: PaneId;
  // recently closed tabs, newest last, so they can be opened again
  closed: string[];
}

const KEY = 'morrow.tabs';
const MAX_TABS = 20;
const MAX_HISTORY = 50;
const MAX_CLOSED = 10;
const listeners = new Set<() => void>();
let counter = 0;
const newTabId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`;

const strings = (value: unknown, limit = MAX_HISTORY): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-limit) : [];

function readPane(raw: unknown): PaneHistory | null {
  const value = raw as Partial<PaneHistory> | null;
  if (typeof value?.hash !== 'string') return null;
  return { hash: value.hash, back: strings(value.back), forward: strings(value.forward) };
}

function load(): TabState {
  const here = window.location.hash || '#/';
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<TabState> | null;
    const tabs = Array.isArray(raw?.tabs)
      ? raw.tabs
          .filter((tab): tab is Tab => typeof tab?.id === 'string' && typeof tab.hash === 'string')
          .slice(0, MAX_TABS)
          .map((tab) => ({ ...readPane(tab)!, id: tab.id, side: readPane(tab.side) }))
      : [];
    const active = tabs.find((tab) => tab.id === raw?.active) ?? tabs[0];
    if (active) {
      // the window opens where it was, so the open tab starts there too
      if (active.hash !== here) active.back = [...active.back, active.hash].slice(-MAX_HISTORY);
      active.hash = here;
      return {
        tabs,
        active: active.id,
        pane: raw?.pane === 'side' && active.side ? 'side' : 'main',
        closed: strings(raw?.closed, MAX_CLOSED),
      };
    }
  } catch {
    // tabs are a convenience, a fresh start is fine
  }
  const id = newTabId();
  return {
    tabs: [{ id, hash: here, back: [], forward: [], side: null }],
    active: id,
    pane: 'main',
    closed: [],
  };
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

const activeTab = (now = current()): Tab => now.tabs.find((tab) => tab.id === now.active) ?? now.tabs[0]!;

function updateActive(change: (tab: Tab) => Tab, extra: Partial<TabState> = {}): void {
  const now = current();
  set({ ...now, ...extra, tabs: now.tabs.map((tab) => (tab.id === now.active ? change(tab) : tab)) });
}

// a hash the main side is about to show because of a tab switch or back and forward, not a new visit
let arriving: string | null = null;

function go(hash: string): void {
  if (window.location.hash === hash || (hash === '#/' && !window.location.hash)) return;
  arriving = hash;
  window.location.hash = hash;
}

function visit(pane: PaneHistory, hash: string, replace: boolean): PaneHistory {
  if (pane.hash === hash) return pane;
  if (replace) return { ...pane, hash };
  return { hash, back: [...pane.back, pane.hash].slice(-MAX_HISTORY), forward: [] };
}

// a mouse's back button can reach the app both as a button press and as a window app command. whichever
// comes first moves, the other one for the same press is let go
let lastNavigation = 0;
export function claimNavigation(): boolean {
  if (Date.now() - lastNavigation < 400) return false;
  lastNavigation = Date.now();
  return true;
}

export function startTabs(): () => void {
  current();
  const onHash = () => {
    const hash = window.location.hash || '#/';
    const tab = activeTab();
    const expected = arriving === hash;
    arriving = null;
    if (tab.hash === hash) return;
    updateActive((item) => (expected ? { ...item, hash } : { ...item, ...visit(item, hash, false) }));
  };
  // ctrl or cmd click, or a middle click, on anything that points at a page opens it in a new tab,
  // alt click opens it beside the page you are on
  const onClick = (event: MouseEvent) => {
    const newTab =
      event.type === 'auxclick' ? event.button === 1 : event.button === 0 && (event.ctrlKey || event.metaKey);
    const toSide =
      event.type === 'click' && event.button === 0 && event.altKey && !event.ctrlKey && !event.metaKey;
    if (!newTab && !toSide) return;
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-page-id]');
    const id = target?.dataset.pageId;
    if (!id || target.closest('.tab-bar')) return;
    event.preventDefault();
    event.stopPropagation();
    const hash = `#/page/${encodeURIComponent(id)}`;
    if (newTab) openTab(hash);
    else openSide(hash);
  };
  // a mouse's back and forward buttons. chromium only reports their press and release, never a click, and
  // windows may also send them to the window as app commands, which arrive as the go back action
  const onMouseButton = (event: MouseEvent) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    if (event.type !== 'mouseup' || !claimNavigation()) return;
    const pane = paneAt(event.target);
    if (event.button === 3) goBack(pane);
    else goForward(pane);
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
  window.addEventListener('mousedown', onMouseButton, true);
  window.addEventListener('mouseup', onMouseButton, true);
  window.addEventListener('keydown', onKey, true);
  return () => {
    window.removeEventListener('hashchange', onHash);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('auxclick', onClick, true);
    window.removeEventListener('mousedown', onMouseButton, true);
    window.removeEventListener('mouseup', onMouseButton, true);
    window.removeEventListener('keydown', onKey, true);
  };
}

function paneAt(target: EventTarget | null): PaneId {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-pane]') : null;
  return element?.dataset.pane === 'side' ? 'side' : element ? 'main' : current().pane;
}

// where navigation goes: the side of a split tab when that side was used last
export function targetPane(): PaneId {
  const now = current();
  return now.pane === 'side' && activeTab(now).side ? 'side' : 'main';
}

// the hash shown in the pane navigation goes to
export function activeHash(): string {
  const tab = activeTab();
  return targetPane() === 'side' ? tab.side!.hash : window.location.hash || '#/';
}

export function setActivePane(pane: PaneId): void {
  const now = current();
  const next = pane === 'side' && activeTab(now).side ? 'side' : 'main';
  if (now.pane !== next) set({ ...now, pane: next });
}

// shows a place in the main side, replacing keeps back and forward as they are
export function showInMain(hash: string, replace = false): void {
  if (window.location.hash === hash) return;
  if (!replace) {
    window.location.hash = hash;
    return;
  }
  updateActive((item) => ({ ...item, hash }));
  history.replaceState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// shows a place in the side of the split, used by navigation while that side is active
export function showInSide(hash: string, replace = false): void {
  const tab = activeTab();
  if (!tab.side) return;
  updateActive((item) => ({ ...item, side: visit(item.side!, hash, replace) }));
}

// splits the tab, the new side shows the given place and becomes where navigation goes
export function openSide(hash = activeHash()): void {
  updateActive((item) => ({ ...item, side: { hash, back: [], forward: [] } }), { pane: 'side' });
}

export function closeSide(): void {
  if (!activeTab().side) return;
  updateActive((item) => ({ ...item, side: null }), { pane: 'main' });
}

export function swapSides(): void {
  const tab = activeTab();
  if (!tab.side) return;
  const main: PaneHistory = { hash: tab.hash, back: tab.back, forward: tab.forward };
  const side = tab.side;
  updateActive((item) => ({ ...item, ...side, side: main }));
  go(side.hash);
}

function paneOf(tab: Tab, pane: PaneId): PaneHistory | null {
  return pane === 'side' ? tab.side : tab;
}

export function canGo(tab: Tab, pane: PaneId, direction: 'back' | 'forward'): boolean {
  return (paneOf(tab, pane)?.[direction].length ?? 0) > 0;
}

function step(pane: PaneId, direction: 'back' | 'forward'): void {
  const tab = activeTab();
  const history = paneOf(tab, pane);
  if (!history || history[direction].length === 0) return;
  const list = [...history[direction]];
  const hash = list.pop()!;
  const left = [...(direction === 'back' ? history.forward : history.back), history.hash].slice(-MAX_HISTORY);
  const moved: PaneHistory =
    direction === 'back' ? { hash, back: list, forward: left } : { hash, back: left, forward: list };
  if (pane === 'side') {
    updateActive((item) => ({ ...item, side: moved }), { pane: 'side' });
    return;
  }
  updateActive((item) => ({ ...item, ...moved }), { pane: 'main' });
  go(hash);
}

export function goBack(pane: PaneId = targetPane()): void {
  step(pane, 'back');
}

export function goForward(pane: PaneId = targetPane()): void {
  step(pane, 'forward');
}

export function openTab(hash = '#/'): void {
  const now = current();
  if (now.tabs.length >= MAX_TABS) {
    go(hash);
    return;
  }
  const tab: Tab = { id: newTabId(), hash, back: [], forward: [], side: null };
  const index = now.tabs.findIndex((item) => item.id === now.active);
  const tabs = [...now.tabs];
  tabs.splice(index + 1, 0, tab);
  set({ ...now, tabs, active: tab.id, pane: 'main' });
  go(hash);
}

export function activateTab(id: string): void {
  const now = current();
  const tab = now.tabs.find((item) => item.id === id);
  if (!tab || id === now.active) return;
  set({ ...now, active: id, pane: 'main' });
  go(tab.hash);
}

export function closeTab(id = current().active): void {
  const now = current();
  if (now.tabs.length <= 1) return;
  const index = now.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  const tabs = now.tabs.filter((tab) => tab.id !== id);
  const closed = [...now.closed, now.tabs[index]!.hash].slice(-MAX_CLOSED);
  if (id !== now.active) {
    set({ ...now, tabs, closed });
    return;
  }
  const next = tabs[Math.min(index, tabs.length - 1)]!;
  set({ ...now, tabs, active: next.id, pane: 'main', closed });
  go(next.hash);
}

export function closeOtherTabs(id = current().active): void {
  const now = current();
  const keep = now.tabs.find((tab) => tab.id === id);
  if (!keep) return;
  const closed = [...now.closed, ...now.tabs.filter((tab) => tab.id !== id).map((tab) => tab.hash)];
  set({ ...now, tabs: [keep], active: id, pane: 'main', closed: closed.slice(-MAX_CLOSED) });
  go(keep.hash);
}

export function closeTabsToRight(id = current().active): void {
  const now = current();
  const index = now.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  const gone = now.tabs.slice(index + 1);
  if (gone.length === 0) return;
  const tabs = now.tabs.slice(0, index + 1);
  const closed = [...now.closed, ...gone.map((tab) => tab.hash)].slice(-MAX_CLOSED);
  const stays = tabs.some((tab) => tab.id === now.active);
  set({ ...now, tabs, closed, active: stays ? now.active : id, pane: stays ? now.pane : 'main' });
  if (!stays) go(tabs[index]!.hash);
}

export function reopenClosedTab(): void {
  const now = current();
  const hash = now.closed[now.closed.length - 1];
  if (!hash) return;
  set({ ...now, closed: now.closed.slice(0, -1) });
  openTab(hash);
}

export function stepTab(direction: 1 | -1): void {
  const now = current();
  if (now.tabs.length <= 1) return;
  const index = now.tabs.findIndex((tab) => tab.id === now.active);
  activateTab(now.tabs[(index + direction + now.tabs.length) % now.tabs.length]!.id);
}

// the ninth asks for the last tab, like a browser
export function activateTabAt(position: number): void {
  const tabs = current().tabs;
  const tab = position >= 9 ? tabs[tabs.length - 1] : tabs[position - 1];
  if (tab) activateTab(tab.id);
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

export function subscribeTabs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTabs(): TabState {
  return current();
}

// which side of the split a view is drawn in
export const PaneContext = createContext<PaneId>('main');

export function usePane(): PaneId {
  return useContext(PaneContext);
}
