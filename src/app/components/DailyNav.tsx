import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dateKey, daysWithNotes, neighbourNotes, pagesMadeOn, parseDateKey } from '../../core/daily';
import { displayTitle } from '../../core/model';
import type { PageMeta } from '../../core/model';
import { openToday } from '../operations';
import { openPage } from '../router';
import { useWorkspace } from '../workspace';
import { Popover } from './Popover';
import { relativeTime, useShowMore } from './primitives';
import { PageIcon } from './Sidebar';
import { dateLocale, t } from '../i18n';

const shortDate = (key: string) =>
  parseDateKey(key)?.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) ?? key;

// above a daily note: the notes either side, a calendar of every day, and a way back to today
export function DailyNav({ page }: { page: PageMeta }) {
  const state = useWorkspace();
  const key = page.dailyDate!;
  const today = dateKey(new Date());
  const { previous, next } = useMemo(() => neighbourNotes(state, key), [state, key]);
  const [calendar, setCalendar] = useState<HTMLElement | null>(null);

  return (
    <nav className="daily-nav" aria-label={t('daily.dailyNotes')}>
      <button
        type="button"
        className="daily-nav-step"
        disabled={!previous}
        title={
          previous
            ? t('daily.previousNote', { date: shortDate(previous.dailyDate!) })
            : t('daily.noEarlierNote')
        }
        onClick={() => previous && openPage(previous.id)}
      >
        <ChevronLeft size={15} />
        {previous && <span>{shortDate(previous.dailyDate!)}</span>}
      </button>
      <button
        type="button"
        className="daily-nav-calendar"
        aria-haspopup="dialog"
        onClick={(event) => setCalendar(calendar ? null : event.currentTarget)}
      >
        <CalendarDays size={15} /> {key === today ? t('daily.today') : t('daily.calendar')}
      </button>
      <button
        type="button"
        className="daily-nav-step"
        disabled={!next}
        title={next ? t('daily.nextNote', { date: shortDate(next.dailyDate!) }) : t('daily.noLaterNote')}
        onClick={() => next && openPage(next.id)}
      >
        {next && <span>{shortDate(next.dailyDate!)}</span>}
        <ChevronRight size={15} />
      </button>
      {key !== today && (
        <button type="button" className="button small daily-nav-today" onClick={() => openToday()}>
          {t('daily.goToToday')}
        </button>
      )}
      {calendar && (
        <Popover anchor={calendar} onClose={() => setCalendar(null)} label={t('daily.dailyNotesCalendar')}>
          <DailyCalendar
            selected={key}
            onPick={(date) => {
              setCalendar(null);
              openToday(date);
            }}
          />
        </Popover>
      )}
    </nav>
  );
}

const WEEKDAYS = Array.from({ length: 7 }, (_, index) =>
  new Date(2024, 0, 1 + index).toLocaleDateString(dateLocale(), { weekday: 'narrow' }),
);

// a month at a time, days with a note are marked, any day opens its note and makes it if needed
export function DailyCalendar({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (date: Date) => void;
}) {
  const state = useWorkspace();
  const days = useMemo(() => daysWithNotes(state), [state]);
  const start = (selected && parseDateKey(selected)) || new Date();
  const [month, setMonth] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1));
  const today = dateKey(new Date());
  // weeks start on monday
  const offset = (month.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from(
      { length: count },
      (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1),
    ),
  ];
  const shift = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));

  return (
    <div className="daily-calendar">
      <div className="daily-calendar-head">
        <button
          type="button"
          className="icon-button"
          aria-label={t('daily.previousMonth')}
          onClick={() => shift(-1)}
        >
          <ChevronLeft size={15} />
        </button>
        <strong>{month.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })}</strong>
        <button
          type="button"
          className="icon-button"
          aria-label={t('daily.nextMonth')}
          onClick={() => shift(1)}
        >
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="daily-calendar-grid" role="grid">
        {WEEKDAYS.map((day, index) => (
          <span key={`w${index}`} className="daily-calendar-weekday" aria-hidden="true">
            {day}
          </span>
        ))}
        {cells.map((date, index) => {
          if (!date) return <span key={`e${index}`} />;
          const key = dateKey(date);
          return (
            <button
              key={key}
              type="button"
              className={`daily-calendar-day${days.has(key) ? ' has-note' : ''}${key === today ? ' is-today' : ''}${key === selected ? ' is-selected' : ''}`}
              aria-label={
                days.has(key)
                  ? t('daily.hasNote', { date: date.toLocaleDateString(dateLocale(), { dateStyle: 'full' }) })
                  : date.toLocaleDateString(dateLocale(), { dateStyle: 'full' })
              }
              onClick={() => onPick(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <button type="button" className="button small daily-calendar-today" onClick={() => onPick(new Date())}>
        {t('sidebar.today')}
      </button>
    </div>
  );
}

// below a daily note: what was started that day, found from when each page was made
export function MadeThisDay({ dailyDate }: { dailyDate: string }) {
  const state = useWorkspace();
  const pages = useMemo(() => pagesMadeOn(state, dailyDate), [state, dailyDate]);
  const { shown, more } = useShowMore(pages, 12);
  if (pages.length === 0) return null;
  return (
    <section className="page-section" aria-label={t('daily.madeThisDay')}>
      <h2 className="section-label">
        {t('daily.madeThisDay')} <span className="section-count">{pages.length}</span>
      </h2>
      <ul className="link-list">
        {shown.map((page) => (
          <li key={page.id}>
            <button
              type="button"
              className="link-row"
              data-page-id={page.id}
              onClick={() => openPage(page.id)}
            >
              <span className="tree-icon">
                <PageIcon page={page} />
              </span>
              <span className="link-row-title">{displayTitle(page)}</span>
              <span className="link-row-meta">{relativeTime(page.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      {more}
    </section>
  );
}
