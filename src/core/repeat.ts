// how a date repeats, written after it the way obsidian's tasks plugin writes it, so the file reads the same
// there: [[2026-11-20]] 🔁 every week, every 2 days, every weekday, every month when done, until a date or
// for a number of times
import { dateKey, parseDateKey } from './daily';

export type RepeatUnit = 'day' | 'week' | 'month' | 'year' | 'weekday';

export interface RepeatRule {
  every: number;
  unit: RepeatUnit;
  // the next one counts from the day it was done rather than the day it was due
  whenDone?: boolean;
  // the last day it may fall on
  until?: string;
  // how many times are left, this one included
  count?: number;
}

export const REPEAT_MARK = '🔁';

const RULE =
  /^every(?: (\d{1,3}))? (weekdays|weekday|weeks|week|days|day|months|month|years|year)( when done)?(?: until (\d{4}-\d{2}-\d{2}))?(?: for (\d{1,4}) times?)?/i;

// a rule from its words, null when they aren't one
export function parseRepeat(text: string): { rule: RepeatRule; length: number } | null {
  const match = RULE.exec(text.trim() === text ? text : text.trimStart());
  if (!match) return null;
  const word = match[2]!.toLowerCase();
  const unit = (word.startsWith('weekday') ? 'weekday' : word.replace(/s$/, '')) as RepeatUnit;
  const rule: RepeatRule = { every: Math.max(1, Number(match[1] ?? 1)), unit };
  if (match[3]) rule.whenDone = true;
  if (match[4] && parseDateKey(match[4])) rule.until = match[4];
  if (match[5]) rule.count = Math.max(1, Number(match[5]));
  return { rule, length: match[0].length };
}

export function formatRepeat(rule: RepeatRule): string {
  const unit = rule.unit === 'weekday' ? 'weekday' : rule.unit;
  const base = rule.every > 1 && unit !== 'weekday' ? `every ${rule.every} ${unit}s` : `every ${unit}`;
  return [
    base,
    rule.whenDone ? ' when done' : '',
    rule.until ? ` until ${rule.until}` : '',
    rule.count ? ` for ${rule.count} ${rule.count === 1 ? 'time' : 'times'}` : '',
  ].join('');
}

const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

// the day after a date the rule falls on next. a month that is too short ends on its last day
export function stepDate(from: Date, rule: RepeatRule): Date {
  switch (rule.unit) {
    case 'day':
      return addDays(from, rule.every);
    case 'week':
      return addDays(from, 7 * rule.every);
    case 'weekday': {
      let next = addDays(from, 1);
      while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1);
      return next;
    }
    case 'month':
    case 'year': {
      const months = rule.unit === 'month' ? rule.every : rule.every * 12;
      const target = new Date(from.getFullYear(), from.getMonth() + months, 1);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      return new Date(target.getFullYear(), target.getMonth(), Math.min(from.getDate(), last));
    }
  }
}

// the next time something due on a day comes round, from the day it was due or the day it was done, and
// the rule it carries on with. null when the rule has run out
export function nextOccurrence(
  date: string,
  rule: RepeatRule,
  doneOn: Date = new Date(),
  end?: string | null,
): { date: string; end: string | null; rule: RepeatRule } | null {
  const due = parseDateKey(date);
  if (!due) return null;
  if (rule.count !== undefined && rule.count <= 1) return null;
  let next = stepDate(rule.whenDone ? doneOn : due, rule);
  // done late, the next one is still after today
  if (!rule.whenDone)
    while (dateKey(next) < dateKey(doneOn) && rule.unit !== 'weekday') next = stepDate(next, rule);
  if (rule.until && dateKey(next) > rule.until) return null;
  const span = end ? Math.round((parseDateKey(end)!.getTime() - due.getTime()) / 86_400_000) : null;
  return {
    date: dateKey(next),
    end: span !== null && span >= 0 ? dateKey(addDays(next, span)) : null,
    rule: rule.count !== undefined ? { ...rule, count: rule.count - 1 } : rule,
  };
}
