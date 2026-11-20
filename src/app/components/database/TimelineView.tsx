import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { dateKey, parseDateKey } from '../../../core/daily';
import { displayTitle } from '../../../core/model';
import type { DatabaseDef, PageId, PageMeta, ViewDef } from '../../../core/model';
import { dateLocale, t } from '../../i18n';
import { openPage } from '../../router';
import { run } from '../../workspace';

const DAY = 86_400_000;
export type TimelineScale = 'week' | 'month' | 'quarter';
// how wide a day is at each scale
const DAY_WIDTH: Record<TimelineScale, number> = { week: 44, month: 18, quarter: 6 };

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const daysBetween = (from: Date, to: Date) =>
  Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      DAY,
  );

// where a row sits on the timeline: from its start date to its end date, one day when it has no end or its
// end is before its start
export function rowSpan(
  row: PageMeta,
  startProp: string,
  endProp: string | null | undefined,
): { start: Date; end: Date } | null {
  const start = parseDateKey(String(row.properties[startProp] ?? ''));
  if (!start) return null;
  const end = endProp ? parseDateKey(String(row.properties[endProp] ?? '')) : null;
  return { start, end: end && end >= start ? end : start };
}

// a row's dates moved by whole days, its start, its end, or both at once
export function shiftSpan(
  span: { start: Date; end: Date },
  part: 'move' | 'start' | 'end',
  days: number,
): { start: Date; end: Date } {
  if (part === 'move') return { start: addDays(span.start, days), end: addDays(span.end, days) };
  if (part === 'start') {
    const start = addDays(span.start, days);
    return { start: start > span.end ? span.end : start, end: span.end };
  }
  const end = addDays(span.end, days);
  return { start: span.start, end: end < span.start ? span.start : end };
}

// a row's new dates, written into its properties
function saveSpan(id: PageId, startId: string, endId: string | null, span: { start: Date; end: Date }): void {
  const values: Record<string, string> = { [startId]: dateKey(span.start) };
  if (endId) values[endId] = dateKey(span.end);
  run({ type: 'page.setProperties', id, values, now: Date.now() });
}

