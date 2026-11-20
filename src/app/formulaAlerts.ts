// a formula property can notify, the way a reminder does, when a row's value comes to say something, such as
// Overdue or Due today. each row tells once a day, so a value that stays the same doesn't keep notifying
import { dateKey } from '../core/daily';
import { formatValue, formulaResult, rowsOf } from '../core/database';
import { displayTitle } from '../core/model';
import type { FormulaValue } from '../core/formula';
import type { PropDef, WorkspaceState } from '../core/model';
import { desktop } from './platform/desktop';
import { getState } from './workspace';

const KEY = 'morrow.formulaAlerts';
const CHECK_EVERY_MS = 5 * 60 * 1000;

// a value matches what the property watches for: the same words, any case, or a true one when it watches
// for nothing in particular
export function alertMatches(prop: PropDef, value: FormulaValue): boolean {
  if (!prop.notify) return false;
  const wanted = (prop.notifyWhen ?? '').trim().toLowerCase();
  if (!wanted) return value === true || (typeof value === 'number' && value !== 0);
  const text = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value ?? '').toLowerCase();
  return text === wanted || (wanted.length > 2 && text.includes(wanted));
}

// the rows that should notify now, with what to say
export function dueAlerts(
  state: WorkspaceState,
  now: Date,
): Array<{ key: string; pageId: string; title: string; body: string }> {
  const out: Array<{ key: string; pageId: string; title: string; body: string }> = [];
  const day = dateKey(now);
  for (const page of Object.values(state.pages)) {
    if (page.kind !== 'database' || !page.database || page.trashedAt !== null) continue;
    const watched = page.database.properties.filter((prop) => prop.type === 'formula' && prop.notify);
    if (!watched.length) continue;
    for (const row of rowsOf(state, page.id)) {
      if (row.trashedAt !== null || row.archivedAt !== null) continue;
      for (const prop of watched) {
        const { value } = formulaResult(row, prop, page.database);
        if (!alertMatches(prop, value)) continue;
        out.push({
          key: `${row.id}:${prop.id}:${day}`,
          pageId: row.id,
          title: displayTitle(row),
          body: `${prop.name}: ${formatValue(prop, value)}`,
        });
      }
    }
  }
  return out;
}

function told(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function check(): void {
  let state: WorkspaceState;
  try {
    state = getState();
  } catch {
    return;
  }
  const already = told();
  const fresh = dueAlerts(state, new Date()).filter((alert) => !already.includes(alert.key));
  if (!fresh.length) return;
  for (const alert of fresh) desktop?.notify?.(alert.title, alert.body, alert.pageId);
  try {
    localStorage.setItem(KEY, JSON.stringify([...already, ...fresh.map((alert) => alert.key)].slice(-500)));
  } catch {
    // told again next time, at worst
  }
}

export function startFormulaAlerts(): () => void {
  check();
  const timer = setInterval(check, CHECK_EVERY_MS);
  return () => clearInterval(timer);
}
