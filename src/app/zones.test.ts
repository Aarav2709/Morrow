import { describe, expect, it } from 'vitest';
import { zonedMoment, zoneOffsetLabel } from './zones';

describe('times in a picked time zone', () => {
  it('finds the moment a clock there shows', () => {
    expect(new Date(zonedMoment(2026, 10, 18, 9, 0, 'Asia/Kolkata')).toISOString()).toBe(
      '2026-11-18T03:30:00.000Z',
    );
    // new york in summer and in winter
    expect(new Date(zonedMoment(2026, 6, 1, 9, 0, 'America/New_York')).toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    expect(new Date(zonedMoment(2026, 11, 1, 9, 0, 'America/New_York')).toISOString()).toBe(
      '2026-12-01T14:00:00.000Z',
    );
  });

  it('labels a zone by its offset', () => {
    expect(zoneOffsetLabel('Asia/Kolkata')).toBe('UTC+05:30');
    expect(zoneOffsetLabel('UTC')).toBe('UTC+00:00');
  });
});
