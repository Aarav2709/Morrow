// a database's automations: when a row's property comes to have a value, another of its properties is set,
// such as the date it was finished on when its status becomes Finished
import type { DatabaseDef, PropValue } from './model';

export const TODAY = 'today';

export interface Automation {
  id: string;
  // the property watched, and the value that sets it off: an option of a select, true for a ticked checkbox
  when: { prop: string; value: PropValue };
  // the property set, and its new value, today's date for a date written as today
  then: { prop: string; value: PropValue };
}

function matches(value: PropValue | undefined, wanted: PropValue): boolean {
  if (value === undefined || value === null) return wanted === null || wanted === false;
  if (Array.isArray(value)) return typeof wanted === 'string' && value.includes(wanted);
  if (wanted === true) return value === true;
  return value === wanted;
}

// the values a row's automations set, from what its properties were and are now. only a change into the
// watched value sets one off, so editing other properties later leaves what it set alone
export function automationValues(
  database: DatabaseDef,
  before: Record<string, PropValue>,
  after: Record<string, PropValue>,
  today: string,
): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  for (const automation of database.automations ?? []) {
    const { when, then } = automation;
    if (!database.properties.some((prop) => prop.id === then.prop)) continue;
    if (!matches(after[when.prop], when.value) || matches(before[when.prop], when.value)) continue;
    const value = then.value === TODAY ? today : then.value;
    if (after[then.prop] === value) continue;
    out[then.prop] = value;
  }
  return out;
}

export function normalizeAutomations(raw: unknown): Automation[] {
  if (!Array.isArray(raw)) return [];
  const value = (item: unknown): PropValue | undefined =>
    item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
      ? item
      : undefined;
  return raw.slice(0, 50).flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const when = record.when as Record<string, unknown> | undefined;
    const then = record.then as Record<string, unknown> | undefined;
    if (typeof record.id !== 'string' || !when || !then) return [];
    if (typeof when.prop !== 'string' || typeof then.prop !== 'string') return [];
    const whenValue = value(when.value);
    const thenValue = value(then.value);
    if (whenValue === undefined || thenValue === undefined) return [];
    return [
      {
        id: record.id,
        when: { prop: when.prop, value: whenValue },
        then: { prop: then.prop, value: thenValue },
      },
    ];
  });
}
