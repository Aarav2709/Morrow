// calendars from other apps shown beside the tasks: an .ics file brought in once, or a calendar followed by
// its address and fetched again now and then. kept for the vault in .morrow/calendars.json, so they sync
import { useSyncExternalStore } from 'react';
import { parseIcs } from '../core/ics';
import type { CalendarEvent } from '../core/ics';
import { desktop } from './platform/desktop';
import { newId } from './platform/files';

export interface ExternalCalendar {
  id: string;
  name: string;
  // the address it is fetched from, null for a file brought in once
  url: string | null;
  events: CalendarEvent[];
  updatedAt: number;
}

const FILE = '.morrow/calendars.json';
// a followed calendar is fetched again once it is this old
const REFRESH_MS = 60 * 60 * 1000;
const MAX_EVENTS = 5000;
let calendars: ExternalCalendar[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: ExternalCalendar[]): void {
  calendars = next;
  listeners.forEach((listener) => listener());
}

function read(raw: unknown): ExternalCalendar[] {
  const list = (raw as { calendars?: unknown } | null)?.calendars;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 30).flatMap((item: Partial<ExternalCalendar>) =>
    item && typeof item.id === 'string' && typeof item.name === 'string' && Array.isArray(item.events)
      ? [
          {
            id: item.id,
            name: item.name.slice(0, 80),
            url: typeof item.url === 'string' ? item.url : null,
            events: item.events
              .filter(
                (event): event is CalendarEvent =>
                  !!event && typeof event.date === 'string' && typeof event.title === 'string',
              )
              .slice(0, MAX_EVENTS),
            updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
          },
        ]
      : [],
  );
}

export function loadCalendars(): Promise<void> {
  loaded ??= (async () => {
    try {
      const text = await desktop?.vault?.readText(FILE);
      publish(text ? read(JSON.parse(text)) : []);
    } catch {
      // no calendars brought in yet
    }
  })();
  return loaded;
}

export function useCalendars(): ExternalCalendar[] {
  void loadCalendars();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => calendars,
  );
}

async function save(next: ExternalCalendar[]): Promise<void> {
  await loadCalendars();
  publish(next);
  await desktop?.vault?.apply([
    { op: 'write', path: FILE, text: `${JSON.stringify({ calendars: next }, null, 2)}\n` },
  ]);
}

// the name a calendar gives itself, or the file's or address's own
function calendarName(text: string, fallback: string): string {
  const name = /^X-WR-CALNAME:(.+)$/m.exec(text)?.[1]?.trim();
  return (name || fallback).slice(0, 80);
}

export async function importCalendarFile(file: File): Promise<number> {
  await loadCalendars();
  const text = await file.text();
  const events = parseIcs(text).slice(0, MAX_EVENTS);
  const name = calendarName(text, file.name.replace(/\.ics$/i, ''));
  await save([...calendars, { id: newId(), name, url: null, events, updatedAt: Date.now() }]);
  return events.length;
}

export async function followCalendar(url: string): Promise<number> {
  await loadCalendars();
  if (!desktop?.fetchCalendar) throw new Error('Not available.');
  const text = await desktop.fetchCalendar(url.trim());
  const events = parseIcs(text).slice(0, MAX_EVENTS);
  const fallback = (() => {
    try {
      return new URL(url.replace(/^webcal:/i, 'https:')).hostname;
    } catch {
      return 'Calendar';
    }
  })();
  await save([
    ...calendars,
    { id: newId(), name: calendarName(text, fallback), url: url.trim(), events, updatedAt: Date.now() },
  ]);
  return events.length;
}

export function removeCalendar(id: string): Promise<void> {
  return save(calendars.filter((calendar) => calendar.id !== id));
}

// followed calendars that are an hour old or more are fetched again, one that can't be reached keeps what
// it had
export async function refreshCalendars(force = false): Promise<void> {
  await loadCalendars();
  if (!desktop?.fetchCalendar) return;
  let changed = false;
  const next = await Promise.all(
    calendars.map(async (calendar) => {
      if (!calendar.url || (!force && Date.now() - calendar.updatedAt < REFRESH_MS)) return calendar;
      try {
        const events = parseIcs(await desktop!.fetchCalendar!(calendar.url)).slice(0, MAX_EVENTS);
        changed = true;
        return { ...calendar, events, updatedAt: Date.now() };
      } catch {
        return calendar;
      }
    }),
  );
  if (changed) await save(next);
}

// every event on each day, from all the calendars
export function eventsByDay(
  list: ExternalCalendar[],
): Map<string, Array<CalendarEvent & { calendar: string }>> {
  const days = new Map<string, Array<CalendarEvent & { calendar: string }>>();
  for (const calendar of list)
    for (const event of calendar.events) {
      const entry = { ...event, calendar: calendar.name };
      const day = days.get(event.date);
      if (day) day.push(entry);
      else days.set(event.date, [entry]);
    }
  for (const day of days.values()) day.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
  return days;
}
