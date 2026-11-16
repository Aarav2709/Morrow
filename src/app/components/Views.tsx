import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CalendarPlus,
  CheckSquare,
  Download,
  List as ListIcon,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { eventsToIcs } from '../../core/ics';
import type { CalendarEvent } from '../../core/ics';
import { displayTitle } from '../../core/model';
import type { PageId, WorkspaceState } from '../../core/model';
import { collectTasks, tasksByDay } from '../../core/tasks';
import type { TaskRef } from '../../core/tasks';
import { ancestorsOf, archivedPages, trashedPages } from '../../core/tree';
import { deleteForever, emptyTrash, restorePage, setArchived } from '../operations';
import { openPage } from '../router';
import { run, useWorkspace } from '../workspace';
import { relativeTime, useShowMore } from './primitives';
import { PageIcon } from './Sidebar';
import { TopBar } from './TopBar';
import { dateLocale, t } from '../i18n';
import {
  followCalendar,
  importCalendarFile,
  refreshCalendars,
  removeCalendar,
  useCalendars,
} from '../calendars';
import { pickFiles, saveFile } from '../platform/files';
import { setPreferences, usePreferences } from '../platform/preferences';
import type { WeekStart } from '../platform/preferences';
import { toast } from '../ui';
import { Popover } from './Popover';
import { Select } from './Select';
import { TasksCalendar } from './TasksCalendar';
import { describeDate, describeTime } from '../editor/Structure';
import type { CalendarMode } from './TasksCalendar';

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
          aria-label={task.text || t('tasks.untitledTask')}
        />
      </label>
      <button type="button" className="task-text" onClick={() => openPage(task.pageId, task.text || null)}>
        {task.text || <span className="muted">{t('tasks.untitledTask')}</span>}
        {task.date && (
          <span className="task-date">
            {describeDate(task.date)}
            {task.time ? ` ${describeTime(task.time)}` : ''}
          </span>
        )}
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
type TaskLayout = 'list' | CalendarMode;
const LAYOUT_KEY = 'morrow.tasksLayout';

function readLayout(): TaskLayout {
  try {
    const value = localStorage.getItem(LAYOUT_KEY);
    return value === 'month' || value === 'week' ? value : 'list';
  } catch {
    return 'list';
  }
}

