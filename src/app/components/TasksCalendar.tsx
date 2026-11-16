import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dateKey, parseDateKey } from '../../core/daily';
import type { WorkspaceState } from '../../core/model';
import { tasksByDay } from '../../core/tasks';
import type { TaskRef } from '../../core/tasks';
import { eventsByDay, useCalendars } from '../calendars';
import { describeTime } from '../editor/Structure';
import { dateLocale, t } from '../i18n';
import { captureToToday } from '../operations';
import { usePreferences } from '../platform/preferences';
import { openPage } from '../router';
import { run } from '../workspace';

export type CalendarMode = 'month' | 'week';

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

// the first day of the week a date is in, from the day weeks start on
function weekOf(date: Date, weekStart: number): Date {
  return addDays(date, -((date.getDay() - weekStart + 7) % 7));
}

// tasks with a date, and events from calendars brought in, on a month or a week. a day picked shows
// everything on it beside the calendar, where a task can be ticked or added for that day
export function TasksCalendar({
  mode,
  tasks,
  state,
}: {
  mode: CalendarMode;
  tasks: TaskRef[];
  state: WorkspaceState;
}) {
  const { weekStart } = usePreferences();
  const calendars = useCalendars();
  const todayKey = dateKey(new Date());
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(todayKey);
  const byDay = useMemo(() => tasksByDay(state, tasks), [state, tasks]);
  const events = useMemo(() => eventsByDay(calendars), [calendars]);

  const days = useMemo(() => {
    if (mode === 'week') {
      const start = weekOf(cursor, weekStart);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    // whole weeks from the one the month starts in to the one it ends in
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const start = weekOf(first, weekStart);
    const end = addDays(weekOf(last, weekStart), 7);
    const count = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    return Array.from({ length: count }, (_, index) => addDays(start, index));
  }, [mode, cursor, weekStart]);

  const shift = (by: number) =>
    setCursor(
      mode === 'week' ? addDays(cursor, by * 7) : new Date(cursor.getFullYear(), cursor.getMonth() + by, 1),
    );
  const title =
    mode === 'month'
      ? cursor.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })
      : `${days[0]!.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })} – ${days[6]!.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const limit = mode === 'month' ? 3 : 50;

  return (
    <div className="tasks-calendar">
      <div className="tasks-calendar-main">
        <div className="tasks-calendar-head">
          <button
            type="button"
            className="icon-button"
            aria-label={mode === 'month' ? t('daily.previousMonth') : t('tasks.previousWeek')}
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <strong>{title}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label={mode === 'month' ? t('daily.nextMonth') : t('tasks.nextWeek')}
            onClick={() => shift(1)}
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className="button small"
            onClick={() => {
              setCursor(new Date());
              setSelected(todayKey);
            }}
          >
            {t('daily.today')}
          </button>
        </div>
        <div className={`tasks-calendar-grid is-${mode}`} role="grid">
          {days.slice(0, 7).map((day) => (
            <span key={`w${day.getDay()}`} className="tasks-calendar-weekday" aria-hidden="true">
              {day.toLocaleDateString(dateLocale(), { weekday: mode === 'month' ? 'short' : 'long' })}
            </span>
          ))}
          {days.map((day) => {
            const key = dateKey(day);
            const dayTasks = byDay.get(key) ?? [];
            const dayEvents = events.get(key) ?? [];
            const items = dayTasks.length + dayEvents.length;
            const outside = mode === 'month' && day.getMonth() !== cursor.getMonth();
            return (
              <div
                key={key}
                role="gridcell"
                tabIndex={0}
                aria-selected={key === selected}
                aria-label={day.toLocaleDateString(dateLocale(), { dateStyle: 'full' })}
                className={`tasks-calendar-day${outside ? ' is-outside' : ''}${key === todayKey ? ' is-today' : ''}${key === selected ? ' is-selected' : ''}`}
                onClick={() => setSelected(key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelected(key);
                  }
                }}
              >
                <span className="tasks-calendar-date">{day.getDate()}</span>
                {dayEvents.slice(0, limit).map((event) => (
                  <span key={`e${event.uid}`} className="calendar-chip is-event" title={event.calendar}>
                    {event.time && <span className="calendar-chip-time">{describeTime(event.time)}</span>}
                    {event.title || t('tasks.untitledEvent')}
                  </span>
                ))}
                {dayTasks.slice(0, Math.max(0, limit - dayEvents.length)).map((task) => (
                  <span
                    key={`t${task.pageId}:${task.index}`}
                    className={`calendar-chip is-task${task.checked ? ' is-done' : ''}`}
                  >
                    {task.text || t('tasks.untitledTask')}
                  </span>
                ))}
                {items > limit && (
                  <span className="calendar-more">{t('tasks.moreOnDay', { count: items - limit })}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <DayAgenda
        dayKey={selected}
        tasks={byDay.get(selected) ?? []}
        events={events.get(selected) ?? []}
        state={state}
      />
    </div>
  );
}

function DayAgenda({
  dayKey,
  tasks,
  events,
  state,
}: {
  dayKey: string;
  tasks: TaskRef[];
  events: ReturnType<typeof eventsByDay> extends Map<string, infer V> ? V : never;
  state: WorkspaceState;
}) {
  const [draft, setDraft] = useState('');
  const date = parseDateKey(dayKey) ?? new Date();
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    // the task goes into that day's daily note, so it is on that day here and in the journal
    if (captureToToday(`[ ] ${text}`, date)) setDraft('');
  };
  return (
    <aside className="tasks-agenda" aria-label={t('tasks.agenda')}>
      <h2 className="tasks-agenda-title">
        {date.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
      </h2>
      {events.length > 0 && (
        <ul className="tasks-agenda-list">
          {events.map((event) => (
            <li key={event.uid} className="tasks-agenda-event">
              <span className="tasks-agenda-time">
                {event.time ? describeTime(event.time) : t('tasks.allDay')}
              </span>
              <span className="tasks-agenda-text">
                {event.title || t('tasks.untitledEvent')}
                <span className="link-row-path">{event.calendar}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {tasks.length > 0 ? (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={`${task.pageId}:${task.index}`} className={`task-row${task.checked ? ' is-done' : ''}`}>
              <label className="task-check">
                <input
                  type="checkbox"
                  checked={task.checked}
                  aria-label={task.text || t('tasks.untitledTask')}
                  onChange={(event) =>
                    run({
                      type: 'task.setChecked',
                      pageId: task.pageId,
                      index: task.index,
                      checked: event.target.checked,
                      now: Date.now(),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="task-text"
                onClick={() => openPage(task.pageId, task.text || null)}
              >
                {task.time && <span className="tasks-agenda-time">{describeTime(task.time)}</span>}
                {task.text || <span className="muted">{t('tasks.untitledTask')}</span>}
                <span className="task-page">{state.pages[task.pageId]?.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        events.length === 0 && <p className="muted small">{t('tasks.nothingOnDay')}</p>
      )}
      <form
        className="tasks-agenda-add"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          className="text-input small"
          placeholder={t('tasks.addForDay')}
          aria-label={t('tasks.addForDay')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="icon-button"
          aria-label={t('tasks.addForDay')}
          disabled={!draft.trim()}
        >
          <Plus size={15} />
        </button>
      </form>
    </aside>
  );
}
