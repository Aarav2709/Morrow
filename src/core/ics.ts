// calendars as .ics files, the format google calendar, outlook and apple calendar all read and write. a
// database's rows go out as events on their dates, and events come in as rows

export interface CalendarEvent {
  // yyyy-mm-dd, the day the event is on
  date: string;
  // hh:mm when the event has a time of day
  time: string | null;
  title: string;
  description: string;
  uid: string;
}

const escapeText = (text: string) =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[;,]/g, (char) => `\\${char}`);
const unescapeText = (text: string) =>
  text.replace(/\\([\\;,nN])/g, (_all, char: string) => (char === 'n' || char === 'N' ? '\n' : char));

// lines longer than 75 octets are folded, the way the format asks
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

const compact = (date: string) => date.replace(/-/g, '');
const nextDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1));
  return next.toISOString().slice(0, 10);
};

export function eventsToIcs(name: string, events: CalendarEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Morrow//Morrow//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  for (const event of events) {
    lines.push('BEGIN:VEVENT', `UID:${event.uid}`, `DTSTAMP:${stamp}`);
    if (event.time) {
      // a time of day is local time, the way it was written in the page
      lines.push(`DTSTART:${compact(event.date)}T${event.time.replace(':', '')}00`);
    } else {
      lines.push(
        `DTSTART;VALUE=DATE:${compact(event.date)}`,
        `DTEND;VALUE=DATE:${compact(nextDay(event.date))}`,
      );
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// the events in an .ics file, each on the day it starts. times in utc are moved to this computer's time
export function parseIcs(text: string): CalendarEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events: CalendarEvent[] = [];
  let current: Partial<CalendarEvent> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = { title: '', description: '', time: null };
    else if (line === 'END:VEVENT') {
      if (current?.date)
        events.push({ uid: current.uid ?? `${current.date}-${events.length}`, ...current } as CalendarEvent);
      current = null;
    } else if (current) {
      const colon = line.indexOf(':');
      if (colon < 0) continue;
      const [key, ...params] = line.slice(0, colon).split(';');
      const value = line.slice(colon + 1);
      if (key === 'SUMMARY') current.title = unescapeText(value);
      else if (key === 'DESCRIPTION') current.description = unescapeText(value);
      else if (key === 'UID') current.uid = value;
      else if (key === 'DTSTART') {
        const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/.exec(value);
        if (!match) continue;
        const [, y, m, d, hh, mm, utc] = match;
        if (!hh || params.includes('VALUE=DATE')) {
          current.date = `${y}-${m}-${d}`;
          current.time = null;
        } else {
          const at = utc
            ? new Date(Date.UTC(+y!, +m! - 1, +d!, +hh, +mm!))
            : new Date(+y!, +m! - 1, +d!, +hh, +mm!);
          const pad = (n: number) => String(n).padStart(2, '0');
          current.date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
          current.time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
        }
      }
    }
  }
  return events;
}
