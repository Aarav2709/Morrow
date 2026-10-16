// small facts about a workspace for the home page: streaks, activity, notes worth seeing again
import { dateKey, parseDateKey } from './daily';
import { docToPlainText } from './doc';
import type { PageMeta, WorkspaceState } from './model';
import { livePages } from './tree';

export interface Day {
  key: string;
  count: number;
  future: boolean;
}

// days in a row with something written, counting back from today, or from yesterday when today is still empty
export function streak(activity: Record<string, number>, today: Date): number {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!activity[dateKey(day)]) day.setDate(day.getDate() - 1);
  let count = 0;
  while (activity[dateKey(day)]) {
    count++;
    day.setDate(day.getDate() - 1);
  }
  return count;
}

// columns of weeks, monday first, ending with the week that holds today
export function activityWeeks(activity: Record<string, number>, today: Date, weeks = 26): Day[][] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7);
  const columns: Day[][] = [];
  for (let week = 0; week < weeks; week++) {
    const column: Day[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + weekday);
      const key = dateKey(date);
      column.push({ key, count: activity[key] ?? 0, future: date > end });
    }
    columns.push(column);
  }
  return columns;
}

// daily notes written on this date in earlier years, or a month ago when there are none
export function onThisDay(state: WorkspaceState, today: Date): PageMeta[] {
  const key = dateKey(today);
  const daily = livePages(state.pages).filter((page) => page.dailyDate && page.dailyDate !== key);
  const sameDay = daily.filter((page) => page.dailyDate!.slice(5) === key.slice(5));
  if (sameDay.length) return sameDay.sort((a, b) => b.dailyDate!.localeCompare(a.dailyDate!));
  const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
  return daily.filter((page) => page.dailyDate === dateKey(monthAgo));
}

// an older page with something in it, the same one all day and a different one tomorrow
export function rediscover(state: WorkspaceState, today: Date): PageMeta | null {
  const month = 30 * 24 * 60 * 60 * 1000;
  const now = today.getTime();
  const candidates = livePages(state.pages)
    .filter((page) => page.kind === 'page' && !page.dailyDate)
    .filter((page) => now - Math.max(page.lastOpenedAt ?? 0, page.updatedAt) > month)
    .filter(
      (page) =>
        docToPlainText(state.docs[page.id] ?? { type: 'doc' })
          .split(/\s+/)
          .filter(Boolean).length >= 15,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return null;
  let hash = 0;
  for (const char of dateKey(today)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return candidates[hash % candidates.length]!;
}

export function totalWords(state: WorkspaceState): number {
  let words = 0;
  for (const page of livePages(state.pages)) {
    const doc = state.docs[page.id];
    if (doc) words += docToPlainText(doc).split(/\s+/).filter(Boolean).length;
  }
  return words;
}

export function dayLabel(key: string): string {
  return (
    parseDateKey(key)?.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) ??
    key
  );
}
