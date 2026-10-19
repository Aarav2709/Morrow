import type { PageMeta, WorkspaceState } from './model';
import { livePages } from './tree';

export const JOURNAL_TITLE = 'Journal';

// local calendar date as yyyy mm dd joined by hyphens, which sorts naturally
export function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dailyTitle(date: Date, locale?: string): string {
  return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function findJournal(state: WorkspaceState): PageMeta | null {
  return livePages(state.pages).find((page) => page.kind === 'journal' && page.parentId === null) ?? null;
}

export function findDailyNote(state: WorkspaceState, key: string): PageMeta | null {
  return livePages(state.pages).find((page) => page.dailyDate === key) ?? null;
}

// where a new daily note goes so the journal stays newest first
export function dailyInsertIndex(siblings: PageMeta[], key: string): number {
  const index = siblings.findIndex((page) => page.dailyDate !== null && page.dailyDate < key);
  return index === -1 ? siblings.length : index;
}

// the daily notes written before and after a day, skipping days without one
export function neighbourNotes(
  state: WorkspaceState,
  key: string,
): { previous: PageMeta | null; next: PageMeta | null } {
  let previous: PageMeta | null = null;
  let next: PageMeta | null = null;
  for (const page of livePages(state.pages)) {
    const day = page.dailyDate;
    if (!day || day === key) continue;
    if (day < key && (!previous || day > previous.dailyDate!)) previous = page;
    if (day > key && (!next || day < next.dailyDate!)) next = page;
  }
  return { previous, next };
}

// pages first made on a day, so a daily note shows what came out of it without touching those files
export function pagesMadeOn(state: WorkspaceState, key: string): PageMeta[] {
  return livePages(state.pages)
    .filter(
      (page) =>
        page.dailyDate === null &&
        page.kind !== 'journal' &&
        page.kind !== 'templates' &&
        dateKey(new Date(page.createdAt)) === key,
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

// every day that has a note, for marking a calendar
export function daysWithNotes(state: WorkspaceState): Set<string> {
  const days = new Set<string>();
  for (const page of livePages(state.pages)) if (page.dailyDate) days.add(page.dailyDate);
  return days;
}
