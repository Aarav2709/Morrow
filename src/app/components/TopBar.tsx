import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Check,
  Columns2,
  Loader2,
  Menu as MenuIcon,
  MoreHorizontal,
  PanelLeftOpen,
  Star,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageMeta } from '../../core/model';
import { ancestorsOf } from '../../core/tree';
import { ACTION_SHORTCUTS, formatShortcut, runAction } from '../actions';
import { toggleFavorite } from '../operations';
import { usePreferences } from '../platform/preferences';
import { openPage } from '../router';
import { canGo, closeSide, goBack, goForward, openSide, swapSides, usePane, useTabs } from '../tabs';
import { setUi } from '../ui';
import { getSession, useSaveStatus, useWorkspace } from '../workspace';
import { Menu } from './Menu';
import { dateLocale, useTranslation } from '../i18n';
import type { MenuEntry } from './Menu';
import { exactTime, relativeTime } from './primitives';

export function SidebarToggle() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  return (
    <>
      <button
        type="button"
        className="icon-button mobile-only"
        aria-label={t('topBar.openSidebar')}
        onClick={() => setUi({ mobileSidebar: true })}
      >
        <MenuIcon size={18} strokeWidth={1.75} />
      </button>
      {!prefs.sidebarOpen && (
        <button
          type="button"
          className="icon-button desktop-only"
          aria-label={t('topBar.showSidebar')}
          title={t('topBar.showSidebarWithShortcut', { shortcut: formatShortcut('Mod+\\') })}
          onClick={() => runAction('view.sidebar')}
        >
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </button>
      )}
    </>
  );
}

// back and forward for the side of the window this bar belongs to
function HistoryButtons() {
  const { t } = useTranslation();
  const pane = usePane();
  const { tabs, active } = useTabs();
  const tab = tabs.find((item) => item.id === active);
  const back = tab ? canGo(tab, pane, 'back') : false;
  const forward = tab ? canGo(tab, pane, 'forward') : false;
  return (
    <span className="history-buttons">
      <button
        type="button"
        className="icon-button"
        aria-label={t('topBar.goBack')}
        title={t('topBar.back', { shortcut: formatShortcut(ACTION_SHORTCUTS.back) })}
        disabled={!back}
        onClick={() => goBack(pane)}
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={t('topBar.goForward')}
        title={t('topBar.forward', { shortcut: formatShortcut(ACTION_SHORTCUTS.forward) })}
        disabled={!forward}
        onClick={() => goForward(pane)}
      >
        <ArrowRight size={16} strokeWidth={1.75} />
      </button>
    </span>
  );
}

// opening a split from the first side, closing or swapping it from the second
function SplitButtons() {
  const { t } = useTranslation();
  const pane = usePane();
  const { tabs, active } = useTabs();
  const split = Boolean(tabs.find((item) => item.id === active)?.side);
  if (pane === 'side')
    return (
      <>
        <button
          type="button"
          className="icon-button desktop-only"
          aria-label={t('topBar.swapSplit')}
          title={t('topBar.swapTheTwoSides')}
          onClick={swapSides}
        >
          <ArrowRightLeft size={15} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-button desktop-only"
          aria-label={t('topBar.closeSplit')}
          title={t('topBar.closeThisSide')}
          onClick={closeSide}
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </>
    );
  if (split) return null;
  return (
    <button
      type="button"
      className="icon-button desktop-only"
      aria-label={t('topBar.openSplit')}
      title={t('topBar.openSplitWithShortcut', { shortcut: formatShortcut('Mod+Shift+\\') })}
      onClick={() => openSide()}
    >
      <Columns2 size={16} strokeWidth={1.75} />
    </button>
  );
}

export function SaveIndicator({ editing }: { editing: boolean }) {
  const { t } = useTranslation();
  const status = useSaveStatus();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (status.state === 'error') {
    return (
      <button
        type="button"
        className="save-status is-error"
        role="alert"
        title={t('topBar.saveError', { error: status.error ?? t('topBar.unknownError') })}
        onClick={() => void getSession().flush()}
      >
        <AlertTriangle size={14} /> <span className="save-label">{t('topBar.saveFailed')}</span>
      </button>
    );
  }
  if (editing || status.state === 'pending' || status.state === 'saving') {
    return (
      <span className="save-status is-saving">
        <Loader2 size={13} className="spin" /> <span className="save-label">{t('topBar.saving')}</span>
      </span>
    );
  }
  return (
    <span
      className="save-status"
      title={
        status.lastSavedAt
          ? t('topBar.savedAt', { time: new Date(status.lastSavedAt).toLocaleTimeString(dateLocale()) })
          : t('topBar.allSavedHere')
      }
    >
      <Check size={14} /> <span className="save-label">{t('topBar.saved')}</span>
    </span>
  );
}

export function TopBar({
  page,
  editing,
  menu,
  children,
}: {
  page?: PageMeta;
  editing?: boolean;
  menu?: () => MenuEntry[];
  children?: ReactNode;
}) {
  const state = useWorkspace();
  const pane = usePane();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { t } = useTranslation();
  const trail = page ? ancestorsOf(state.pages, page.id).reverse() : [];

  return (
    <header className="topbar">
      <div className="topbar-nav">
        {pane === 'main' && <SidebarToggle />}
        <HistoryButtons />
      </div>
      <div className="topbar-center">
        {page ? (
          <nav className="breadcrumbs" aria-label={t('topBar.breadcrumb')}>
            <ol>
              {trail.map((ancestor) => (
                <li key={ancestor.id}>
                  <button
                    type="button"
                    className="crumb"
                    title={displayTitle(ancestor)}
                    onClick={() => openPage(ancestor.id)}
                  >
                    {displayTitle(ancestor)}
                  </button>
                  <span className="crumb-sep" aria-hidden="true">
                    /
                  </span>
                </li>
              ))}
              <li>
                <span className="crumb is-current" aria-current="page" title={displayTitle(page)}>
                  {displayTitle(page)}
                </span>
              </li>
            </ol>
          </nav>
        ) : (
          children
        )}
      </div>
      <div className="topbar-actions">
        {/* saving is the same for both sides of a split, so it shows once */}
        {pane === 'main' && <SaveIndicator editing={editing ?? false} />}
        {page && (
          <>
            <span
              className="topbar-meta"
              title={[
                t('topBar.edited', { time: exactTime(page.updatedAt) }),
                t('topBar.created', { time: exactTime(page.createdAt) }),
              ].join('\n')}
            >
              {t('topBar.edited', { time: relativeTime(page.updatedAt) })}
            </span>
            <button
              type="button"
              className={`icon-button${page.favorite ? ' is-favorite' : ''}`}
              aria-label={page.favorite ? t('pageMenu.removeFromFavorites') : t('pageMenu.addToFavorites')}
              title={page.favorite ? t('pageMenu.removeFromFavorites') : t('pageMenu.addToFavorites')}
              aria-pressed={page.favorite}
              onClick={() => toggleFavorite(page.id)}
            >
              <Star size={16} strokeWidth={1.75} />
            </button>
          </>
        )}
        {menu && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('pageMenu.pageOptions')}
            title={t('pageMenu.pageOptions')}
            aria-haspopup="menu"
            onClick={(event) => setAnchor(event.currentTarget)}
          >
            <MoreHorizontal size={18} strokeWidth={1.75} />
          </button>
        )}
        <SplitButtons />
      </div>
      {anchor && menu && (
        <Menu
          anchor={anchor}
          entries={menu()}
          onClose={() => setAnchor(null)}
          placement="bottom-end"
          label={t('pageMenu.pageOptions')}
        />
      )}
    </header>
  );
}
