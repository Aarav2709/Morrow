import { useSyncExternalStore } from 'react';
import type { Command } from '../core/commands';
import type { WorkspaceState } from '../core/model';
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
  const result = getSession().execute(command);
  if (!result.ok) toast(result.error, { tone: 'error' });
  return result;
}

export function runAll(commands: Command[]): Result<WorkspaceState> {
  const result = getSession().executeAll(commands);
  if (!result.ok) toast(result.error, { tone: 'error' });
  return result;
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
