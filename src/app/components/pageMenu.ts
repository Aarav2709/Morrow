import {
  ArrowRightLeft,
  Copy,
  FileDown,
  FileUp,
  History,
  Pencil,
  Plus,
  Smile,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import type { PageId } from '../../core/model';
import {
  createPage,
  duplicatePage,
  exportPageMarkdown,
  importMarkdown,
  toggleFavorite,
  trashPage,
} from '../operations';
import { openDialog } from '../ui';
import { getState } from '../workspace';
import type { MenuEntry } from './Menu';

// one menu definition for the sidebar row and the page header
export function pageMenuEntries(pageId: PageId, rename: () => void): MenuEntry[] {
  const page = getState().pages[pageId];
  if (!page) return [];
  return [
    { label: 'Add subpage', icon: Plus, onSelect: () => createPage({ parentId: pageId }) },
    { label: 'Rename', icon: Pencil, shortcut: 'F2', onSelect: rename },
    {
      label: page.icon ? 'Change icon' : 'Add icon',
      icon: Smile,
      onSelect: () => openDialog({ kind: 'icon', pageId }),
    },
    { label: 'Page history', icon: History, onSelect: () => openDialog({ kind: 'history', pageId }) },
    page.favorite
      ? { label: 'Remove from favourites', icon: StarOff, onSelect: () => toggleFavorite(pageId) }
      : { label: 'Add to favourites', icon: Star, onSelect: () => toggleFavorite(pageId) },
    { label: 'Duplicate', icon: Copy, onSelect: () => duplicatePage(pageId) },
    { label: 'Move to…', icon: ArrowRightLeft, onSelect: () => openDialog({ kind: 'move', pageId }) },
    { separator: true },
    { label: 'Export as Markdown', icon: FileDown, onSelect: () => void exportPageMarkdown(pageId) },
    { label: 'Import Markdown here', icon: FileUp, onSelect: () => void importMarkdown(pageId) },
    { separator: true },
    {
      label: 'Move to trash',
      icon: Trash2,
      danger: true,
      shortcut: 'Del',
      onSelect: () => trashPage(pageId),
    },
  ];
}
