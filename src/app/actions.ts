import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Columns2,
  PanelRightClose,
  RotateCcw,
  CalendarDays,
  CheckSquare,
  Copy,
  Download,
  FileDown,
  FileText,
  FileUp,
  FolderArchive,
  FolderOpen,
  Globe,
  GraduationCap,
  Hash,
  History,
  Home,
  LayoutDashboard,
  LayoutTemplate,
  Maximize2,
  Network,
  PenLine,
  Table2,
  Keyboard,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Star,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { PageId } from '../core/model';
import { isEffectivelyTrashed } from '../core/tree';
import {
  createPage,
  createTemplatesPage,
  duplicatePage,
  exportAllMarkdown,
  exportBackup,
  exportPageMarkdown,
  exportPagePdf,
  importMarkdown,
  openToday,
  publishSite,
  restoreBackup,
  toggleFavorite,
  trashPage,
} from './operations';
import { desktop, isMac } from './platform/desktop';
import {
  activeHash,
  closeOtherTabs,
  closeSide,
  closeTab,
  getTabs,
  goBack,
  goForward,
  openSide,
  openTab,
  reopenClosedTab,
  swapSides,
} from './tabs';
import { chooseVaultFolder } from './vaults';
import { getPreferences, resolvedTheme, setPreferences } from './platform/preferences';
import { activeRoute, navigate } from './router';
import { getUi, openDialog, setUi } from './ui';
import { getState } from './workspace';

export interface ActionContext {
  pageId: PageId | null;
}

export interface Action {
  id: string;
  label: string;
  group: 'General' | 'Page' | 'Data' | 'View';
  icon: LucideIcon;
  shortcut?: string;
  keywords?: string;
  enabled?: (context: ActionContext) => boolean;
  run: (context: ActionContext) => void;
}

// shortcuts shown on buttons as well as run from the keyboard
export const ACTION_SHORTCUTS = {
  back: isMac ? 'Mod+[' : 'Alt+ArrowLeft',
  forward: isMac ? 'Mod+]' : 'Alt+ArrowRight',
};

const hasSplit = () => {
  const { tabs, active } = getTabs();
  return Boolean(tabs.find((tab) => tab.id === active)?.side);
};

const onLivePage = ({ pageId }: ActionContext) =>
  pageId !== null && !isEffectivelyTrashed(getState().pages, pageId);

