import {
  CalendarCheck,
  Columns2,
  Copy,
  GraduationCap,
  Hash,
  Home,
  Network,
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
  useTabs,
} from '../tabs';
import type { Tab } from '../tabs';
import { useWorkspace } from '../workspace';
import { Menu } from './Menu';
import type { MenuEntry } from './Menu';
import { PageIcon } from './Sidebar';

const VIEWS: Record<string, [string, LucideIcon]> = {
  home: ['Home', Home],
  tasks: ['Tasks', CalendarCheck],
  trash: ['Trash', Trash2],
  tags: ['Tags', Hash],
  review: ['Review', GraduationCap],
  graph: ['Graph', Network],
  search: ['Search', Search],
};

function describe(hash: string, state: WorkspaceState): { title: string; icon: React.ReactNode } {
  const route = parseRoute(hash);
  const page = route.name === 'page' ? state.pages[route.id] : undefined;
  if (page) return { title: displayTitle(page), icon: <PageIcon page={page} /> };
  if (route.name === 'page') return { title: 'Missing page', icon: <Home size={14} /> };
  if (route.name === 'tag') return { title: `#${route.tag}`, icon: <Hash size={14} /> };
  if (route.name === 'search' && route.query)
    return { title: `“${route.query}”`, icon: <Search size={14} /> };
  const [label, Icon] = VIEWS[route.name] ?? ['Home', Home];
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
      { label: 'New tab', icon: Plus, shortcut: formatShortcut('Mod+T'), onSelect: () => openTab() },
      { label: 'Duplicate tab', icon: Copy, onSelect: () => openTab(tab.hash) },
      {
        label: 'Open beside, in a split',
        icon: Columns2,
        onSelect: () => {
          activateTab(tab.id);
          openSide(tab.hash);
        },
      },
      { separator: true },
      {
        label: 'Close tab',
        icon: X,
        shortcut: formatShortcut('Mod+W'),
        disabled: tabs.length < 2,
        onSelect: () => closeTab(tab.id),
      },
      { label: 'Close other tabs', disabled: tabs.length < 2, onSelect: () => closeOtherTabs(tab.id) },
      {
        label: 'Close tabs to the right',
        disabled: index === tabs.length - 1,
        onSelect: () => closeTabsToRight(tab.id),
      },
      {
        label: 'Reopen closed tab',
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
      <div ref={strip} className="tab-strip" role="tablist" aria-label="Open tabs">
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
              className={`tab${tab.id === active ? ' is-active' : ''}`}
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
              onAuxClick={(event) => event.button === 1 && closeTab(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ tab, at: new DOMRect(event.clientX, event.clientY, 0, 0) });
              }}
              onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && activateTab(tab.id)}
            >
              <span className="tab-icon">{main.icon}</span>
              <span className="tab-title">{main.title}</span>
              {side && (
                <span className="tab-split" title={`Split with ${side.title}`}>
                  <Columns2 size={12} />
                </span>
              )}
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`Close ${title}`}
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
        title={`New tab (${formatShortcut('Mod+T')})`}
        aria-label="New tab"
        onClick={() => openTab()}
      >
        <Plus size={14} />
      </button>
      {menu && (
        <Menu
          anchor={menu.at}
          entries={entries(menu.tab)}
          onClose={() => setMenu(null)}
          label="Tab options"
        />
      )}
    </div>
  );
}
