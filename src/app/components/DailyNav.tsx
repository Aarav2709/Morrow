import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { MonthPicker } from './MonthPicker';
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
  return (
    <MonthPicker
      selected={selected}
      onPick={onPick}
      marked={days}
      markedLabel={(date) => t('daily.hasNote', { date })}
    />
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