export const ACTIONS: Action[] = [
  {
    id: 'tab.new',
    label: 'New tab',
    group: 'View',
    icon: Plus,
    shortcut: 'Mod+T',
    keywords: 'tabs open',
    run: () => openTab(),
  },
  {
    id: 'tab.close',
    label: 'Close tab',
    group: 'View',
    icon: X,
    shortcut: 'Mod+W',
    keywords: 'tabs',
    run: () => closeTab(),
  },
  {
    id: 'tab.duplicate',
    label: 'Open this page in a new tab',
    group: 'View',
    icon: Plus,
    keywords: 'tabs split',
    run: () => openTab(activeHash()),
  },
  {
    id: 'tab.reopen',
    label: 'Reopen closed tab',
    group: 'View',
    icon: RotateCcw,
    shortcut: 'Mod+Shift+T',
    keywords: 'tabs undo restore',
    run: () => reopenClosedTab(),
  },
  {
    id: 'tab.closeOthers',
    label: 'Close other tabs',
    group: 'View',
    icon: X,
    keywords: 'tabs',
    run: () => closeOtherTabs(),
  },
  {
    id: 'go.back',
    label: 'Go back',
    group: 'View',
    icon: ArrowLeft,
    shortcut: ACTION_SHORTCUTS.back,
    keywords: 'previous history navigate',
    run: () => goBack(),
  },
  {
    id: 'go.forward',
    label: 'Go forward',
    group: 'View',
    icon: ArrowRight,
    shortcut: ACTION_SHORTCUTS.forward,
    keywords: 'next history navigate',
    run: () => goForward(),
  },
  {
    id: 'view.split',
    label: 'Open beside, in a split',
    group: 'View',
    icon: Columns2,
    shortcut: 'Mod+Shift+\\',
    keywords: 'split pane side by side two pages columns',
    run: () => openSide(),
  },
  {
    id: 'view.swapSplit',
    label: 'Swap the two sides of the split',
    group: 'View',
    icon: ArrowRightLeft,
    keywords: 'split pane swap',
    enabled: () => hasSplit(),
    run: () => swapSides(),
  },
  {
    id: 'view.closeSplit',
    label: 'Close the split',
    group: 'View',
    icon: PanelRightClose,
    keywords: 'split pane close side',
    enabled: () => hasSplit(),
    run: () => closeSide(),
  },
  {
    id: 'page.new',
    label: 'New page',
    group: 'General',
    icon: Plus,
    shortcut: 'Alt+N',
    keywords: 'create add',
    run: () => createPage(),
  },
  {
    id: 'page.newSubpage',
    label: 'New subpage',
    group: 'Page',
    icon: Plus,
    shortcut: 'Alt+Shift+N',
    keywords: 'child nested',
    enabled: onLivePage,
    run: ({ pageId }) => pageId && createPage({ parentId: pageId }),
  },
  {
    id: 'page.newDatabase',
    label: 'New database',
    group: 'General',
    icon: Table2,
    keywords: 'table board kanban calendar gallery collection',
    run: () => createPage({ kind: 'database' }),
  },
  {
    id: 'page.newCanvas',
    label: 'New canvas',
    group: 'General',
    icon: LayoutDashboard,
    keywords: 'whiteboard board diagram mind map',
    run: () => createPage({ kind: 'canvas' }),
  },
  {
    id: 'page.fromTemplate',
    label: 'New page from a template',
    group: 'General',
    icon: LayoutTemplate,
    shortcut: 'Alt+T',
    keywords: 'template',
    run: () => openDialog({ kind: 'template', parentId: null }),
  },
  {
    id: 'go.templates',
    label: 'Go to templates',
    group: 'General',
    icon: LayoutTemplate,
    keywords: 'template',
    run: () => createTemplatesPage(),
  },
  {
    id: 'go.graph',
    label: 'Open graph',
    group: 'General',
    icon: Network,
    shortcut: 'Alt+G',
    keywords: 'graph network links map',
    run: () => navigate({ name: 'graph', focus: null }),
  },
  {
    id: 'go.review',
    label: 'Review flashcards',
    group: 'General',
    icon: GraduationCap,
    shortcut: 'Alt+R',
    keywords: 'flashcards spaced repetition study learn',
    run: () => navigate({ name: 'review' }),
  },
  {
    id: 'go.tags',
    label: 'Go to tags',
    group: 'General',
    icon: Hash,
    keywords: 'tags labels',
    run: () => navigate({ name: 'tags' }),
  },
  {
    id: 'page.localGraph',
    label: 'Open local graph of this page',
    group: 'Page',
    icon: Network,
    keywords: 'graph links neighbours',
    enabled: ({ pageId }) => pageId !== null,
    run: ({ pageId }) => pageId && navigate({ name: 'graph', focus: pageId }),
  },
  {
    id: 'vault.open',
    label: 'Open another vault',
    group: 'Data',
    icon: FolderOpen,
    keywords: 'folder switch vault',
    enabled: () => desktop?.vault !== undefined,
    run: () => void chooseVaultFolder(),
  },
  {
    id: 'vault.reveal',
    label: 'Show vault folder',
    group: 'Data',
    icon: FolderOpen,
    keywords: 'files finder explorer',
    enabled: () => desktop?.vault !== undefined,
    run: () => void desktop?.vault?.reveal(''),
  },
  {
    id: 'capture',
    label: 'Quick note to today',
    group: 'General',
    icon: PenLine,
    keywords: 'capture jot inbox quick note',
    run: () => openDialog({ kind: 'capture' }),
  },
  {
    id: 'daily.today',
    label: "Open today's note",
    group: 'General',
    icon: CalendarDays,
    shortcut: 'Alt+D',
    keywords: 'daily journal',
    enabled: () => !getPreferences().hiddenModules.includes('daily'),
    run: () => openToday(),
  },
  {
    id: 'search',
    label: 'Search',
    group: 'General',
    icon: Search,
    shortcut: 'Mod+K',
    keywords: 'find palette',
    run: () => setUi({ palette: !getUi().palette }),
  },
  {
    id: 'search.all',
    label: 'Search every page',
    group: 'General',
    icon: Search,
    shortcut: 'Mod+Shift+K',
    keywords: 'find full text results everywhere',
    run: () => navigate({ name: 'search', query: '' }),
  },
  {
    id: 'assistant.toggle',
    label: 'Show or hide the assistant',
    group: 'View',
    icon: Sparkles,
    shortcut: 'Mod+J',
    keywords: 'ai chat ask claude gpt gemini',
    enabled: () => getPreferences().assistant && desktop?.assistant !== undefined,
    run: () => setPreferences({ assistantOpen: !getPreferences().assistantOpen }),
  },
  {
    id: 'go.home',
    label: 'Go to home',
    group: 'General',
    icon: Home,
    shortcut: 'Alt+H',
    run: () => navigate({ name: 'home' }),
  },
  {
    id: 'go.tasks',
    label: 'Go to tasks',
    group: 'General',
    icon: CheckSquare,
    keywords: 'todo checklist',
    run: () => navigate({ name: 'tasks' }),
  },
  {
    id: 'go.trash',
    label: 'Go to trash',
    group: 'General',
    icon: Trash2,
    keywords: 'deleted restore',
    run: () => navigate({ name: 'trash' }),
  },
  {
    id: 'page.favorite',
    label: 'Add to favourites or remove',
    group: 'Page',
    icon: Star,
    keywords: 'favorite star pin',
    enabled: onLivePage,
    run: ({ pageId }) => pageId && toggleFavorite(pageId),
  },
  {
    id: 'page.find',
    label: 'Find and replace in page',
    group: 'Page',
    icon: Search,
    shortcut: 'Mod+F',
    keywords: 'search replace',
    enabled: onLivePage,
    run: () => window.dispatchEvent(new Event('morrow:find')),
  },
  {
    id: 'page.history',
    label: 'Page history',
    group: 'Page',
    icon: History,
    keywords: 'versions restore undo',
    enabled: ({ pageId }) => pageId !== null,
    run: ({ pageId }) => pageId && openDialog({ kind: 'history', pageId }),
  },
  {
    id: 'page.move',
    label: 'Move page to…',
    group: 'Page',
    icon: ArrowRightLeft,
    keywords: 'parent nest',
    enabled: onLivePage,
    run: ({ pageId }) => pageId && openDialog({ kind: 'move', pageId }),
  },
  {
    id: 'page.duplicate',
    label: 'Duplicate page',
    group: 'Page',
    icon: Copy,
    keywords: 'copy',
    enabled: onLivePage,
    run: ({ pageId }) => pageId && duplicatePage(pageId),
  },
  {
    id: 'page.exportMarkdown',
    label: 'Export page as Markdown',
    group: 'Page',
    icon: FileDown,
    keywords: 'download md',
    enabled: ({ pageId }) => pageId !== null,
    run: ({ pageId }) => pageId && void exportPageMarkdown(pageId),
  },
  {
    id: 'page.exportPdf',
    label: 'Export page as PDF',
    group: 'Page',
    icon: FileText,
    keywords: 'print pdf save document',
    enabled: ({ pageId }) => pageId !== null && desktop !== null,
    run: ({ pageId }) => pageId && void exportPagePdf(pageId),
  },
  {
    id: 'page.trash',
    label: 'Move page to trash',
    group: 'Page',
    icon: Trash2,
    keywords: 'delete remove',
    enabled: onLivePage,
    run: ({ pageId }) => pageId && trashPage(pageId),
  },
  {
    id: 'data.importMarkdown',
    label: 'Import Markdown files',
    group: 'Data',
    icon: FileUp,
    keywords: 'md markdown',
    run: () => void importMarkdown(),
  },
  {
    id: 'data.exportAll',
    label: 'Export everything as Markdown',
    group: 'Data',
    icon: FolderArchive,
    keywords: 'zip download',
    run: () => void exportAllMarkdown(),
  },
  {
    id: 'data.publish',
    label: 'Publish everything as a website',
    group: 'Data',
    icon: Globe,
    keywords: 'site html export publish share static',
    run: () => void publishSite(null),
  },
  {
    id: 'page.publish',
    label: 'Publish this page as a website',
    group: 'Page',
    icon: Globe,
    keywords: 'site html export publish share static',
    enabled: onLivePage,
    run: ({ pageId }) => pageId && void publishSite(pageId),
  },
  {
    id: 'data.backup',
    label: 'Save a backup',
    group: 'Data',
    icon: Download,
    keywords: 'export json',
    run: () => void exportBackup(),
  },
  {
    id: 'data.restore',
    label: 'Restore from a backup',
    group: 'Data',
    icon: Upload,
    keywords: 'import json',
    run: () => void restoreBackup(),
  },
  {
    id: 'view.sidebar',
    label: 'Show or hide sidebar',
    group: 'View',
    icon: PanelLeft,
    shortcut: 'Mod+\\',
    run: () => {
      if (window.matchMedia('(max-width: 800px)').matches) setUi({ mobileSidebar: !getUi().mobileSidebar });
      else setPreferences({ sidebarOpen: !getPreferences().sidebarOpen });
    },
  },
  {
    id: 'view.focus',
    label: 'Focus mode',
    group: 'View',
    icon: Maximize2,
    shortcut: 'Mod+Shift+F',
    keywords: 'zen distraction free writing fullscreen',
    run: () => setUi({ focusMode: !getUi().focusMode }),
  },
  {
    id: 'view.theme',
    label: 'Switch light or dark theme',
    group: 'View',
    icon: resolvedTheme(getPreferences().theme) === 'dark' ? Sun : Moon,
    shortcut: 'Mod+Shift+L',
    keywords: 'dark mode appearance',
    run: () => setPreferences({ theme: resolvedTheme(getPreferences().theme) === 'dark' ? 'light' : 'dark' }),
  },
  {
    id: 'view.settings',
    label: 'Settings',
    group: 'View',
    icon: Settings,
    shortcut: 'Mod+,',
    keywords: 'preferences font width',
    run: () => openDialog({ kind: 'settings' }),
  },
  {
    id: 'view.shortcuts',
    label: 'Keyboard shortcuts',
    group: 'View',
    icon: Keyboard,
    shortcut: 'Mod+/',
    keywords: 'help keys',
    run: () => openDialog({ kind: 'shortcuts' }),
  },
];

