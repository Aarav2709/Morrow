// reminders set on a date in a page. this computer shows them when they are due, and any that came due
// while morrow was closed as soon as it opens
import { displayTitle } from '../core/model';
import { parseDateKey } from '../core/daily';
import { desktop } from './platform/desktop';
import { newId } from './platform/files';
import { getPreferences, setPreferences } from './platform/preferences';
import type { Reminder } from './platform/preferences';
import { dateLocale, t } from './i18n';
import { getState } from './workspace';

const CHECK_EVERY_MS = 30_000;

export function remindersFor(pageId: string, date: string): Reminder[] {
  return getPreferences().reminders.filter((item) => item.pageId === pageId && item.date === date);
}

// a reminder on the day at the given time
export function addReminder(pageId: string, date: string, hour: number, minute = 0): void {
  const day = parseDateKey(date);
  if (!day) return;
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime();
  const reminders = getPreferences().reminders.filter(
    (item) => !(item.pageId === pageId && item.date === date),
  );
  setPreferences({ reminders: [...reminders, { id: newId(), pageId, date, at }] });
}

export function removeReminders(pageId: string, date: string): void {
  setPreferences({
    reminders: getPreferences().reminders.filter((item) => !(item.pageId === pageId && item.date === date)),
  });
}

function remind(now = Date.now()): void {
  const { reminders } = getPreferences();
  const due = reminders.filter((item) => item.at <= now);
  if (!due.length) return;
  setPreferences({ reminders: reminders.filter((item) => item.at > now) });
  const { pages } = getState();
  for (const item of due) {
    const page = pages[item.pageId];
    // a reminder on a page that has gone is let go quietly
    if (!page || page.trashedAt !== null) continue;
    const day = parseDateKey(item.date);
    const when = day
      ? day.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
      : item.date;
    desktop?.notify?.(displayTitle(page), t('reminders.body', { date: when }), page.id);
  }
}

export function startReminders(): () => void {
  remind();
  const timer = setInterval(() => remind(), CHECK_EVERY_MS);
  return () => clearInterval(timer);
}
