import { CheckSquare, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageId, WorkspaceState } from '../../core/model';
import { collectTasks } from '../../core/tasks';
import type { TaskRef } from '../../core/tasks';
import { ancestorsOf, trashedPages } from '../../core/tree';
import { deleteForever, emptyTrash, restorePage } from '../operations';
import { openPage } from '../router';
import { run, useWorkspace } from '../workspace';
import { relativeTime, useShowMore } from './primitives';
import { PageIcon } from './Sidebar';
import { TopBar } from './TopBar';

function pathOf(state: WorkspaceState, id: PageId): string {
  return ancestorsOf(state.pages, id)
    .reverse()
    .map((page) => displayTitle(page))
    .join(' / ');
}

export function TaskList({
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
    for (const task of tasks) {
      const list = map.get(task.pageId);
      if (list) list.push(task);
      else map.set(task.pageId, [task]);
    }
    return [...map.entries()];
  }, [tasks]);
  const flat = useShowMore(tasks, 100);
  const pages = useShowMore(groups, 40);

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

  if (!grouped)
    return (
      <>
        <ul className="task-list">{flat.shown.map((task) => row(task, true))}</ul>
        {flat.more}
      </>
    );
  return (
    <div className="task-groups">
      {pages.shown.map(([pageId, items]) => (
        <section key={pageId} className="task-group">
          <button type="button" className="task-group-title" onClick={() => openPage(pageId)}>
            {displayTitle(state.pages[pageId])}
          </button>
          <ul className="task-list">{items.map((task) => row(task, false))}</ul>
        </section>
      ))}
      {pages.more}
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
  const listed = useShowMore(trashed, 60);

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
            <>
              <ul className="link-list">
                {listed.shown.map((page) => {
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
              {listed.more}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
