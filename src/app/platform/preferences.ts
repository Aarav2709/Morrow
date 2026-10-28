import { desktop } from './desktop';
import { useSyncExternalStore } from 'react';
import type { SupportedLocale } from '../i18n/types';

export type ThemePreference = 'system' | 'light' | 'dark';
export type WritingFont = 'serif' | 'sans' | 'mono';
export type PageWidth = 'comfortable' | 'wide';
// what morrow shows when it opens: today's note, the home page, or where you left off
export type StartPage = 'today' | 'home' | 'last';
// the views the sidebar lists, each one can be left out, daily notes turn off everywhere with theirs
export const SIDEBAR_MODULES = ['daily', 'tasks', 'tags', 'review', 'graph'] as const;
export type SidebarModule = (typeof SIDEBAR_MODULES)[number];
// accent colours, each tuned for light and dark in features.css
export const ACCENTS = ['ember', 'ocean', 'aqua', 'violet', 'forest', 'rose', 'amber', 'graphite'] as const;
export type Accent = (typeof ACCENTS)[number];
// a canvas shown inside a page, width null fills the page
export interface CanvasSize {
  width: number | null;
  height: number;
}

export interface Preferences {
  locale: SupportedLocale;
  theme: ThemePreference;
  font: WritingFont;
  width: PageWidth;
  sidebarOpen: boolean;
  // a hidden sidebar slides in while the pointer is at the window's left edge
  sidebarPeek: boolean;
  sidebarWidth: number;
  expanded: string[];
  accent: Accent;
  // colourful headings, lists, icons and tags, off for a quieter page
  colorful: boolean;
  // what the home page calls you, empty for no name
  name: string;
  // the size each inline canvas was dragged to
  canvasSizes: Record<string, CanvasSize>;
  // how much of a split tab the first side takes
  splitShare: number;
  startPage: StartPage;
  // the optional assistant, off until turned on in settings
  assistant: boolean;
  assistantOpen: boolean;
  // changes the assistant proposes wait for approval
  assistantAsk: boolean;
  // look for a new version when morrow opens and once a day, off until turned on
  checkUpdates: boolean;
  mcpEnabled: boolean;
  // the language last picked for a code block, a new block starts in it. empty for plain text
  codeLanguage: string;
  // views left out of the sidebar, they still open from search and their shortcuts
  hiddenModules: SidebarModule[];
}

const KEY = 'morrow.preferences';

function defaultLocale(): SupportedLocale {
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language?.toLowerCase() ?? '';
    if (lang.startsWith('es')) return 'es';
    if (lang.startsWith('pt')) return 'pt';
  }
  return 'en';
}

const defaults: Preferences = {
  locale: defaultLocale(),
  theme: 'system',
  font: 'sans',
  width: 'comfortable',
  sidebarOpen: true,
  sidebarPeek: false,
  sidebarWidth: 264,
  expanded: [],
  accent: 'ocean',
  colorful: true,
  name: '',
  canvasSizes: {},
  splitShare: 0.5,
  startPage: 'today',
  assistant: false,
  assistantOpen: false,
  assistantAsk: true,
  checkUpdates: false,
  mcpEnabled: false,
  codeLanguage: '',
  hiddenModules: [],
};

// view preferences only, losing them never loses work
let current: Preferences = read();
const listeners = new Set<() => void>();

function readCanvasSizes(raw: unknown): Record<string, CanvasSize> {
  if (!raw || typeof raw !== 'object') return {};
  const sizes: Record<string, CanvasSize> = {};
  for (const [id, value] of Object.entries(raw as Record<string, Partial<CanvasSize>>).slice(0, 500)) {
    if (typeof value?.height !== 'number') continue;
    sizes[id] = { width: typeof value.width === 'number' ? value.width : null, height: value.height };
  }
  return sizes;
}

function read(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      locale: ['en', 'es', 'pt'].includes(parsed.locale as SupportedLocale)
        ? (parsed.locale as SupportedLocale)
        : defaults.locale,
      theme: ['system', 'light', 'dark'].includes(parsed.theme as string) ? parsed.theme! : defaults.theme,
      font: ['serif', 'sans', 'mono'].includes(parsed.font as string) ? parsed.font! : defaults.font,
      width: parsed.width === 'wide' ? 'wide' : 'comfortable',
      sidebarOpen: parsed.sidebarOpen !== false,
      sidebarPeek: parsed.sidebarPeek === true,
      accent: ACCENTS.includes(parsed.accent as Accent) ? parsed.accent! : defaults.accent,
      colorful: parsed.colorful !== false,
      name: typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 60) : '',
      sidebarWidth:
        typeof parsed.sidebarWidth === 'number'
          ? Math.min(420, Math.max(208, parsed.sidebarWidth))
          : defaults.sidebarWidth,
      expanded: Array.isArray(parsed.expanded)
        ? parsed.expanded.filter((id) => typeof id === 'string').slice(0, 2000)
        : [],
      canvasSizes: readCanvasSizes(parsed.canvasSizes),
      splitShare:
        typeof parsed.splitShare === 'number' ? Math.min(0.8, Math.max(0.2, parsed.splitShare)) : 0.5,
      startPage: ['today', 'home', 'last'].includes(parsed.startPage as string)
        ? parsed.startPage!
        : defaults.startPage,
      assistant: parsed.assistant === true,
      assistantOpen: parsed.assistantOpen === true,
      assistantAsk: parsed.assistantAsk !== false,
      checkUpdates: parsed.checkUpdates === true,
      mcpEnabled: parsed.mcpEnabled === true,
      codeLanguage:
        typeof parsed.codeLanguage === 'string' && /^[\w#+.-]{0,40}$/.test(parsed.codeLanguage)
          ? parsed.codeLanguage
          : '',
      hiddenModules: Array.isArray(parsed.hiddenModules)
        ? SIDEBAR_MODULES.filter((module) => parsed.hiddenModules!.includes(module))
        : [],
    };
  } catch {
    return defaults;
  }
}

export function getPreferences(): Preferences {
  return current;
}

export function setPreferences(patch: Partial<Preferences>): void {
  current = { ...current, ...patch };
  if ('mcpEnabled' in patch && desktop?.mcp?.setEnabled) {
    void desktop.mcp.setEnabled(Boolean(patch.mcpEnabled));
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // storage can be unavailable, the preference still applies for this session
  }
  for (const listener of listeners) listener();
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

export function resolvedTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
