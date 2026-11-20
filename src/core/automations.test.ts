import { describe, expect, it } from 'vitest';
import { automationValues, normalizeAutomations, TODAY } from './automations';
import type { DatabaseDef } from './model';

const database: DatabaseDef = {
  properties: [
    { id: 'status', name: 'Status', type: 'select', options: [{ id: 'done', name: 'Done', color: 'green' }] },
    { id: 'finished', name: 'Finished on', type: 'date', options: [] },
    { id: 'tick', name: 'Archived', type: 'checkbox', options: [] },
    { id: 'note', name: 'Note', type: 'text', options: [] },
  ],
  views: [],
  automations: [
    { id: 'a', when: { prop: 'status', value: 'done' }, then: { prop: 'finished', value: TODAY } },
    { id: 'b', when: { prop: 'tick', value: true }, then: { prop: 'note', value: 'Put away' } },
  ],
};

describe('database automations', () => {
  it('set a property when another comes to have the value watched for', () => {
    expect(automationValues(database, {}, { status: 'done' }, '2026-11-20')).toEqual({
      finished: '2026-11-20',
    });
    expect(automationValues(database, { tick: false }, { tick: true }, '2026-11-20')).toEqual({
      note: 'Put away',
    });
  });

  it('stay quiet when the value was already there, so later edits keep what was set', () => {
    expect(
      automationValues(database, { status: 'done' }, { status: 'done', note: 'x' }, '2026-11-21'),
    ).toEqual({});
  });

  it('are read back from a file, broken ones left out', () => {
    expect(
      normalizeAutomations([
        { id: 'a', when: { prop: 'status', value: 'done' }, then: { prop: 'finished', value: 'today' } },
        { id: 'b', when: { prop: 'status' } },
        'nonsense',
      ]),
    ).toHaveLength(1);
  });
});
