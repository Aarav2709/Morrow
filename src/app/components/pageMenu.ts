import {
  ArrowRightLeft,
  Copy,
  FolderOpen,
  Lock,
  LockOpen,
  Globe,
  LayoutTemplate,
  Network,
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
  publishSite,
  revealPage,
  saveAsTemplate,
  toggleFavorite,
  trashPage,
} from '../operations';
import { desktop } from '../platform/desktop';
import { navigate } from '../router';
import { openDialog } from '../ui';
import { getSession, getState } from '../workspace';
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
    { label: 'Open local graph', icon: Network, onSelect: () => navigate({ name: 'graph', focus: pageId }) },
    ...(page.kind === 'page'
      ? [{ label: 'Save as template', icon: LayoutTemplate, onSelect: () => saveAsTemplate(pageId) }]
      : []),
    ...(desktop?.vault && getSession().pathOf(pageId) !== null
      ? [{ label: 'Show in folder', icon: FolderOpen, onSelect: () => revealPage(pageId) }]
      : []),
    ...(page.kind === 'page' && getSession().supportsEncryption
      ? page.encrypted
        ? getSession().unreadable.has(pageId)
          ? []
          : [
              { label: 'Lock now', icon: Lock, onSelect: () => void getSession().lockPage(pageId) },
              {
                label: 'Remove encryption',
                icon: LockOpen,
                onSelect: () => void getSession().unprotectPage(pageId),
              },
            ]
        : [
            {
              label: 'Encrypt with a password…',
              icon: Lock,
              onSelect: () => openDialog({ kind: 'encrypt', pageId }),
            },
          ]
      : []),
    { separator: true },
    { label: 'Export as Markdown', icon: FileDown, onSelect: () => void exportPageMarkdown(pageId) },
    { label: 'Publish as a website', icon: Globe, onSelect: () => void publishSite(pageId) },
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
