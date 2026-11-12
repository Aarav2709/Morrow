import { desktop } from './desktop';
import { useSyncExternalStore } from 'react';
import type { SupportedLocale } from '../i18n/types';
import { COLORS } from '../../core/model';
import type { ColorName } from '../../core/model';

export type ThemePreference = 'system' | 'light' | 'dark';
export type WritingFont = 'serif' | 'sans' | 'mono';
// standard keeps lines easy to read, wide fits tables, full uses the whole window
export type PageWidth = 'comfortable' | 'wide' | 'full';
export const PAGE_WIDTHS: readonly PageWidth[] = ['comfortable', 'wide', 'full'];
export type TrashDays = 0 | 30 | 60 | 90;
export interface Reminder {
  id: string;
  pageId: string;
  // the day written in the page, yyyy-mm-dd, and when on it to remind
  date: string;
  at: number;
}
// what morrow shows when it opens: today's note, the home page, or where you left off
export type StartPage = 'today' | 'home' | 'last';
// the views the sidebar lists, each one can be left out, daily notes turn off everywhere with theirs
export const SIDEBAR_MODULES = [
  'search',
  'daily',
  'tasks',
  'tags',
  'review',
  'graph',
  'favorites',
  'templates',
  'import',
  'archive',
  'trash',
] as const;
export type SidebarModule = (typeof SIDEBAR_MODULES)[number];
// everything in the sidebar in the order it is shown, in three groups: the links at the top, the sections
// that scroll, and the links at the bottom. home, pages and settings are always there
export const SIDEBAR_GROUPS = {
  top: ['search', 'home', 'daily', 'tasks', 'review', 'tags', 'graph', 'assistant'],
  sections: ['favorites', 'templates', 'pages'],
  bottom: ['import', 'archive', 'trash', 'settings'],
} as const;
export type SidebarItem =
  | (typeof SIDEBAR_GROUPS.top)[number]
  | (typeof SIDEBAR_GROUPS.sections)[number]
  | (typeof SIDEBAR_GROUPS.bottom)[number];
export const SIDEBAR_FIXED: readonly SidebarItem[] = ['home', 'pages', 'settings'];
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
  // pages are shown for reading: nothing can be typed, so scrolling on a phone never brings the keyboard up
  readingMode: boolean;
  sidebarWidth: number;
  assistantWidth: number;
  expanded: string[];
  accent: Accent;
  // colourful headings, lists, icons and tags, off by default so the accent stays on buttons and links
  colorful: boolean;
  // what the home page calls you, empty for no name
  name: string;
  // the size each inline canvas was dragged to
  canvasSizes: Record<string, CanvasSize>;
  // pages shown wider or narrower than the width set for every page
  pageWidths: Record<string, PageWidth>;
  // pages that leave out the On this page list of headings
  hiddenOutlines: string[];
  // pages in the trash longer than this many days are deleted for good, 0 keeps them until emptied
  trashDays: TrashDays;
  // reminders set on dates in pages, shown by this computer when they are due
  reminders: Reminder[];
  // how much of a split tab the first side takes
  splitShare: number;
  startPage: StartPage;
  // today's note is made when morrow opens on it, off opens home instead until the note is made by hand
  autoDaily: boolean;
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
  // red underlines under words the spellchecker does not know
  spellcheck: boolean;
  // views left out of the sidebar, they still open from search and their shortcuts
  hiddenModules: SidebarModule[];
  // the order of what the sidebar shows, dragged in settings
  sidebarOrder: SidebarItem[];
  // plugins in a vault only run on a computer where this was turned on
  plugins: boolean;
  // the colour last picked for words, which ctrl shift h puts on again
  lastColor: { kind: 'text' | 'bg'; color: ColorName } | null;
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
  readingMode: false,
  sidebarWidth: 264,
  assistantWidth: 380,
  expanded: [],
  accent: 'ember',
  colorful: false,
  name: '',
  canvasSizes: {},
  pageWidths: {},
  hiddenOutlines: [],
  trashDays: 0,
  reminders: [],
  splitShare: 0.5,
  startPage: 'today',
  autoDaily: true,
  assistant: false,
  assistantOpen: false,
  assistantAsk: true,
  checkUpdates: false,
  mcpEnabled: false,
  codeLanguage: '',
  spellcheck: true,
  hiddenModules: [],
  sidebarOrder: [...SIDEBAR_GROUPS.top, ...SIDEBAR_GROUPS.sections, ...SIDEBAR_GROUPS.bottom],
  plugins: false,
  lastColor: null,
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