export function currentContext(): ActionContext {
  const route = activeRoute();
  return { pageId: route.name === 'page' && getState().pages[route.id] ? route.id : null };
}

export function runAction(id: string): void {
  const action = ACTIONS.find((candidate) => candidate.id === id);
  if (!action) return;
  const context = currentContext();
  if (action.enabled && !action.enabled(context)) return;
  action.run(context);
}

export function formatShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((key) => {
      if (key === 'Mod') return isMac ? '⌘' : 'Ctrl';
      if (key === 'Alt') return isMac ? '⌥' : 'Alt';
      if (key === 'Shift') return isMac ? '⇧' : 'Shift';
      if (key === 'ArrowLeft') return '←';
      if (key === 'ArrowRight') return '→';
      return key;
    })
    .join(isMac ? '' : '+');
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = parts[parts.length - 1]!;
  const mod = parts.includes('Mod');
  const wantsMod = mod ? (isMac ? event.metaKey : event.ctrlKey) : !(event.ctrlKey || event.metaKey);
  if (!wantsMod) return false;
  if (parts.includes('Alt') !== event.altKey) return false;
  if (parts.includes('Shift') !== event.shiftKey) return false;
  // event.code keeps alt combinations working on layouts where alt changes the character
  const code = event.code.replace(/^Key|^Digit/, '');
  return (
    event.key.toLowerCase() === key.toLowerCase() ||
    code.toLowerCase() === key.toLowerCase() ||
    (key === '\\' && event.code === 'Backslash') ||
    (key === '/' && event.code === 'Slash') ||
    (key === ',' && event.code === 'Comma')
  );
}
