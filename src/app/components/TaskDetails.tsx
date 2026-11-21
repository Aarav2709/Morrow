import { ExternalLink, FilePlus2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { dateKey, parseDateKey } from '../../core/daily';
import { displayTitle } from '../../core/model';
import { formatRepeat, parseRepeat } from '../../core/repeat';
import type { RepeatRule, RepeatUnit } from '../../core/repeat';
import { updateTask } from '../../core/tasks';
import type { TaskRef } from '../../core/tasks';
import { t } from '../i18n';
import { createPage } from '../operations';
import { remindersFor, removeReminders, setReminderAt } from '../reminders';
import { openPage } from '../router';
import { getState, run } from '../workspace';
import { zonedMoment } from '../zones';
import { DateField } from './MonthPicker';
import { Switch } from './primitives';

type RepeatChoice = 'none' | 'day' | 'weekday' | 'week' | 'month' | 'year' | 'custom';
type RemindChoice = 'none' | '0' | '5' | '15' | '30' | '60' | '1440';
type EndChoice = 'never' | 'on' | 'after';

const PRESETS: Record<Exclude<RepeatChoice, 'none' | 'custom'>, RepeatRule> = {
  day: { every: 1, unit: 'day' },
  weekday: { every: 1, unit: 'weekday' },
  week: { every: 1, unit: 'week' },
  month: { every: 1, unit: 'month' },
  year: { every: 1, unit: 'year' },
};

function choiceOf(rule: RepeatRule | null): RepeatChoice {
  if (!rule) return 'none';
  if (rule.every === 1 && !rule.whenDone) return rule.unit;
  return 'custom';
}

// a task from the tasks calendar in full: what it is, when it starts and ends or whether it lasts all day,
// when to be reminded, how it repeats and when that stops, and the page it is written in or one of its own
export function TaskDetails({ task, onClose }: { task: TaskRef; onClose: () => void }) {
  const parsed = task.repeat ? (parseRepeat(task.repeat)?.rule ?? null) : null;
  const [text, setText] = useState(task.text);
  const [date, setDate] = useState<string | null>(
    task.date ?? getState().pages[task.pageId]?.dailyDate ?? dateKey(new Date()),
  );
  const [allDay, setAllDay] = useState(!task.time);
  const [time, setTime] = useState(task.time ?? '09:00');
  const [end, setEnd] = useState<string | null>(task.end);
  const [endTime, setEndTime] = useState(task.endTime ?? '10:00');
  const [repeat, setRepeat] = useState<RepeatChoice>(choiceOf(parsed));
  const [every, setEvery] = useState(parsed?.every ?? 1);
  const [unit, setUnit] = useState<RepeatUnit>(parsed?.unit ?? 'week');
  const [whenDone, setWhenDone] = useState(parsed?.whenDone === true);
  const [ends, setEnds] = useState<EndChoice>(parsed?.until ? 'on' : parsed?.count ? 'after' : 'never');
  const [until, setUntil] = useState<string | null>(parsed?.until ?? null);
  const [count, setCount] = useState(parsed?.count ?? 5);
  const existing = task.date ? remindersFor(task.pageId, task.date)[0] : undefined;
  const [remind, setRemind] = useState<RemindChoice>(existing ? '0' : 'none');
  const page = getState().pages[task.pageId];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const rule = (): RepeatRule | null => {
    if (repeat === 'none') return null;
    const base: RepeatRule =
      repeat === 'custom'
        ? { every: Math.max(1, every), unit, ...(whenDone ? { whenDone } : {}) }
        : { ...PRESETS[repeat] };
    if (ends === 'on' && until) base.until = until;
    if (ends === 'after') base.count = Math.max(1, count);
    return base;
  };

  const save = (link?: { id: string; label: string }) => {
    const doc = getState().docs[task.pageId];
    if (!doc) return;
    const ruleNow = rule();
    const next = updateTask(
      doc,
      task.index,
      {
        text,
        date,
        time: allDay ? null : time,
        end: end && date && end >= date ? end : null,
        endTime: allDay ? null : endTime,
        repeat: ruleNow ? formatRepeat(ruleNow) : null,
        ...(link ? { link } : {}),
      },
      task.text,
    );
    if (!next) return;
    run({ type: 'page.setDoc', id: task.pageId, doc: next, now: Date.now() });
    // the reminder follows the task's day and time
    if (task.date) removeReminders(task.pageId, task.date);
    if (date && remind !== 'none') {
      const day = parseDateKey(date)!;
      const [hour, minute] = (allDay ? '09:00' : time).split(':').map(Number);
      const start = zonedMoment(day.getFullYear(), day.getMonth(), day.getDate(), hour ?? 9, minute ?? 0);
      setReminderAt(
        task.pageId,
        date,
        start - Number(remind) * 60_000,
        ruleNow ? formatRepeat(ruleNow) : null,
      );
    }
    onClose();
  };

  const makePage = () => {
    const id = createPage({
      parentId: task.pageId,
      title: text.trim() || t('tasks.untitledTask'),
      open: false,
    });
    if (!id) return;
    save({ id, label: text.trim() || t('tasks.untitledTask') });
    openPage(id);
  };

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        className="dialog task-details"
        role="dialog"
        aria-modal="true"
        aria-label={t('tasks.details')}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="task-details-head">
          <input
            className="task-details-title"
            value={text}
            aria-label={t('tasks.detailsTitle')}
            placeholder={t('tasks.untitledTask')}
            autoFocus
            onChange={(event) => setText(event.target.value)}
          />
          <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="task-details-grid">
          <span>{t('tasks.allDay')}</span>
          <Switch label={t('tasks.allDay')} checked={allDay} onChange={setAllDay} />
          <span>{t('tasks.starts')}</span>
          <span className="task-details-when">
            <DateField label={t('tasks.starts')} value={date} onChange={setDate} />
            {!allDay && (
              <input
                type="time"
                className="text-input small"
                value={time}
                aria-label={t('tasks.startTime')}
                onChange={(event) => setTime(event.target.value)}
              />
            )}
          </span>
          <span>{t('tasks.ends')}</span>
          <span className="task-details-when">
            <DateField
              label={t('tasks.ends')}
              value={end}
              placeholder={t('tasks.sameDay')}
              onChange={setEnd}
            />
            {!allDay && end && (
              <input
                type="time"
                className="text-input small"
                value={endTime}
                aria-label={t('tasks.endTime')}
                onChange={(event) => setEndTime(event.target.value)}
              />
            )}
          </span>
          <span>{t('tasks.remindMe')}</span>
          <select
            className="text-input small"
            value={remind}
            onChange={(event) => setRemind(event.target.value as RemindChoice)}
          >
            <option value="none">{t('tasks.remindNone')}</option>
            <option value="0">{allDay ? t('tasks.remindMorning') : t('tasks.remindAtStart')}</option>
            {!allDay && (
              <>
                <option value="5">{t('tasks.remindBefore', { minutes: 5 })}</option>
                <option value="15">{t('tasks.remindBefore', { minutes: 15 })}</option>
                <option value="30">{t('tasks.remindBefore', { minutes: 30 })}</option>
                <option value="60">{t('tasks.remindHourBefore')}</option>
              </>
            )}
            <option value="1440">{t('tasks.remindDayBefore')}</option>
          </select>
          <span>{t('tasks.repeat')}</span>
          <select
            className="text-input small"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value as RepeatChoice)}
          >
            <option value="none">{t('tasks.repeatNone')}</option>
            <option value="day">{t('tasks.repeatDaily')}</option>
            <option value="weekday">{t('tasks.repeatWeekdays')}</option>
            <option value="week">{t('tasks.repeatWeekly')}</option>
            <option value="month">{t('tasks.repeatMonthly')}</option>
            <option value="year">{t('tasks.repeatYearly')}</option>
            <option value="custom">{t('tasks.repeatCustom')}</option>
          </select>
          {repeat === 'custom' && (
            <>
              <span />
              <span className="task-details-when">
                {t('tasks.every')}
                <input
                  type="number"
                  min={1}
                  max={999}
                  className="text-input small task-details-number"
                  value={every}
                  onChange={(event) => setEvery(Number(event.target.value) || 1)}
                />
                <select
                  className="text-input small"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value as RepeatUnit)}
                >
                  <option value="day">{t('tasks.units.day')}</option>
                  <option value="week">{t('tasks.units.week')}</option>
                  <option value="month">{t('tasks.units.month')}</option>
                  <option value="year">{t('tasks.units.year')}</option>
                </select>
                <label className="task-details-check">
                  <input
                    type="checkbox"
                    checked={whenDone}
                    onChange={(event) => setWhenDone(event.target.checked)}
                  />
                  {t('tasks.fromDone')}
                </label>
              </span>
            </>
          )}
          {repeat !== 'none' && (
            <>
              <span>{t('tasks.repeatEnds')}</span>
              <span className="task-details-when">
                <select
                  className="text-input small"
                  value={ends}
                  onChange={(event) => setEnds(event.target.value as EndChoice)}
                >
                  <option value="never">{t('tasks.endsNever')}</option>
                  <option value="on">{t('tasks.endsOn')}</option>
                  <option value="after">{t('tasks.endsAfter')}</option>
                </select>
                {ends === 'on' && <DateField label={t('tasks.endsOn')} value={until} onChange={setUntil} />}
                {ends === 'after' && (
                  <>
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      className="text-input small task-details-number"
                      value={count}
                      onChange={(event) => setCount(Number(event.target.value) || 1)}
                    />
                    {t('tasks.times')}
                  </>
                )}
              </span>
            </>
          )}
        </div>
        <div className="task-details-foot">
          <button
            type="button"
            className="button small"
            onClick={() => openPage(task.pageId, task.text || null)}
          >
            <ExternalLink size={13} /> {t('tasks.openIn', { title: page ? displayTitle(page) : '' })}
          </button>
          <button type="button" className="button small" onClick={makePage}>
            <FilePlus2 size={13} /> {t('tasks.createPage')}
          </button>
          <span className="task-details-actions">
            <button type="button" className="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="button primary">
              {t('common.save')}
            </button>
          </span>
        </div>
      </form>
    </div>
  );
}
