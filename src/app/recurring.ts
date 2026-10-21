// makes the pages repeating templates are due for, when morrow opens and while it stays open
import { dueRecurrences, LAST_KEY, periodStart, withRecurrence } from '../core/recurring';
import type { Repeat } from '../core/recurring';
import { displayTitle } from '../core/model';
import type { PageId } from '../core/model';
import { applyTemplate, fillTemplate, hasPlaceholder } from '../core/templates';
import { isEffectivelyTrashed } from '../core/tree';
import { newId } from './platform/files';
import { openPage } from './router';
import { toast } from './ui';
import { getState, runAll } from './workspace';
import { dateLocale, t } from './i18n';

// the new page's name says which period it is for, like "Weekly review, week of 19 October"
export function periodLabel(repeat: Repeat, date: Date): string {
  const start = periodStart(repeat, date);
  if (repeat === 'monthly') return start.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' });
  const day = start.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
  return repeat === 'weekly' ? t('repeat.weekOf', { day }) : day;
}

export function makeDuePages(now = new Date()): void {
  const state = getState();
  const made: Array<{ id: PageId; title: string }> = [];
  for (const due of dueRecurrences(state, now)) {
    const { template, recurrence, key } = due;
    const parent =
      recurrence.into && state.pages[recurrence.into] && !isEffectivelyTrashed(state.pages, recurrence.into)
        ? recurrence.into
        : null;
    const id = newId();
    // a template whose title has {{date}} in it says where the date goes, the rest get it added at the end
    const title = hasPlaceholder(template.title)
      ? fillTemplate(template.title, { title: '', date: periodStart(recurrence.repeat, now) }).trim()
      : `${displayTitle(template)}, ${periodLabel(recurrence.repeat, now)}`;
    const result = runAll([
      {
        type: 'page.create',
        id,
        parentId: parent,
        now: now.getTime(),
        title,
        icon: template.icon,
        tags: template.tags,
        doc: applyTemplate(state.docs[template.id] ?? { type: 'doc', content: [{ type: 'paragraph' }] }, {
          title,
          date: periodStart(recurrence.repeat, now),
        }),
      },
      {
        type: 'page.setFields',
        id: template.id,
        extra: withRecurrence(template.extra, { [LAST_KEY]: key }),
        now: now.getTime(),
      },
    ]);
    if (result.ok) made.push({ id, title });
  }
  if (made.length === 1)
    toast(t('repeat.madeOne', { title: made[0]!.title }), {
      action: { label: t('common.open'), run: () => openPage(made[0]!.id) },
    });
  else if (made.length > 1) toast(t('repeat.madeMany', { length: made.length }));
}

const CHECK_EVERY_MS = 10 * 60 * 1000;

// checks now, then every few minutes and whenever the window comes back, so a new day is noticed
export function startRecurring(): () => void {
  const check = () => makeDuePages();
  check();
  const timer = setInterval(check, CHECK_EVERY_MS);
  window.addEventListener('focus', check);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', check);
  };
}
