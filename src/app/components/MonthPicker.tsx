import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { dateKey, parseDateKey } from '../../core/daily';
import { dateLocale, t } from '../i18n';
import { usePreferences } from '../platform/preferences';
import { Popover } from './Popover';

// the days' first letters from the day weeks start on. 2023-12-31 was a sunday
const weekdays = (weekStart: number) =>
  Array.from({ length: 7 }, (_, index) =>
    new Date(2023, 11, 31 + weekStart + index).toLocaleDateString(dateLocale(), { weekday: 'narrow' }),
  );

// a month at a time, the calendar every date in morrow is picked from: the journal's, a date in a page,
// a database's date. marked days carry a dot, such as days that have a note
export function MonthPicker({
  selected,
  onPick,
  marked,
  markedLabel,
  footer,
}: {
  selected: string | null;
  onPick: (date: Date) => void;
  marked?: ReadonlySet<string>;
  markedLabel?: (date: string) => string;
  footer?: ReactNode;
}) {
  const start = (selected && parseDateKey(selected)) || new Date();
  const [month, setMonth] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1));
  const today = dateKey(new Date());
  const { weekStart } = usePreferences();
  const offset = (month.getDay() - weekStart + 7) % 7;
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
        {weekdays(weekStart).map((day, index) => (
          <span key={`w${index}`} className="daily-calendar-weekday" aria-hidden="true">
            {day}
          </span>
        ))}
        {cells.map((date, index) => {
          if (!date) return <span key={`e${index}`} />;
          const key = dateKey(date);
          const full = date.toLocaleDateString(dateLocale(), { dateStyle: 'full' });
          const isMarked = marked?.has(key) ?? false;
          return (
            <button
              key={key}
              type="button"
              className={`daily-calendar-day${isMarked ? ' has-note' : ''}${key === today ? ' is-today' : ''}${key === selected ? ' is-selected' : ''}`}
              aria-label={isMarked && markedLabel ? markedLabel(full) : full}
              aria-pressed={key === selected}
              data-autofocus={key === selected ? '' : undefined}
              onClick={() => onPick(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <div className="daily-calendar-foot">
        <button
          type="button"
          className="button small daily-calendar-today"
          onClick={() => onPick(new Date())}
        >
          {t('sidebar.today')}
        </button>
        {footer}
      </div>
    </div>
  );
}

// the calendar in a floating panel, for a date to be picked or cleared
export function MonthPickerPopover({
  anchor,
  selected,
  onPick,
  onClear,
  onClose,
  label,
}: {
  anchor: HTMLElement;
  selected: string | null;
  onPick: (key: string) => void;
  onClear?: () => void;
  onClose: () => void;
  label: string;
}) {
  return (
    <Popover anchor={anchor} onClose={onClose} label={label} className="date-picker-popover">
      <MonthPicker
        selected={selected}
        onPick={(date) => {
          onPick(dateKey(date));
          onClose();
        }}
        footer={
          onClear && selected ? (
            <button
              type="button"
              className="button small"
              onClick={() => {
                onClear();
                onClose();
              }}
            >
              <X size={13} /> {t('common.clear')}
            </button>
          ) : null
        }
      />
    </Popover>
  );
}

// a date in a property or a database's cell: the date written out, the calendar opens to change it
export function DateField({
  value,
  onChange,
  label,
  disabled,
  placeholder,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const date = value ? parseDateKey(value) : null;
  return (
    <>
      <button
        type="button"
        className={`prop-input date-field${date ? '' : ' is-empty'}`}
        aria-label={label}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        {date
          ? date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
          : (placeholder ?? '')}
      </button>
      {anchor && (
        <MonthPickerPopover
          anchor={anchor}
          selected={value}
          label={label}
          onPick={(key) => onChange(key)}
          onClear={() => onChange(null)}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
