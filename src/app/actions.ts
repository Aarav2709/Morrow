import type { LucideIcon } from 'lucide-react';
import {
  ArrowRightLeft,
  CalendarDays,
  CheckSquare,
  Copy,
  Download,
  FileDown,
  FileUp,
  FolderArchive,
  FolderOpen,
  Globe,
  Hash,
  History,
  Home,
  LayoutDashboard,
  LayoutTemplate,
  Maximize2,
  Network,
  Table2,
  Keyboard,
  Moon,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
  Upload,
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
  importMarkdown,
  openToday,
  publishSite,
  restoreBackup,
  toggleFavorite,
  trashPage,
} from './operations';
import { desktop, isMac } from './platform/desktop';
import { chooseVaultFolder } from './vaults';
import { getPreferences, resolvedTheme, setPreferences } from './platform/preferences';
import { navigate, parseRoute } from './router';
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

const onLivePage = ({ pageId }: ActionContext) =>
  pageId !== null && !isEffectivelyTrashed(getState().pages, pageId);

export const ACTIONS: Action[] = [
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
    keywords: 'table board kanban calendar gallery notion collection',
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
    keywords: 'folder switch vault obsidian',
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
    id: 'daily.today',
    label: "Open today's note",
    group: 'General',
    icon: CalendarDays,
    shortcut: 'Alt+D',
    keywords: 'daily journal',
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
    keywords: 'md obsidian',
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
  const route = parseRoute(window.location.hash);
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
