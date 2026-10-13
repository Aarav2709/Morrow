import {
  AlertTriangle,
  Check,
  Loader2,
  Menu as MenuIcon,
  MoreHorizontal,
  PanelLeftOpen,
  Star,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageMeta } from '../../core/model';
import { ancestorsOf } from '../../core/tree';
import { formatShortcut, runAction } from '../actions';
import { toggleFavorite } from '../operations';
import { usePreferences } from '../platform/preferences';
import { openPage } from '../router';
import { setUi } from '../ui';
import { getSession, useSaveStatus, useWorkspace } from '../workspace';
import { Menu } from './Menu';
import type { MenuEntry } from './Menu';
import { relativeTime } from './primitives';

export function SidebarToggle() {
  const prefs = usePreferences();
  return (
    <>
      <button
        type="button"
        className="icon-button mobile-only"
        aria-label="Open sidebar"
        onClick={() => setUi({ mobileSidebar: true })}
      >
        <MenuIcon size={18} strokeWidth={1.75} />
      </button>
      {!prefs.sidebarOpen && (
        <button
          type="button"
          className="icon-button desktop-only"
          aria-label="Show sidebar"
          title={`Show sidebar (${formatShortcut('Mod+\\')})`}
          onClick={() => runAction('view.sidebar')}
        >
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </button>
      )}
    </>
  );
}

export function SaveIndicator({ editing }: { editing: boolean }) {
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
        title={`${status.error ?? 'Unknown error'}. Your changes are kept in memory and will be retried. Click to retry now.`}
        onClick={() => void getSession().flush()}
      >
        <AlertTriangle size={14} /> Not saved, retrying
      </button>
    );
  }
  if (editing || status.state === 'pending' || status.state === 'saving') {
    return (
      <span className="save-status is-saving" role="status">
        <Loader2 size={13} className="spin" /> Saving
      </span>
    );
  }
  return (
    <span
      className="save-status"
      role="status"
      title={
        status.lastSavedAt
          ? `Saved ${new Date(status.lastSavedAt).toLocaleTimeString()}`
          : 'All changes are saved on this device'
      }
    >
      <Check size={14} /> Saved
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const trail = page ? ancestorsOf(state.pages, page.id).reverse() : [];

  return (
    <header className="topbar">
      <div className="topbar-left">
        <SidebarToggle />
        {page ? (
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <ol>
              {trail.map((ancestor) => (
                <li key={ancestor.id}>
                  <button type="button" className="crumb" onClick={() => openPage(ancestor.id)}>
                    {displayTitle(ancestor)}
                  </button>
                  <span className="crumb-sep" aria-hidden="true">
                    /
                  </span>
                </li>
              ))}
              <li>
                <span className="crumb is-current" aria-current="page">
                  {displayTitle(page)}
                </span>
              </li>
            </ol>
          </nav>
        ) : (
          children
        )}
      </div>
      <div className="topbar-right">
        <SaveIndicator editing={editing ?? false} />
        {page && (
          <>
            <span className="topbar-meta desktop-only">Edited {relativeTime(page.updatedAt)}</span>
            <button
              type="button"
              className={`icon-button${page.favorite ? ' is-favorite' : ''}`}
              aria-label={page.favorite ? 'Remove from favourites' : 'Add to favourites'}
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
            aria-label="Page options"
            aria-haspopup="menu"
            onClick={(event) => setAnchor(event.currentTarget)}
          >
            <MoreHorizontal size={18} strokeWidth={1.75} />
          </button>
        )}
      </div>
      {anchor && menu && (
        <Menu
          anchor={anchor}
          entries={menu()}
          onClose={() => setAnchor(null)}
          placement="bottom-end"
          label="Page options"
        />
      )}
    </header>
  );
}
