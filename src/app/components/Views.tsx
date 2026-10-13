import { CalendarDays, CheckSquare, FileUp, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageId, WorkspaceState } from '../../core/model';
import { collectTasks } from '../../core/tasks';
import type { TaskRef } from '../../core/tasks';
import { ancestorsOf, livePages, trashedPages } from '../../core/tree';
import { formatShortcut } from '../actions';
import { createPage, deleteForever, emptyTrash, importMarkdown, openToday, restorePage } from '../operations';
import { openPage } from '../router';
import { setUi } from '../ui';
import { run, useWorkspace } from '../workspace';
import { Kbd, relativeTime } from './primitives';
import { PageIcon } from './Sidebar';
import { TopBar } from './TopBar';

function greeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function pathOf(state: WorkspaceState, id: PageId): string {
  return ancestorsOf(state.pages, id)
    .reverse()
    .map((page) => displayTitle(page))
    .join(' / ');
}

export function HomeView() {
  const state = useWorkspace();
  const now = new Date();
  const live = useMemo(() => livePages(state.pages), [state.pages]);
  const recent = useMemo(
    () =>
      [...live]
        .filter((page) => page.kind !== 'journal')
        .sort(
          (a, b) => Math.max(b.lastOpenedAt ?? 0, b.updatedAt) - Math.max(a.lastOpenedAt ?? 0, a.updatedAt),
        )
        .slice(0, 8),
    [live],
  );
  const openTasks = collectTasks(state).filter((task) => !task.checked);

  return (
    <div className="view">
      <TopBar />
      <div className="page-scroll">
        <div className="home">
          <header className="home-header">
            <p className="home-date">
              {now.toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
            <h1 className="home-greeting">{greeting(now)}.</h1>
          </header>

          <div className="quick-actions">
            <button type="button" className="quick-action" onClick={() => createPage()}>
              <Plus size={16} strokeWidth={1.75} /> New page <Kbd>{formatShortcut('Alt+N')}</Kbd>
            </button>
            <button type="button" className="quick-action" onClick={() => openToday()}>
              <CalendarDays size={16} strokeWidth={1.75} /> Today's note <Kbd>{formatShortcut('Alt+D')}</Kbd>
            </button>
            <button type="button" className="quick-action" onClick={() => setUi({ palette: true })}>
              <Search size={16} strokeWidth={1.75} /> Search <Kbd>{formatShortcut('Mod+K')}</Kbd>
            </button>
          </div>

          {live.length === 0 ? (
            <section className="home-empty">
              <h2>Your workspace is empty</h2>
              <p>Start with a blank page, or bring in notes you already have as Markdown files.</p>
              <div className="button-row">
                <button type="button" className="button primary" onClick={() => createPage()}>
                  <Plus size={15} /> Create a page
                </button>
                <button type="button" className="button" onClick={() => void importMarkdown()}>
                  <FileUp size={15} /> Import Markdown
                </button>
              </div>
            </section>
          ) : (
            <section className="home-section" aria-labelledby="recent-heading">
              <h2 id="recent-heading" className="section-label">
                Jump back in
              </h2>
              <ul className="link-list">
                {recent.map((page) => {
                  const path = pathOf(state, page.id);
                  return (
                    <li key={page.id}>
                      <button type="button" className="link-row" onClick={() => openPage(page.id)}>
                        <span className="tree-icon">
                          <PageIcon page={page} />
                        </span>
                        <span className="link-row-title">
                          {displayTitle(page)}
                          {path && <span className="link-row-path">{path}</span>}
                        </span>
                        <span className="link-row-meta">
                          {relativeTime(Math.max(page.updatedAt, page.lastOpenedAt ?? 0))}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {openTasks.length > 0 && (
            <section className="home-section" aria-labelledby="tasks-heading">
              <h2 id="tasks-heading" className="section-label">
                Open tasks <span className="section-count">{openTasks.length}</span>
              </h2>
              <TaskList tasks={openTasks.slice(0, 6)} state={state} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskList({
  tasks,
  state,
  grouped = false,
}: {
  tasks: TaskRef[];
  state: WorkspaceState;
  grouped?: boolean;
}) {
  const groups = useMemo(() => {
    const map = new Map<PageId, TaskRef[]>();
    for (const task of tasks) map.set(task.pageId, [...(map.get(task.pageId) ?? []), task]);
    return [...map.entries()];
  }, [tasks]);

  const row = (task: TaskRef, showPage: boolean) => (
    <li key={`${task.pageId}:${task.index}`} className={`task-row${task.checked ? ' is-done' : ''}`}>
      <label className="task-check">
        <input
          type="checkbox"
          checked={task.checked}
          onChange={(event) =>
            run({
              type: 'task.setChecked',
              pageId: task.pageId,
              index: task.index,
              checked: event.target.checked,
              now: Date.now(),
            })
          }
          aria-label={task.text || 'Untitled task'}
        />
      </label>
      <button type="button" className="task-text" onClick={() => openPage(task.pageId, task.text || null)}>
        {task.text || <span className="muted">Untitled task</span>}
      </button>
      {showPage && <span className="task-page">{displayTitle(state.pages[task.pageId])}</span>}
    </li>
  );

  if (!grouped) return <ul className="task-list">{tasks.map((task) => row(task, true))}</ul>;
  return (
    <div className="task-groups">
      {groups.map(([pageId, items]) => (
        <section key={pageId} className="task-group">
          <button type="button" className="task-group-title" onClick={() => openPage(pageId)}>
            {displayTitle(state.pages[pageId])}
          </button>
          <ul className="task-list">{items.map((task) => row(task, false))}</ul>
        </section>
      ))}
    </div>
  );
}

type TaskFilter = 'open' | 'done' | 'all';

export function TasksView() {
  const state = useWorkspace();
  const [filter, setFilter] = useState<TaskFilter>('open');
  const all = useMemo(() => collectTasks(state), [state]);
  const shown = all.filter((task) =>
    filter === 'all' ? true : filter === 'open' ? !task.checked : task.checked,
  );
  const openCount = all.filter((task) => !task.checked).length;

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">Tasks</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection">
          <header className="collection-header">
            <h1>Tasks</h1>
            <p className="muted">
              Every checklist item from your pages, in one place. Ticking one here updates its page.
            </p>
            <div className="segmented" role="radiogroup" aria-label="Show">
              {(['open', 'done', 'all'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={filter === value}
                  className={filter === value ? 'is-active' : ''}
                  onClick={() => setFilter(value)}
                >
                  {value === 'open'
                    ? `Open (${openCount})`
                    : value === 'done'
                      ? `Done (${all.length - openCount})`
                      : `All (${all.length})`}
                </button>
              ))}
            </div>
          </header>
          {shown.length === 0 ? (
            <div className="empty-state compact">
              <CheckSquare size={24} strokeWidth={1.5} />
              <p>
                {all.length === 0
                  ? 'No tasks yet. Type [ ] at the start of a line, or choose Checklist from the / menu, to add one to any page.'
                  : filter === 'open'
                    ? 'Nothing left to do. Nicely done.'
                    : 'Nothing here.'}
              </p>
            </div>
          ) : (
            <TaskList tasks={shown} state={state} grouped />
          )}
        </div>
      </div>
    </div>
  );
}

export function TrashView() {
  const state = useWorkspace();
  const trashed = useMemo(() => trashedPages(state.pages), [state.pages]);

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">Trash</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection">
          <header className="collection-header">
            <h1>Trash</h1>
            <p className="muted">Pages stay here until you delete them. Nothing is removed automatically.</p>
            {trashed.length > 0 && (
              <button type="button" className="button danger" onClick={() => emptyTrash(trashed.length)}>
                <Trash2 size={15} /> Empty trash
              </button>
            )}
          </header>
          {trashed.length === 0 ? (
            <div className="empty-state compact">
              <Trash2 size={24} strokeWidth={1.5} />
              <p>The trash is empty.</p>
            </div>
          ) : (
            <ul className="link-list">
              {trashed.map((page) => {
                const path = pathOf(state, page.id);
                return (
                  <li key={page.id} className="trash-row">
                    <button type="button" className="link-row" onClick={() => openPage(page.id)}>
                      <span className="tree-icon">
                        <PageIcon page={page} />
                      </span>
                      <span className="link-row-title">
                        {displayTitle(page)}
                        {path && <span className="link-row-path">in {path}</span>}
                      </span>
                      <span className="link-row-meta">Trashed {relativeTime(page.trashedAt ?? 0)}</span>
                    </button>
                    <div className="row-actions">
                      <button type="button" className="button small" onClick={() => restorePage(page.id)}>
                        <RotateCcw size={14} /> Restore
                      </button>
                      <button
                        type="button"
                        className="button small danger"
                        onClick={() => deleteForever(page.id)}
                      >
                        Delete forever
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
