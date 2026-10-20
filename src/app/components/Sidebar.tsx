import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileText,
  FileUp,
  FolderOpen,
  FolderPlus,
  GraduationCap,
  Hash,
  Home,
  LayoutDashboard,
  LayoutTemplate,
  Lock,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Table2,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { dateKey } from '../../core/daily';
import { displayTitle } from '../../core/model';
import type { PageId, PageMeta, WorkspaceState } from '../../core/model';
import { collectTasks } from '../../core/tasks';
import {
  ancestorsOf,
  childrenOf,
  effectiveParent,
  isDescendantOf,
  livePages,
  trashedPages,
} from '../../core/tree';
import { collectCards, dueCards } from '../../core/flashcards';
import { collectTags } from '../../core/tags';
import { useReviewLog } from '../review';
import { formatShortcut, runAction } from '../actions';
import { desktop } from '../platform/desktop';
import { vaultName } from '../platform/vault';
import { chooseVaultFolder, createVault, switchVault } from '../vaults';
import { getSession } from '../workspace';
import { createPage, expandPage, importMarkdown, movePage, openToday, trashPage } from '../operations';
import { getPreferences, setPreferences, usePreferences } from '../platform/preferences';
import { navigate, openPage, useActiveRoute } from '../router';
import { openDialog, setUi, useUi } from '../ui';
import { run, useWorkspace } from '../workspace';
import { Menu } from './Menu';
import { pageMenuEntries } from './pageMenu';
import { Emoji } from './Emoji';
import { Logo } from './primitives';
import { PAGE_DRAG_TYPE } from '../editor/PageLink';

type DropZone = 'before' | 'inside' | 'after';

export function pageIcon(page: PageMeta): LucideIcon {
  if (page.kind === 'journal') return BookOpen;
  if (page.kind === 'database') return Table2;
  if (page.kind === 'canvas') return LayoutDashboard;
  if (page.kind === 'templates') return LayoutTemplate;
  if (page.dailyDate) return CalendarDays;
  return FileText;
}

export function PageIcon({ page }: { page: PageMeta }) {
  if (page.encrypted) return <Lock size={15} strokeWidth={1.75} className="icon-kind-locked" />;
  if (page.icon) return <Emoji emoji={page.icon} />;
  // each kind of page has its own colour when colourful pages are on
  const kind = page.dailyDate ? 'daily' : page.kind;
  const props = { size: 15, strokeWidth: 1.75, className: `icon-kind-${kind}` };
  if (page.kind === 'journal') return <BookOpen {...props} />;
  if (page.kind === 'database') return <Table2 {...props} />;
  if (page.kind === 'canvas') return <LayoutDashboard {...props} />;
  if (page.kind === 'templates') return <LayoutTemplate {...props} />;
  if (page.dailyDate) return <CalendarDays {...props} />;
  return <FileText {...props} />;
}