// rows as bars across time, from a date to another, moved or stretched by dragging them
export function TimelineView({
  database,
  view,
  rows,
  editable,
}: {
  database: DatabaseDef;
  view: ViewDef;
  rows: PageMeta[];
  editable: boolean;
}) {
  const [scale, setScale] = useState<TimelineScale>('month');
  const [offset, setOffset] = useState(0);
  const [drag, setDrag] = useState<{ id: PageId; part: 'move' | 'start' | 'end'; days: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const startProp = database.properties.find((prop) => prop.id === view.dateProp && prop.type === 'date');
  const endProp = database.properties.find((prop) => prop.id === view.endProp && prop.type === 'date');
  const width = DAY_WIDTH[scale];

  const placed = useMemo(
    () =>
      startProp
        ? rows.flatMap((row) => {
            const span = rowSpan(row, startProp.id, endProp?.id);
            return span ? [{ row, span }] : [];
          })
        : [],
    [rows, startProp, endProp],
  );
  // from a little before the earliest row to a little after the last one, and always around today, read
  // once when the timeline is first shown
  const [today] = useState(() => new Date());
  const [first, last] = useMemo(() => {
    let low = addDays(today, -14);
    let high = addDays(today, 45);
    for (const { span } of placed) {
      if (span.start < low) low = span.start;
      if (span.end > high) high = span.end;
    }
    return [addDays(low, -7), addDays(high, 21)];
  }, [placed, today]);
  const origin = addDays(first, offset);
  const count = Math.max(30, daysBetween(origin, last) + 1);
  const days = Array.from({ length: count }, (_, index) => addDays(origin, index));

  if (!startProp) return <p className="muted db-hint">{t('database.timelineHint')}</p>;
  const unplaced = rows.filter((row) => !placed.some((item) => item.row.id === row.id));

  const save = (row: PageMeta, span: { start: Date; end: Date }) =>
    saveSpan(row.id, startProp.id, endProp?.id ?? null, span);

  const begin = (row: PageMeta, part: 'move' | 'start' | 'end') => (event: React.PointerEvent) => {
    if (!editable || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const span = placed.find((item) => item.row.id === row.id)?.span;
    if (!span) return;
    const x = event.clientX;
    let days = 0;
    const move = (moved: PointerEvent) => {
      days = Math.round((moved.clientX - x) / width);
      setDrag({ id: row.id, part, days });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      // a click without a drag opens the row
      if (days === 0 && part === 'move') openPage(row.id);
      else if (days !== 0) save(row, shiftSpan(span, part, days));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const months: Array<{ label: string; left: number; width: number }> = [];
  days.forEach((day, index) => {
    if (index === 0 || day.getDate() === 1) {
      months.push({
        label: day.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }),
        left: index * width,
        width: 0,
      });
    }
    months[months.length - 1]!.width += width;
  });
  const todayIndex = daysBetween(origin, today);

  return (
    <div className="db-timeline">
      <div className="db-timeline-bar">
        <button
          type="button"
          className="icon-button small"
          aria-label={t('database.timelineEarlier')}
          onClick={() => setOffset(offset - (scale === 'quarter' ? 90 : scale === 'month' ? 30 : 7))}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            setOffset(0);
            requestAnimationFrame(() =>
              scroller.current?.scrollTo({ left: Math.max(0, daysBetween(first, today) * width - 120) }),
            );
          }}
        >
          {t('daily.today')}
        </button>
        <button
          type="button"
          className="icon-button small"
          aria-label={t('database.timelineLater')}
          onClick={() => setOffset(offset + (scale === 'quarter' ? 90 : scale === 'month' ? 30 : 7))}
        >
          <ChevronRight size={14} />
        </button>
        <div className="segmented" role="radiogroup" aria-label={t('database.timelineScale')}>
          {(['week', 'month', 'quarter'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scale === value}
              className={scale === value ? 'is-active' : ''}
              onClick={() => setScale(value)}
            >
              {t(`database.timelineScales.${value}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="db-timeline-scroll" ref={scroller}>
        <div className="db-timeline-grid" style={{ width: count * width + 200 }}>
          <div className="db-timeline-head">
            <div className="db-timeline-corner" />
            <div className="db-timeline-axis" style={{ width: count * width }}>
              {months.map((month) => (
                <span
                  key={month.left}
                  className="db-timeline-month"
                  style={{ left: month.left, width: month.width }}
                >
                  {month.width >= 60 ? month.label : ''}
                </span>
              ))}
              {scale !== 'quarter' &&
                days.map((day, index) => (
                  <span
                    key={dateKey(day)}
                    className={`db-timeline-day${day.getDay() === 0 || day.getDay() === 6 ? ' is-weekend' : ''}`}
                    style={{ left: index * width, width }}
                  >
                    {scale === 'week' || day.getDate() % 5 === 1 ? day.getDate() : ''}
                  </span>
                ))}
            </div>
          </div>
          {placed.map(({ row, span }) => {
            const moving = drag?.id === row.id ? shiftSpan(span, drag.part, drag.days) : span;
            const left = daysBetween(origin, moving.start) * width;
            const length = (daysBetween(moving.start, moving.end) + 1) * width;
            return (
              <div key={row.id} className="db-timeline-row">
                <button type="button" className="db-timeline-title" onClick={() => openPage(row.id)}>
                  {displayTitle(row)}
                </button>
                <div className="db-timeline-lane" style={{ width: count * width }}>
                  {todayIndex >= 0 && todayIndex < count && (
                    <span className="db-timeline-today" style={{ left: todayIndex * width + width / 2 }} />
                  )}
                  <div
                    className={`db-timeline-item${drag?.id === row.id ? ' is-dragging' : ''}`}
                    style={{ left, width: Math.max(length, 6) }}
                    title={`${displayTitle(row)} · ${moving.start.toLocaleDateString(dateLocale())}${
                      endProp ? ` – ${moving.end.toLocaleDateString(dateLocale())}` : ''
                    }`}
                    onPointerDown={begin(row, 'move')}
                  >
                    {editable && endProp && (
                      <span className="db-timeline-handle is-start" onPointerDown={begin(row, 'start')} />
                    )}
                    <span className="db-timeline-label">{length >= 40 ? displayTitle(row) : ''}</span>
                    {editable && endProp && (
                      <span className="db-timeline-handle is-end" onPointerDown={begin(row, 'end')} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {unplaced.length > 0 && (
        <details className="db-timeline-unplaced">
          <summary>{t('database.timelineNoDate', { count: unplaced.length })}</summary>
          <ul>
            {unplaced.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    if (editable) {
                      // a row without a date is put on today, to be dragged where it belongs
                      run({
                        type: 'page.setProperties',
                        id: row.id,
                        values: { [startProp.id]: dateKey(new Date()) },
                        now: Date.now(),
                      });
                    } else openPage(row.id);
                  }}
                >
                  {displayTitle(row)}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
