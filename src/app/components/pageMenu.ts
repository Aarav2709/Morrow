import { ArrowRightLeft, Copy, FileDown, FileUp, Pencil, Plus, Star, StarOff, Trash2 } from 'lucide-react';
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
    page.favorite
      ? { label: 'Remove from favourites', icon: StarOff, onSelect: () => toggleFavorite(pageId) }
      : { label: 'Add to favourites', icon: Star, onSelect: () => toggleFavorite(pageId) },
    { label: 'Duplicate', icon: Copy, onSelect: () => duplicatePage(pageId) },
    { label: 'Move to…', icon: ArrowRightLeft, onSelect: () => openDialog({ kind: 'move', pageId }) },
    { separator: true },
    { label: 'Export as Markdown', icon: FileDown, onSelect: () => exportPageMarkdown(pageId) },
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