// the four kinds of page a person can make from the sidebar or a page's menu
export function newPageEntries(parentId: PageId | null) {
  return [
    { label: 'Page', icon: FileText, onSelect: () => createPage({ parentId }) },
    { label: 'Database', icon: Table2, onSelect: () => createPage({ parentId, kind: 'database' }) },
    { label: 'Canvas', icon: LayoutDashboard, onSelect: () => createPage({ parentId, kind: 'canvas' }) },
    {
      label: 'From a template…',
      icon: LayoutTemplate,
      onSelect: () => openDialog({ kind: 'template', parentId }),
    },
  ];
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  hint,
  count,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  hint?: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      className={`nav-item${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.75} />
      <span className="nav-label">{label}</span>
      {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
      {hint && <kbd className="nav-hint">{hint}</kbd>}
    </button>
  );
}

export function Sidebar() {
  const state = useWorkspace();
  const route = useActiveRoute();
  const prefs = usePreferences();
  const activeId = route.name === 'page' ? route.id : null;
  const live = useMemo(() => livePages(state.pages), [state.pages]);
  const favorites = useMemo(
    () => live.filter((page) => page.favorite).sort((a, b) => displayTitle(a).localeCompare(displayTitle(b))),
    [live],
  );
  const trashCount = useMemo(() => trashedPages(state.pages).length, [state.pages]);
  const openTasks = useMemo(() => collectTasks(state).filter((task) => !task.checked).length, [state]);
  const tagCount = useMemo(() => collectTags(state).length, [state]);
  const reviewLog = useReviewLog();
  const cards = useMemo(() => collectCards(state), [state]);
  const dueCount = useMemo(() => dueCards(cards, reviewLog, new Date()).length, [cards, reviewLog]);
  const [newMenu, setNewMenu] = useState<HTMLElement | null>(null);
  const [vaultMenu, setVaultMenu] = useState<{
    anchor: HTMLElement;
    recent: Array<{ path: string; name: string; exists: boolean }>;
  } | null>(null);
  const location = getSession().location;
  const todayKey = dateKey(new Date());
  const isToday = activeId !== null && state.pages[activeId]?.dailyDate === todayKey;
  const resizing = useRef(false);

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    resizing.current = true;
    const startX = event.clientX;
    const startWidth = getPreferences().sidebarWidth;
    const onMove = (move: PointerEvent) => {
      setPreferences({ sidebarWidth: Math.min(420, Math.max(208, startWidth + move.clientX - startX)) });
    };
    const onUp = () => {
      resizing.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const go = (fn: () => void) => () => {
    fn();
    setUi({ mobileSidebar: false });
  };

  return (
    <aside
      className="sidebar"
      aria-label="Sidebar"
      style={{ '--sidebar-width': `${prefs.sidebarWidth}px` } as React.CSSProperties}
    >
      <div className="sidebar-header">
        {location && desktop?.vault ? (
          <button
            type="button"
            className="brand"
            aria-label={`Vault ${vaultName(location)}, switch vault`}
            title={location}
            onClick={(event) => {
              const anchor = event.currentTarget;
              void desktop?.vault?.state().then((vaults) => setVaultMenu({ anchor, recent: vaults.recent }));
            }}
          >
            <Logo size={20} />
            <span className="brand-name">{vaultName(location)}</span>
            <ChevronDown size={13} className="brand-chevron" />
          </button>
        ) : (
          <button
            type="button"
            className="brand"
            onClick={go(() => navigate({ name: 'home' }))}
            aria-label="Morrow home"
          >
            <Logo size={20} />
            <span className="brand-name">Morrow</span>
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label="Hide sidebar"
          title={`Hide sidebar (${formatShortcut('Mod+\\')})`}
          onClick={() => runAction('view.sidebar')}
        >
          <PanelLeftClose size={16} strokeWidth={1.75} />
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="Main">
        <NavItem
          icon={Search}
          label="Search"
          hint={formatShortcut('Mod+K')}
          onClick={() => setUi({ palette: true, mobileSidebar: false })}
        />
        <NavItem icon={CalendarDays} label="Today" active={isToday} onClick={go(() => openToday())} />
        <NavItem
          icon={Home}
          label="Home"
          active={route.name === 'home'}
          onClick={go(() => navigate({ name: 'home' }))}
        />
        <NavItem
          icon={CheckSquare}
          label="Tasks"
          active={route.name === 'tasks'}
          count={openTasks}
          onClick={go(() => navigate({ name: 'tasks' }))}
        />
        <NavItem
          icon={Hash}
          label="Tags"
          active={route.name === 'tags' || route.name === 'tag'}
          count={tagCount}
          onClick={go(() => navigate({ name: 'tags' }))}
        />
        <NavItem
          icon={GraduationCap}
          label="Review"
          active={route.name === 'review'}
          count={dueCount}
          onClick={go(() => navigate({ name: 'review' }))}
        />
        <NavItem
          icon={Network}
          label="Graph"
          active={route.name === 'graph'}
          onClick={go(() => navigate({ name: 'graph', focus: null }))}
        />
        {prefs.assistant && desktop?.assistant && (
          <NavItem
            icon={Sparkles}
            label="Assistant"
            active={prefs.assistantOpen}
            onClick={() => setPreferences({ assistantOpen: !prefs.assistantOpen })}
          />
        )}
      </nav>

      <div className="sidebar-scroll">
        {favorites.length > 0 && (
          <section className="sidebar-section" aria-label="Favourites">
            <h2 className="sidebar-heading">Favourites</h2>
            <ul className="flat-list">
              {favorites.map((page) => {
                return (
                  <li key={page.id}>
                    <button
                      type="button"
                      className={`tree-row flat${activeId === page.id ? ' is-active' : ''}`}
                      onClick={go(() => openPage(page.id))}
                    >
                      <span className="tree-icon">
                        <PageIcon page={page} />
                      </span>
                      <span className="tree-title">{displayTitle(page)}</span>
                      <Star size={12} className="favorite-mark" aria-label="Favourite" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="sidebar-section" aria-label="Pages">
          <div className="sidebar-heading-row">
            <h2 className="sidebar-heading">Pages</h2>
            <button
              type="button"
              className="icon-button small"
              aria-label="New page, database or canvas"
              aria-haspopup="menu"
              title={`New (${formatShortcut('Alt+N')} for a page)`}
              onClick={(event) => setNewMenu(event.currentTarget)}
            >
              <Plus size={15} strokeWidth={1.75} />
            </button>
          </div>
          {live.length === 0 ? (
            <div className="sidebar-empty">
              <p>No pages yet.</p>
              <button type="button" className="link-button" onClick={() => createPage()}>
                Create your first page
              </button>
            </div>
          ) : (
            <PageTree state={state} activeId={activeId} expanded={prefs.expanded} />
          )}
        </section>
      </div>

      <div className="sidebar-footer">
        <NavItem icon={FileUp} label="Import" onClick={() => void importMarkdown()} />
        <NavItem
          icon={Trash2}
          label="Trash"
          active={route.name === 'trash'}
          count={trashCount}
          onClick={go(() => navigate({ name: 'trash' }))}
        />
        <NavItem icon={Settings} label="Settings" onClick={() => openDialog({ kind: 'settings' })} />
      </div>
      {newMenu && (
        <Menu anchor={newMenu} label="New" entries={newPageEntries(null)} onClose={() => setNewMenu(null)} />
      )}
      {vaultMenu && (
        <Menu
          anchor={vaultMenu.anchor}
          label="Vaults"
          onClose={() => setVaultMenu(null)}
          entries={[
            { heading: 'Vaults' },
            ...vaultMenu.recent
              .filter((item) => item.exists)
              .map((item) => ({
                label: item.name,
                checked: item.path === location,
                onSelect: () => {
                  if (item.path !== location) void switchVault(item.path);
                },
              })),
            { separator: true },
            { label: 'Open another folder…', icon: FolderOpen, onSelect: () => void chooseVaultFolder() },
            { label: 'Create a new vault', icon: FolderPlus, onSelect: () => void createVault() },
            { label: 'Show vault folder', icon: FolderOpen, onSelect: () => void desktop?.vault?.reveal('') },
            { separator: true },
            { label: 'Home', icon: Home, onSelect: () => navigate({ name: 'home' }) },
          ]}
        />
      )}
      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={startResize}
      />
    </aside>
  );
}

interface TreeProps {
  state: WorkspaceState;
  activeId: PageId | null;
  expanded: string[];
}

const SUBPAGES_SHOWN = 50;

function PageTree({ state, activeId, expanded }: TreeProps) {
  const ui = useUi();
  const [drop, setDrop] = useState<{ id: PageId; zone: DropZone } | null>(null);
  const [menu, setMenu] = useState<{ id: PageId; anchor: HTMLElement } | null>(null);
  const dragging = useRef<PageId | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  // how many subpages each folder shows, a journal of years opens with its latest days and the rest on request
  const [limits, setLimits] = useState<Record<string, number>>({});

  const ancestorIds = useMemo(
    () => new Set(activeId ? ancestorsOf(state.pages, activeId).map((page) => page.id) : []),
    [activeId, state.pages],
  );
  const expandedSet = useMemo(() => {
    const set = new Set(expanded);
    // the open page is always revealed
    if (activeId) for (const ancestor of ancestorsOf(state.pages, activeId)) set.add(ancestor.id);
    return set;
  }, [expanded, activeId, state.pages]);

  const toggle = (id: PageId) => {
    const current = getPreferences().expanded;
    if (expandedSet.has(id)) {
      setPreferences({ expanded: current.filter((item) => item !== id) });
      if (activeId && ancestorsOf(state.pages, activeId).some((page) => page.id === id)) openPage(id);
    } else setPreferences({ expanded: [...current, id] });
  };

  const onDrop = (target: PageMeta, zone: DropZone) => {
    const id = dragging.current;
    dragging.current = null;
    setDrop(null);
    if (!id || id === target.id) return;
    if (zone === 'inside') {
      if (movePage(id, target.id)) expandPage(target.id);
      return;
    }
    const parentId = effectiveParent(state.pages, target);
    const siblings = childrenOf(state.pages, parentId).filter((page) => page.id !== id);
    const index = siblings.findIndex((page) => page.id === target.id) + (zone === 'after' ? 1 : 0);
    movePage(id, parentId, index);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const rows = Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
    const current = document.activeElement as HTMLElement | null;
    const index = rows.indexOf(current as HTMLElement);
    if (index === -1) return;
    const id = current!.dataset.pageId!;
    const page = state.pages[id];
    if (!page) return;
    const hasChildren = childrenOf(state.pages, id).length > 0;
    const focus = (row: HTMLElement | undefined) => row?.focus();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focus(rows[index + 1]);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focus(rows[index - 1]);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (hasChildren && !expandedSet.has(id)) toggle(id);
        else if (hasChildren) focus(rows[index + 1]);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (hasChildren && expandedSet.has(id)) toggle(id);
        else if (page.parentId) focus(rows.find((row) => row.dataset.pageId === page.parentId));
        break;
      case 'Enter':
        event.preventDefault();
        openPage(id);
        setUi({ mobileSidebar: false });
        break;
      case 'F2':
        event.preventDefault();
        setUi({ renaming: id });
        break;
      case 'Delete':
        event.preventDefault();
        trashPage(id);
        break;
      case 'ContextMenu':
        event.preventDefault();
        setMenu({ id, anchor: current! });
        break;
      case 'F10':
        if (!event.shiftKey) break;
        event.preventDefault();
        setMenu({ id, anchor: current! });
        break;
    }
  };

  const renderLevel = (parentId: PageId | null, depth: number): React.ReactNode => {
    const all = childrenOf(state.pages, parentId);
    if (all.length === 0) return null;
    const key = parentId ?? '';
    let limit = limits[key] ?? SUBPAGES_SHOWN;
    // the open page and the folders on its way always show
    const needed = all.findIndex(
      (page) => page.id === activeId || (expandedSet.has(page.id) && ancestorIds.has(page.id)),
    );
    if (needed >= limit) limit = needed + 1;
    const children = all.length > limit ? all.slice(0, limit) : all;
    const rest = all.length - children.length;
    const rows = children.map((page) => {
      const hasChildren = childrenOf(state.pages, page.id).length > 0;
      const isOpen = expandedSet.has(page.id);
      return (
        <li key={page.id} role="none">
          <TreeRow
            page={page}
            depth={depth}
            hasChildren={hasChildren}
            isOpen={isOpen}
            active={page.id === activeId}
            tabbable={
              activeId ? page.id === activeId : depth === 0 && page === children[0] && parentId === null
            }
            renaming={ui.renaming === page.id}
            dropZone={drop?.id === page.id ? drop.zone : null}
            menuOpen={menu?.id === page.id}
            onToggle={toggle}
            onMenu={(anchor) => setMenu({ id: page.id, anchor })}
            onDragStart={() => (dragging.current = page.id)}
            onDragOverZone={(zone) => {
              const id = dragging.current;
              if (!id || id === page.id || isDescendantOf(state.pages, page.id, id)) {
                setDrop(null);
                return false;
              }
              if (drop?.id !== page.id || drop.zone !== zone) setDrop({ id: page.id, zone });
              return true;
            }}
            onDragLeave={() => setDrop((current) => (current?.id === page.id ? null : current))}
            onDrop={(zone) => onDrop(page, zone)}
          />
          {hasChildren && isOpen && (
            <ul role="group" className="tree-group">
              {renderLevel(page.id, depth + 1)}
            </ul>
          )}
        </li>
      );
    });
    if (rest > 0)
      rows.push(
        <li key="more" role="none">
          <button
            type="button"
            className="tree-row tree-more"
            style={{ '--depth': depth } as React.CSSProperties}
            onClick={() => setLimits((current) => ({ ...current, [key]: limit + SUBPAGES_SHOWN * 4 }))}
          >
            Show {Math.min(rest, SUBPAGES_SHOWN * 4)} more
          </button>
        </li>,
      );
    return rows;
  };

  return (
    <>
      <ul
        className="page-tree"
        role="tree"
        aria-label="Pages"
        ref={treeRef}
        onKeyDown={onKeyDown}
        onDragEnd={() => setDrop(null)}
      >
        {renderLevel(null, 0)}
      </ul>
      {menu && (
        <Menu
          anchor={menu.anchor}
          label="Page options"
          entries={pageMenuEntries(menu.id, () => setUi({ renaming: menu.id }))}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

interface RowProps {
  page: PageMeta;
  depth: number;
  hasChildren: boolean;
  isOpen: boolean;
  active: boolean;
  tabbable: boolean;
  renaming: boolean;
  dropZone: DropZone | null;
  menuOpen: boolean;
  onToggle: (id: PageId) => void;
  onMenu: (anchor: HTMLElement) => void;
  onDragStart: () => void;
  onDragOverZone: (zone: DropZone) => boolean;
  onDragLeave: () => void;
  onDrop: (zone: DropZone) => void;
}

const TreeRow = memo(function TreeRow(props: RowProps) {
  const { page, depth, hasChildren, isOpen, active, tabbable, renaming, dropZone, menuOpen } = props;

  const zoneFor = (event: React.DragEvent): DropZone => {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = (event.clientY - rect.top) / rect.height;
    return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
  };

  return (
    <div
      role="treeitem"
      aria-label={displayTitle(page)}
      tabIndex={tabbable ? 0 : -1}
      aria-level={depth + 1}
      aria-selected={active}
      aria-expanded={hasChildren ? isOpen : undefined}
      data-page-id={page.id}
      className={`tree-row${active ? ' is-active' : ''}${menuOpen ? ' is-menu-open' : ''}${dropZone ? ` drop-${dropZone}` : ''}`}
      style={{ '--depth': depth } as React.CSSProperties}
      draggable={!renaming}
      onClick={() => {
        if (renaming) return;
        openPage(page.id);
        setUi({ mobileSidebar: false });
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        setUi({ renaming: page.id });
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onMenu(event.currentTarget as HTMLElement);
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(PAGE_DRAG_TYPE, page.id);
        event.dataTransfer.setData('text/plain', displayTitle(page));
        event.dataTransfer.effectAllowed = 'move';
        props.onDragStart();
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(PAGE_DRAG_TYPE)) return;
        if (props.onDragOverZone(zoneFor(event))) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }
      }}
      onDragLeave={props.onDragLeave}
      onDrop={(event) => {
        event.preventDefault();
        props.onDrop(zoneFor(event));
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        className={`tree-toggle${hasChildren ? '' : ' is-empty'}`}
        aria-label={isOpen ? 'Collapse' : 'Expand'}
        onClick={(event) => {
          event.stopPropagation();
          if (hasChildren) props.onToggle(page.id);
        }}
      >
        <ChevronRight size={14} strokeWidth={2} className={isOpen ? 'is-open' : ''} />
      </button>
      <span className="tree-icon">
        <PageIcon page={page} />
      </span>
      {renaming ? <RenameInput page={page} /> : <span className="tree-title">{displayTitle(page)}</span>}
      {!renaming && (
        <span className="tree-actions">
          <button
            type="button"
            tabIndex={-1}
            className="icon-button tiny"
            aria-label={`Options for ${displayTitle(page)}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onMenu(event.currentTarget);
            }}
          >
            <MoreHorizontal size={14} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="icon-button tiny"
            aria-label={`Add a subpage to ${displayTitle(page)}`}
            onClick={(event) => {
              event.stopPropagation();
              createPage({ parentId: page.id });
            }}
          >
            <Plus size={14} />
          </button>
        </span>
      )}
    </div>
  );
});

function RenameInput({ page }: { page: PageMeta }) {
  const [value, setValue] = useState(page.title);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && value !== page.title)
      run({ type: 'page.rename', id: page.id, title: value, now: Date.now() });
    setUi({ renaming: null });
    document.querySelector<HTMLElement>(`[role="treeitem"][data-page-id="${page.id}"]`)?.focus();
  };
  return (
    <input
      className="tree-rename"
      aria-label="Page title"
      value={value}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
