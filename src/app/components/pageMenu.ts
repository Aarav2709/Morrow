import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  Copy,
  Database,
  FolderOpen,
  Lock,
  LockOpen,
  Globe,
  LayoutTemplate,
  Network,
  FileCode2,
  FileDown,
  FileText,
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
  exportPagePdf,
  importMarkdown,
  publishSite,
  revealPage,
  saveAsTemplate,
  setArchived,
  toggleFavorite,
  trashPage,
  turnIntoDatabase,
  turnIntoPage,
} from '../operations';
import { desktop } from '../platform/desktop';
import { navigate } from '../router';
import { getUi, openDialog, setUi } from '../ui';
import { childrenOf } from '../../core/tree';
import { getSession, getState } from '../workspace';
import { t } from '../i18n';
import type { MenuEntry } from './Menu';

// one menu definition for the sidebar row and the page header
export function pageMenuEntries(pageId: PageId, rename: () => void): MenuEntry[] {
  const page = getState().pages[pageId];
  if (!page) return [];
  return [
    { label: t('pageMenu.addSubpage'), icon: Plus, onSelect: () => createPage({ parentId: pageId }) },
    { label: t('pageMenu.rename'), icon: Pencil, shortcut: 'F2', onSelect: rename },
    {
      label: page.icon ? t('pageMenu.changeIcon') : t('pageMenu.addIcon'),
      icon: Smile,
      onSelect: () => openDialog({ kind: 'icon', pageId }),
    },
    {
      label: t('pageMenu.pageHistory'),
      icon: History,
      onSelect: () => openDialog({ kind: 'history', pageId }),
    },
    page.favorite
      ? { label: t('pageMenu.removeFromFavorites'), icon: StarOff, onSelect: () => toggleFavorite(pageId) }
      : { label: t('pageMenu.addToFavorites'), icon: Star, onSelect: () => toggleFavorite(pageId) },
    { label: t('pageMenu.duplicate'), icon: Copy, onSelect: () => duplicatePage(pageId) },
    {
      label: t('pageMenu.moveTo'),
      icon: ArrowRightLeft,
      onSelect: () => openDialog({ kind: 'move', pageId }),
    },
    {
      label: t('pageMenu.openLocalGraph'),
      icon: Network,
      onSelect: () => navigate({ name: 'graph', focus: pageId }),
    },
    ...(page.kind === 'page'
      ? [
          {
            label: t('pageMenu.saveAsTemplate'),
            icon: LayoutTemplate,
            onSelect: () => saveAsTemplate(pageId),
          },
        ]
      : []),
    // a folder of notes becomes a database of them, like a notion database sitting on the folder
    ...(page.kind === 'page' && !page.dailyDate && !page.encrypted && !getSession().unreadable.has(pageId)
      ? [
          {
            label: childrenOf(getState().pages, pageId).length
              ? t('pageMenu.turnSubpagesIntoDatabase')
              : t('pageMenu.turnIntoDatabase'),
            icon: Database,
            onSelect: () => turnIntoDatabase(pageId),
          },
        ]
      : []),
    ...(page.kind === 'database'
      ? [{ label: t('pageMenu.turnIntoPage'), icon: FileText, onSelect: () => turnIntoPage(pageId) }]
      : []),
    ...(desktop?.vault && getSession().pathOf(pageId) !== null
      ? [{ label: t('pageMenu.showInFolder'), icon: FolderOpen, onSelect: () => revealPage(pageId) }]
      : []),
    ...(page.kind === 'page' && getSession().supportsEncryption
      ? page.encrypted
        ? getSession().unreadable.has(pageId)
          ? []
          : [
              {
                label: t('pageMenu.lockNow'),
                icon: Lock,
                onSelect: () => void getSession().lockPage(pageId),
              },
              {
                label: t('pageMenu.removeEncryption'),
                icon: LockOpen,
                onSelect: () => void getSession().unprotectPage(pageId),
              },
            ]
        : [
            {
              label: t('pageMenu.encryptWithPassword'),
              icon: Lock,
              onSelect: () => openDialog({ kind: 'encrypt', pageId }),
            },
          ]
      : []),
    ...(page.kind === 'page' && !getSession().unreadable.has(pageId)
      ? [
          getUi().sourceMode === pageId
            ? {
                label: t('pageMenu.backToEditor'),
                icon: FileText,
                onSelect: () => setUi({ sourceMode: null }),
              }
            : {
                label: t('pageMenu.editAsMarkdown'),
                icon: FileCode2,
                onSelect: () => setUi({ sourceMode: pageId }),
              },
        ]
      : []),
    { separator: true },
    { label: t('pageMenu.exportMarkdown'), icon: FileDown, onSelect: () => void exportPageMarkdown(pageId) },
    ...(desktop && page.kind !== 'canvas'
      ? [{ label: t('pageMenu.exportPdf'), icon: FileText, onSelect: () => void exportPagePdf(pageId) }]
      : []),
    { label: t('pageMenu.publishWebsite'), icon: Globe, onSelect: () => void publishSite(pageId) },
    { label: t('pageMenu.importMarkdownHere'), icon: FileUp, onSelect: () => void importMarkdown(pageId) },
    { separator: true },
    page.archivedAt === null
      ? { label: t('pageMenu.archive'), icon: Archive, onSelect: () => setArchived(pageId, true) }
      : { label: t('pageMenu.unarchive'), icon: ArchiveRestore, onSelect: () => setArchived(pageId, false) },
    {
      label: t('pageMenu.moveToTrash'),
      icon: Trash2,
      danger: true,
      shortcut: 'Del',
      onSelect: () => trashPage(pageId),
    },
  ];
}