export function TasksView() {
  const state = useWorkspace();
  const prefs = usePreferences();
  const [filter, setFilter] = useState<TaskFilter>('open');
  const [layout, setLayoutState] = useState<TaskLayout>(readLayout);
  const [calendarsMenu, setCalendarsMenu] = useState<HTMLElement | null>(null);
  const all = useMemo(() => collectTasks(state), [state]);
  const shown = all.filter((task) =>
    filter === 'all' ? true : filter === 'open' ? !task.checked : task.checked,
  );
  const openCount = all.filter((task) => !task.checked).length;
  const setLayout = (next: TaskLayout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // the layout is only remembered for convenience
    }
  };
  // calendars followed by address are fetched again when they are shown and an hour old
  useEffect(() => {
    if (layout !== 'list') void refreshCalendars();
  }, [layout]);

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{t('tasks.title')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className={`collection${layout === 'list' ? '' : ' is-wide'}`}>
          <header className="collection-header">
            <h1>{t('tasks.title')}</h1>
            <p className="muted">{t('tasks.subtitle')}</p>
            <div className="tasks-bar">
              <div className="segmented" role="radiogroup" aria-label={t('tasks.layout')}>
                {(['list', 'month', 'week'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={layout === value}
                    className={layout === value ? 'is-active' : ''}
                    onClick={() => setLayout(value)}
                  >
                    {value === 'list' ? <ListIcon size={14} /> : <CalendarDays size={14} />}{' '}
                    {t(`tasks.layouts.${value}`)}
                  </button>
                ))}
              </div>
              {layout === 'list' ? (
                <div className="segmented" role="radiogroup" aria-label={t('tasks.showAria')}>
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
                        ? t('tasks.filterOpen', { count: openCount })
                        : value === 'done'
                          ? t('tasks.filterDone', { count: all.length - openCount })
                          : t('tasks.filterAll', { count: all.length })}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <Select<string>
                    label={t('settings.general.weekStart')}
                    value={String(prefs.weekStart)}
                    options={([1, 0, 6] as const).map((day) => ({
                      value: String(day),
                      label: t('tasks.weekStartsOn', {
                        // 2023-12-31 was a sunday
                        day: new Date(2023, 11, 31 + day).toLocaleDateString(dateLocale(), {
                          weekday: 'long',
                        }),
                      }),
                    }))}
                    onChange={(value) => setPreferences({ weekStart: Number(value) as WeekStart })}
                  />
                  <button
                    type="button"
                    className="button small"
                    aria-haspopup="dialog"
                    onClick={(event) => setCalendarsMenu(calendarsMenu ? null : event.currentTarget)}
                  >
                    <CalendarPlus size={14} /> {t('tasks.calendars')}
                  </button>
                </>
              )}
            </div>
          </header>
          {calendarsMenu && (
            <Popover
              anchor={calendarsMenu}
              onClose={() => setCalendarsMenu(null)}
              label={t('tasks.calendars')}
            >
              <CalendarsPanel tasks={all} state={state} />
            </Popover>
          )}
          {layout !== 'list' ? (
            <TasksCalendar mode={layout} tasks={all} state={state} />
          ) : shown.length === 0 ? (
            <div className="empty-state compact">
              <CheckSquare size={24} strokeWidth={1.5} />
              <p>
                {all.length === 0
                  ? t('tasks.emptyAll')
                  : filter === 'open'
                    ? t('tasks.emptyOpen')
                    : t('tasks.emptyDone')}
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

// calendars from other apps shown with the tasks, brought in from a file or followed by their address, and
// the tasks with a date taken out as an .ics file for those apps
function CalendarsPanel({ tasks, state }: { tasks: TaskRef[]; state: WorkspaceState }) {
  const calendars = useCalendars();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const follow = async () => {
    if (!address.trim()) return;
    setBusy(true);
    try {
      const count = await followCalendar(address);
      setAddress('');
      toast(t('tasks.calendarAdded', { count }));
    } catch (error) {
      toast(t('tasks.calendarFailed', { reason: error instanceof Error ? error.message : String(error) }), {
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };
  const importFile = async () => {
    const [file] = await pickFiles('.ics,text/calendar', false);
    if (!file) return;
    const count = await importCalendarFile(file);
    toast(t('tasks.calendarAdded', { count }));
  };
  const exportTasks = () => {
    const days = tasksByDay(state, tasks);
    const events: CalendarEvent[] = [];
    for (const [date, list] of days)
      for (const task of list)
        events.push({
          date,
          time: task.time,
          title: `${task.checked ? '✓ ' : ''}${task.text || t('tasks.untitledTask')}`,
          description: state.pages[task.pageId]?.title ?? '',
          uid: `${task.pageId}-${task.index}@morrow`,
        });
    saveFile('Morrow tasks.ics', eventsToIcs(t('tasks.title'), events), 'text/calendar');
  };
  return (
    <div className="calendars-panel">
      {calendars.length > 0 && (
        <ul className="calendars-list">
          {calendars.map((calendar) => (
            <li key={calendar.id}>
              <span className="calendars-name">
                {calendar.name}
                <span className="link-row-path">
                  {calendar.url
                    ? t('tasks.calendarFollowed', { count: calendar.events.length })
                    : t('tasks.calendarImported', { count: calendar.events.length })}
                </span>
              </span>
              <button
                type="button"
                className="icon-button small"
                aria-label={t('tasks.removeCalendar', { name: calendar.name })}
                title={t('tasks.removeCalendar', { name: calendar.name })}
                onClick={() => void removeCalendar(calendar.id)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="calendars-follow"
        onSubmit={(event) => {
          event.preventDefault();
          void follow();
        }}
      >
        <input
          className="text-input small"
          type="url"
          placeholder={t('tasks.calendarAddress')}
          aria-label={t('tasks.calendarAddress')}
          value={address}
          disabled={busy}
          onChange={(event) => setAddress(event.target.value)}
        />
        <button type="submit" className="button small" disabled={busy || !address.trim()}>
          {t('tasks.follow')}
        </button>
      </form>
      <div className="calendars-actions">
        <button type="button" className="button small" onClick={() => void importFile()}>
          <Upload size={14} /> {t('tasks.importIcs')}
        </button>
        <button type="button" className="button small" onClick={exportTasks}>
          <Download size={14} /> {t('tasks.exportIcs')}
        </button>
      </div>
    </div>
  );
}

export function ArchiveView() {
  const state = useWorkspace();
  const archived = useMemo(() => archivedPages(state.pages), [state.pages]);
  const listed = useShowMore(archived, 60);

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{t('archive.title')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection">
          <header className="collection-header">
            <h1>{t('archive.title')}</h1>
            <p className="muted">{t('archive.subtitle')}</p>
          </header>
          {archived.length === 0 ? (
            <div className="empty-state compact">
              <Archive size={24} strokeWidth={1.5} />
              <p>{t('archive.emptyMessage')}</p>
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
                          {path && <span className="link-row-path">{t('trash.inPath', { path })}</span>}
                        </span>
                        <span className="link-row-meta">
                          {t('archive.archivedAt', { time: relativeTime(page.archivedAt ?? 0) })}
                        </span>
                      </button>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button small"
                          onClick={() => setArchived(page.id, false)}
                        >
                          <ArchiveRestore size={14} /> {t('pageMenu.unarchive')}
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

export function TrashView() {
  const state = useWorkspace();
  const trashed = useMemo(() => trashedPages(state.pages), [state.pages]);
  const listed = useShowMore(trashed, 60);

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{t('trash.title')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection">
          <header className="collection-header">
            <h1>{t('trash.title')}</h1>
            <p className="muted">{t('trash.subtitle')}</p>
            {trashed.length > 0 && (
              <button type="button" className="button danger" onClick={() => emptyTrash(trashed.length)}>
                <Trash2 size={15} /> {t('trash.emptyTrashButton')}
              </button>
            )}
          </header>
          {trashed.length === 0 ? (
            <div className="empty-state compact">
              <Trash2 size={24} strokeWidth={1.5} />
              <p>{t('trash.emptyMessage')}</p>
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
                          {path && <span className="link-row-path">{t('trash.inPath', { path })}</span>}
                        </span>
                        <span className="link-row-meta">
                          {t('trash.trashedAt', { time: relativeTime(page.trashedAt ?? 0) })}
                        </span>
                      </button>
                      <div className="row-actions">
                        <button type="button" className="button small" onClick={() => restorePage(page.id)}>
                          <RotateCcw size={14} /> {t('trash.restore')}
                        </button>
                        <button
                          type="button"
                          className="button small danger"
                          onClick={() => deleteForever(page.id)}
                        >
                          {t('trash.deleteForever')}
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
