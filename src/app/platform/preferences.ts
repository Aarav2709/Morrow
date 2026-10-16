import { useSyncExternalStore } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type WritingFont = 'serif' | 'sans' | 'mono';
export type PageWidth = 'comfortable' | 'wide';
// accent colours, each tuned for light and dark in features.css
export const ACCENTS = ['ember', 'ocean', 'aqua', 'violet', 'forest', 'rose', 'amber', 'graphite'] as const;
export type Accent = (typeof ACCENTS)[number];
export const ACCENT_LABELS: Record<Accent, string> = {
  ember: 'Ember',
  ocean: 'Ocean',
  aqua: 'Aqua',
  violet: 'Violet',
  forest: 'Forest',
  rose: 'Rose',
  amber: 'Amber',
  graphite: 'Graphite',
};

export interface Preferences {
  theme: ThemePreference;
  font: WritingFont;
  width: PageWidth;
  sidebarOpen: boolean;
  sidebarWidth: number;
  expanded: string[];
  accent: Accent;
  // colourful headings, lists, icons and tags, off for a quieter page
  colorful: boolean;
  // what the home page calls you, empty for no name
  name: string;
}

const KEY = 'morrow.preferences';
const defaults: Preferences = {
  theme: 'system',
  font: 'sans',
  width: 'comfortable',
  sidebarOpen: true,
  sidebarWidth: 264,
  expanded: [],
  accent: 'ocean',
  colorful: true,
  name: '',
};

// view preferences only, losing them never loses work
let current: Preferences = read();
const listeners = new Set<() => void>();

function read(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: ['system', 'light', 'dark'].includes(parsed.theme as string) ? parsed.theme! : defaults.theme,
      font: ['serif', 'sans', 'mono'].includes(parsed.font as string) ? parsed.font! : defaults.font,
      width: parsed.width === 'wide' ? 'wide' : 'comfortable',
      sidebarOpen: parsed.sidebarOpen !== false,
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
