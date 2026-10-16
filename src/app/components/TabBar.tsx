import { CalendarCheck, GraduationCap, Hash, Home, Network, Plus, Trash2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { displayTitle } from '../../core/model';
import { parseRoute } from '../router';
import { activateTab, closeTab, moveTab, openTab, useTabs } from '../tabs';
import { useWorkspace } from '../workspace';
import { PageIcon } from './Sidebar';

const VIEWS: Record<string, [string, LucideIcon]> = {
  home: ['Home', Home],
  tasks: ['Tasks', CalendarCheck],
  trash: ['Trash', Trash2],
  tags: ['Tags', Hash],
  review: ['Review', GraduationCap],
  graph: ['Graph', Network],
};

// shown once a second tab is open, a single tab needs no bar
export function TabBar() {
  const { tabs, active } = useTabs();
  const state = useWorkspace();
  if (tabs.length < 2) return null;
  return (
    <div className="tab-bar" role="tablist" aria-label="Open tabs">
      {tabs.map((tab, index) => {
        const route = parseRoute(tab.hash);
        const page = route.name === 'page' ? state.pages[route.id] : undefined;
        const [label, Icon] =
          route.name === 'tag' ? [`#${route.tag}`, Hash] : (VIEWS[route.name] ?? ['Page', Home]);
        const title = page ? displayTitle(page) : route.name === 'page' ? 'Missing page' : label;
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
            onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && activateTab(tab.id)}
          >
            <span className="tab-icon">{page ? <PageIcon page={page} /> : <Icon size={14} />}</span>
            <span className="tab-title">{title}</span>
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
          </div>
        );
      })}
      <button
        type="button"
        className="icon-button tab-new"
        title="New tab"
        aria-label="New tab"
        onClick={() => openTab()}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