// an order saved before an item existed gets it in its usual place
function readSidebarOrder(raw: unknown): SidebarItem[] {
  const all = [...SIDEBAR_GROUPS.top, ...SIDEBAR_GROUPS.sections, ...SIDEBAR_GROUPS.bottom] as SidebarItem[];
  if (!Array.isArray(raw)) return all;
  const kept = raw.filter(
    (item, index): item is SidebarItem => all.includes(item) && raw.indexOf(item) === index,
  );
  for (const item of all) {
    if (kept.includes(item)) continue;
    const before = all
      .slice(0, all.indexOf(item))
      .reverse()
      .find((other) => kept.includes(other));
    kept.splice(before ? kept.indexOf(before) + 1 : 0, 0, item);
  }
  return kept;
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
      width: PAGE_WIDTHS.find((width) => width === parsed.width) ?? 'comfortable',
      sidebarOpen: parsed.sidebarOpen !== false,
      sidebarPeek: parsed.sidebarPeek === true,
      readingMode: parsed.readingMode === true,
      accent: ACCENTS.includes(parsed.accent as Accent) ? parsed.accent! : defaults.accent,
      colorful: parsed.colorful === true,
      name: typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 60) : '',
      sidebarWidth:
        typeof parsed.sidebarWidth === 'number'
          ? Math.min(420, Math.max(208, parsed.sidebarWidth))
          : defaults.sidebarWidth,
      assistantWidth:
        typeof parsed.assistantWidth === 'number'
          ? Math.min(720, Math.max(300, parsed.assistantWidth))
          : defaults.assistantWidth,
      expanded: Array.isArray(parsed.expanded)
        ? parsed.expanded.filter((id) => typeof id === 'string').slice(0, 2000)
        : [],
      canvasSizes: readCanvasSizes(parsed.canvasSizes),
      reminders: Array.isArray(parsed.reminders)
        ? parsed.reminders
            .filter(
              (item) =>
                item &&
                typeof item.id === 'string' &&
                typeof item.pageId === 'string' &&
                typeof item.date === 'string' &&
                typeof item.at === 'number',
            )
            .slice(0, 500)
        : [],
      trashDays: ([30, 60, 90] as const).find((days) => days === parsed.trashDays) ?? 0,
      hiddenOutlines: Array.isArray(parsed.hiddenOutlines)
        ? parsed.hiddenOutlines.filter((id): id is string => typeof id === 'string').slice(0, 2000)
        : [],
      pageWidths: Object.fromEntries(
        Object.entries(parsed.pageWidths ?? {})
          .filter(([, width]) => PAGE_WIDTHS.includes(width as PageWidth))
          .slice(0, 2000),
      ) as Record<string, PageWidth>,
      splitShare:
        typeof parsed.splitShare === 'number' ? Math.min(0.8, Math.max(0.2, parsed.splitShare)) : 0.5,
      startPage: ['today', 'home', 'last'].includes(parsed.startPage as string)
        ? parsed.startPage!
        : defaults.startPage,
      autoDaily: parsed.autoDaily !== false,
      assistant: parsed.assistant === true,
      assistantOpen: parsed.assistantOpen === true,
      assistantAsk: parsed.assistantAsk !== false,
      checkUpdates: parsed.checkUpdates === true,
      mcpEnabled: parsed.mcpEnabled === true,
      codeLanguage:
        typeof parsed.codeLanguage === 'string' && /^[\w#+.-]{0,40}$/.test(parsed.codeLanguage)
          ? parsed.codeLanguage
          : '',
      spellcheck: parsed.spellcheck !== false,
      plugins: parsed.plugins === true,
      lastColor:
        parsed.lastColor &&
        (parsed.lastColor.kind === 'text' || parsed.lastColor.kind === 'bg') &&
        (COLORS as readonly string[]).includes(parsed.lastColor.color)
          ? { kind: parsed.lastColor.kind, color: parsed.lastColor.color }
          : null,
      hiddenModules: Array.isArray(parsed.hiddenModules)
        ? SIDEBAR_MODULES.filter((module) => parsed.hiddenModules!.includes(module))
        : [],
      sidebarOrder: readSidebarOrder(parsed.sidebarOrder),
    };
  } catch {
    return defaults;
  }
}

// every text field takes it from the page, the desktop app also turns the spellchecker itself off
export function applySpellcheck(enabled: boolean): void {
  if (typeof document !== 'undefined') document.documentElement.spellcheck = enabled;
  desktop?.setSpellcheck?.(enabled);
}

export function getPreferences(): Preferences {
  return current;
}

export function setPreferences(patch: Partial<Preferences>): void {
  current = { ...current, ...patch };
  if ('mcpEnabled' in patch && desktop?.mcp?.setEnabled) {
    void desktop.mcp.setEnabled(Boolean(patch.mcpEnabled));
  }
  if ('spellcheck' in patch) applySpellcheck(current.spellcheck);
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
