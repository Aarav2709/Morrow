import { useSyncExternalStore } from 'react';
import type { Command } from '../core/commands';
import type { PageId, PageMeta, WorkspaceState } from '../core/model';
import type { Result } from '../core/result';
import type { SaveStatus } from '../storage/saveQueue';
import type { WorkspaceSession } from '../storage/session';
import { toast } from './ui';

let session: WorkspaceSession | null = null;

export function setSession(next: WorkspaceSession): void {
  session = next;
}

export function getSession(): WorkspaceSession {
  if (!session) throw new Error('Workspace is not open yet.');
  return session;
}

export function getState(): WorkspaceState {
  return getSession().getState();
}

// runs a command and tells the user when it is refused
export function run(command: Command): Result<WorkspaceState> {
  return runAll([command]);
}

export function runAll(commands: Command[]): Result<WorkspaceState> {
  const before = propertySnapshots(commands);
  const result =
    commands.length === 1 ? getSession().execute(commands[0]!) : getSession().executeAll(commands);
  if (!result.ok) toast(result.error, { tone: 'error' });
  else if (before) recordProperties(before);
  return result;
}

// property values and types live outside a page's text, so the editor's undo never sees them. ctrl+z away
// from the text steps back through them here, a type change and the values it converted as one step
const PROPERTY_COMMANDS = new Set<Command['type']>(['database.set', 'page.setProperties', 'page.setFields']);
const MAX_PROPERTY_STEPS = 100;
type Snapshot = Array<{
  id: PageId;
  database: PageMeta['database'];
  properties: PageMeta['properties'];
  extra: PageMeta['extra'];
}>;
let undoStack: Array<{ before: Snapshot; after: Snapshot }> = [];
let redoStack: Array<{ before: Snapshot; after: Snapshot }> = [];
let replaying = false;
let recorded = 0;

function snapshot(ids: PageId[]): Snapshot {
  const pages = getState().pages;
  return ids.flatMap((id) => {
    const page = pages[id];
    return page ? [{ id, database: page.database, properties: page.properties, extra: page.extra }] : [];
  });
}

function propertySnapshots(commands: Command[]): Snapshot | null {
  if (replaying || !session) return null;
  const ids = commands
    .filter((command) => PROPERTY_COMMANDS.has(command.type))
    .map((command) => ('id' in command ? command.id : null));
  return ids.length > 0 ? snapshot([...new Set(ids.filter((id): id is PageId => id !== null))]) : null;
}

function recordProperties(before: Snapshot): void {
  const after = snapshot(before.map((page) => page.id));
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  undoStack = [...undoStack, { before, after }].slice(-MAX_PROPERTY_STEPS);
  redoStack = [];
  recorded += 1;
}

// how many property changes have been recorded, so a field can tell whether its own change was one
export function propertyChangeCount(): number {
  return recorded;
}

export function clearPropertyHistory(): void {
  undoStack = [];
  redoStack = [];
}

// puts the properties back as they were before the last change, false when there is nothing to undo
export function stepProperties(direction: 'undo' | 'redo'): boolean {
  const [from, to] = direction === 'undo' ? [undoStack, redoStack] : [redoStack, undoStack];
  const step = from.pop();
  if (!step) return false;
  const target = direction === 'undo' ? step.before : step.after;
  const pages = getState().pages;
  const commands: Command[] = target.flatMap(({ id, database, properties, extra }): Command[] => {
    const page = pages[id];
    if (!page) return [];
    const now = Date.now();
    return [
      ...(page.kind === 'database' && database ? [{ type: 'database.set' as const, id, database, now }] : []),
      { type: 'page.setFields' as const, id, properties, extra, now },
    ];
  });
  replaying = true;
  try {
    const result = getSession().executeAll(commands);
    if (!result.ok) {
      toast(result.error, { tone: 'error' });
      return true;
    }
  } finally {
    replaying = false;
  }
  to.push(step);
  return true;
}

export function useWorkspace(): WorkspaceState {
  const current = getSession();
  return useSyncExternalStore(current.subscribe, current.getState);
}

export function useSaveStatus(): SaveStatus {
  const queue = getSession().queue;
  return useSyncExternalStore(
    (listener) => queue.subscribe(listener),
    () => queue.status,
  );
}
