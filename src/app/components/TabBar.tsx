import {
  CalendarCheck,
  Columns2,
  Copy,
  GraduationCap,
  Hash,
  Home,
  Network,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { WorkspaceState } from '../../core/model';
import { formatShortcut } from '../actions';
import { t } from '../i18n';
import { parseRoute } from '../router';
import {
  activateTab,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  moveTab,
  openSide,
  openTab,
  reopenClosedTab,
  setTabPinned,
  useTabs,
} from '../tabs';
import type { Tab } from '../tabs';
import { setUi } from '../ui';
import { useWorkspace } from '../workspace';
import { Menu } from './Menu';
import type { MenuEntry } from './Menu';
import { PageIcon } from './Sidebar';

const VIEW_ICONS: Record<string, LucideIcon> = {
  home: Home,
  tasks: CalendarCheck,
  trash: Trash2,
  tags: Hash,
  review: GraduationCap,
  graph: Network,
  search: Search,
};

function getViewTitle(name: string): string {
  switch (name) {
    case 'home':
      return t('settings.general.startPages.home');
    case 'tasks':
      return t('sidebar.tasks');
    case 'trash':
      return t('sidebar.trash');
    case 'tags':
      return t('sidebar.tags');
    case 'review':
      return t('sidebar.review');
    case 'graph':
      return t('sidebar.graph');
    case 'search':
      return t('common.search');
    default:
      return t('settings.general.startPages.home');
  }
}

function describe(hash: string, state: WorkspaceState): { title: string; icon: React.ReactNode } {
  const route = parseRoute(hash);
  const page = route.name === 'page' ? state.pages[route.id] : undefined;
  if (page) return { title: displayTitle(page), icon: <PageIcon page={page} /> };
  if (route.name === 'page') return { title: t('tabs.missingPage'), icon: <Home size={14} /> };
  if (route.name === 'tag') return { title: `#${route.tag}`, icon: <Hash size={14} /> };
  if (route.name === 'search' && route.query)
    return { title: `“${route.query}”`, icon: <Search size={14} /> };
  const label = getViewTitle(route.name);
  const Icon = VIEW_ICONS[route.name] ?? Home;
  return { title: label, icon: <Icon size={14} /> };
}

// every open tab, in the row the window's own buttons sit in
export function TabBar() {
  const { tabs, active, closed } = useTabs();
  const state = useWorkspace();
  const [menu, setMenu] = useState<{ tab: Tab; at: DOMRect } | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  // the tab being shown stays in view when there are more tabs than room
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('.tab.is-active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, tabs.length]);

  const entries = (tab: Tab): MenuEntry[] => {
    const index = tabs.findIndex((item) => item.id === tab.id);
    return [
      { label: t('tabs.newTab'), icon: Plus, shortcut: formatShortcut('Mod+T'), onSelect: () => openTab() },
      tab.pinned
        ? { label: t('tabs.unpinTab'), icon: PinOff, onSelect: () => setTabPinned(tab.id, false) }
        : { label: t('tabs.pinTab'), icon: Pin, onSelect: () => setTabPinned(tab.id, true) },
      { label: t('tabs.duplicateTab'), icon: Copy, onSelect: () => openTab(tab.hash) },
      {
        label: t('tabs.openSplit'),
        icon: Columns2,
        onSelect: () => {
          activateTab(tab.id);
          openSide(tab.hash);
        },
      },
      { separator: true },
      {
        label: t('tabs.closeTab'),
        icon: X,
        shortcut: formatShortcut('Mod+W'),
        disabled: tabs.length < 2 || tab.pinned,
        onSelect: () => closeTab(tab.id),
      },
      { label: t('tabs.closeOtherTabs'), disabled: tabs.length < 2, onSelect: () => closeOtherTabs(tab.id) },
      {
        label: t('tabs.closeTabsToRight'),
        disabled: index === tabs.length - 1,
        onSelect: () => closeTabsToRight(tab.id),
      },
      {
        label: t('tabs.reopenClosedTab'),
        icon: RotateCcw,
        shortcut: formatShortcut('Mod+Shift+T'),
        disabled: closed.length === 0,
        onSelect: reopenClosedTab,
      },
    ];
  };

  return (
    // the bar keeps clear of the window's own buttons, the strip inside it scrolls when tabs run out of room
    <div className={`tab-bar${tabs.length < 2 ? ' is-single' : ''}`}>
      <div ref={strip} className="tab-strip" role="tablist" aria-label={t('tabs.openTabsAria')}>
        {tabs.map((tab, index) => {
          const main = describe(tab.hash, state);
          const side = tab.side ? describe(tab.side.hash, state) : null;
          const title = side ? `${main.title} | ${side.title}` : main.title;
          return (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={tab.id === active}
              className={`tab${tab.id === active ? ' is-active' : ''}${tab.pinned ? ' is-pinned' : ''}`}
              title={title}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/x-morrow-tab', tab.id)}
              onDragOver={(event) =>
                event.dataTransfer.types.includes('text/x-morrow-tab') && event.preventDefault()
              }
              onDrop={(event) => {
                const id = event.dataTransfer.getData('text/x-morrow-tab');
                if (id) moveTab(id, index);
              }}
              onClick={() => activateTab(tab.id)}
              onAuxClick={(event) => event.button === 1 && !tab.pinned && closeTab(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ tab, at: new DOMRect(event.clientX, event.clientY, 0, 0) });
              }}
              onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && activateTab(tab.id)}
            >
              <span className="tab-icon">{main.icon}</span>
              {!tab.pinned && <span className="tab-title">{main.title}</span>}
              {side && !tab.pinned && (
                <span className="tab-split" title={t('tabs.splitWith', { title: side.title })}>
                  <Columns2 size={12} />
                </span>
              )}
              {tabs.length > 1 && !tab.pinned && (
                <button
                  type="button"
                  className="tab-close"
                  aria-label={t('tabs.closeNamedTab', { title })}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="icon-button tab-new"
        title={t('tabs.newTabTitle', { shortcut: formatShortcut('Mod+T') })}
        aria-label={t('tabs.newTab')}
        onClick={() => {
          // a new tab starts at search, to find a page or make one straight away
          openTab();
          setUi({ palette: true });
        }}
      >
        <Plus size={14} />
      </button>
      {menu && (
        <Menu
          anchor={menu.at}
          entries={entries(menu.tab)}
          onClose={() => setMenu(null)}
          label={t('tabs.tabOptions')}
        />
      )}
    </div>
  );
}
