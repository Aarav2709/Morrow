// templates that make a new page every day, week or month. a template says how often in its frontmatter,
// next to where the new pages go and the period it last made one for, so the setting travels with the file
import { dateKey } from './daily';
import { displayTitle } from './model';
import type { PageId, PageMeta, WorkspaceState } from './model';
import { listTemplates } from './templates';
import { ancestorsOf, livePages } from './tree';
import { findKey } from './vault/frontmatter';

export const REPEATS = ['daily', 'weekdays', 'weekly', 'monthly'] as const;
export type Repeat = (typeof REPEATS)[number];

export const REPEAT_KEY = 'repeat';
export const INTO_KEY = 'repeat-into';
export const LAST_KEY = 'repeat-last';
export const RECURRENCE_KEYS = [REPEAT_KEY, INTO_KEY, LAST_KEY];

export interface Recurrence {
  repeat: Repeat;
  // the page new pages are made inside, null for the top level
  into: PageId | null;
  // the period the last page was made for, see periodKey
  last: string | null;
}

const valueOf = (page: PageMeta, key: string): unknown => {
  const found = findKey(page.extra, key);
  return found === undefined ? undefined : page.extra[found];
};

export function recurrenceOf(state: WorkspaceState, page: PageMeta): Recurrence | null {
  const repeat = String(valueOf(page, REPEAT_KEY) ?? '')
    .trim()
    .toLowerCase();
  if (!(REPEATS as readonly string[]).includes(repeat)) return null;
  const into = valueOf(page, INTO_KEY);
  const last = valueOf(page, LAST_KEY);
  return {
    repeat: repeat as Repeat,
    into: typeof into === 'string' ? pageAtPath(state, into) : null,
    last: last instanceof Date ? last.toISOString().slice(0, 10) : typeof last === 'string' ? last : null,
  };
}

// a page written as a path of titles, like [[Work/Meetings]], so two pages with one name are told apart
export function pagePath(state: WorkspaceState, id: PageId): string {
  return [...ancestorsOf(state.pages, id).reverse(), state.pages[id]!].map(displayTitle).join('/');
}

export function pageAtPath(state: WorkspaceState, link: string): PageId | null {
  const path = link
    .trim()
    .replace(/^\[\[|\]\]$/g, '')
    .split('|')[0]!
    .trim()
    .toLowerCase();
  if (!path) return null;
  const pages = livePages(state.pages);
  const exact = pages.find((page) => pagePath(state, page.id).toLowerCase() === path);
  if (exact) return exact.id;
  const name = path.split('/').pop();
  return pages.find((page) => displayTitle(page).toLowerCase() === name)?.id ?? null;
}

// names the period a date falls in, null on a day a template does not repeat on
export function periodKey(repeat: Repeat, date: Date): string | null {
  switch (repeat) {
    case 'daily':
      return dateKey(date);
    case 'weekdays':
      return date.getDay() === 0 || date.getDay() === 6 ? null : dateKey(date);
    case 'weekly':
      return dateKey(periodStart('weekly', date));
    case 'monthly':
      return dateKey(date).slice(0, 7);
  }
}

// the first day of the period, weeks start on monday
export function periodStart(repeat: Repeat, date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (repeat === 'weekly') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (repeat === 'monthly') start.setDate(1);
  return start;
}

export interface Due {
  template: PageMeta;
  recurrence: Recurrence;
  key: string;
}

// templates that have not made a page for the period now is in. days missed while morrow was closed are
// not made up for, only the current one
export function dueRecurrences(state: WorkspaceState, now: Date): Due[] {
  return listTemplates(state).flatMap((template) => {
    const recurrence = recurrenceOf(state, template);
    const key = recurrence ? periodKey(recurrence.repeat, now) : null;
    return recurrence && key && recurrence.last !== key ? [{ template, recurrence, key }] : [];
  });
}

// the template's frontmatter with its repeat settings changed, keeping how each key is already spelled
export function withRecurrence(
  extra: Record<string, unknown>,
  changes: Partial<Record<(typeof RECURRENCE_KEYS)[number], string | null>>,
): Record<string, unknown> {
  const next = { ...extra };
  for (const [key, value] of Object.entries(changes)) {
    const existing = findKey(next, key) ?? key;
    if (value === null || value === undefined) delete next[existing];
    else next[existing] = value;
  }
  return next;
}
