import { describe, expect, it } from 'vitest';
import { eventsToIcs, parseIcs } from './ics';

describe('ics calendars', () => {
  it('writes events other calendar apps read, and reads them back', () => {
    const events = [
      { uid: 'a@morrow', date: '2026-11-13', time: null, title: 'Feed, the cats', description: '' },
      {
        uid: 'b@morrow',
        date: '2026-11-14',
        time: '17:05',
        title: 'Call',
        description: 'Line one\nline two',
      },
    ];
    const text = eventsToIcs('Plans', events, new Date(Date.UTC(2026, 10, 13)));
    expect(text).toContain('DTSTART;VALUE=DATE:20261113\r\nDTEND;VALUE=DATE:20261114');
    expect(text).toContain('SUMMARY:Feed\\, the cats');
    expect(parseIcs(text)).toEqual(events);
  });

  it('reads folded lines', () => {
    const text = 'BEGIN:VEVENT\r\nDTSTART:20260101\r\nSUMMARY:A long\r\n  title\r\nEND:VEVENT\r\n';
    expect(parseIcs(text)[0]!.title).toBe('A long title');
  });
});
