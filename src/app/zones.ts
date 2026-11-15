// times in a time zone picked in settings rather than the one this computer is in
import { getPreferences } from './platform/preferences';

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function allTimeZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = supported ? supported('timeZone') : [];
  return zones.length ? zones : [systemTimeZone(), 'UTC'];
}

// how far ahead of utc the zone's clocks are at a moment, in milliseconds
function offsetAt(zone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(at / 1000) * 1000;
}

// the moment a clock in the zone shows this day and time. without a zone picked, this computer's clock
export function zonedMoment(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string | null = getPreferences().timeZone,
): number {
  if (!zone) return new Date(year, month, day, hour, minute).getTime();
  const wall = Date.UTC(year, month, day, hour, minute);
  // the offset can change across the guess, a second look settles a day when the clocks go back or on
  let at = wall - offsetAt(zone, wall);
  at = wall - offsetAt(zone, at);
  return at;
}

// a moment as the zone's clock shows it, "UTC+05:30", for the list of zones
export function zoneOffsetLabel(zone: string, at = Date.now()): string {
  const minutes = Math.round(offsetAt(zone, at) / 60_000);
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
