// new versions of morrow. nothing is asked of github until the person turns on checking or presses the
// button, and nothing is installed until they say so
import { useSyncExternalStore } from 'react';
import { openHref } from './editor/EditorMenus';
import { desktop } from './platform/desktop';
import type { UpdateInfo } from './platform/desktop';
import { getPreferences } from './platform/preferences';
import { toast } from './ui';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current' }
  | { kind: 'available'; update: UpdateInfo }
  | { kind: 'installing'; update: UpdateInfo; share: number }
  | { kind: 'error'; message: string; update?: UpdateInfo };

const DAY_MS = 24 * 60 * 60 * 1000;
let state: UpdateState = { kind: 'idle' };
const listeners = new Set<() => void>();

function set(next: UpdateState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!desktop?.updates || state.kind === 'checking' || state.kind === 'installing') return null;
  set({ kind: 'checking' });
  const result = await desktop.updates.check().catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (!result.ok) {
    set({ kind: 'error', message: result.error });
    return null;
  }
  set(result.update ? { kind: 'available', update: result.update } : { kind: 'current' });
  return result.update;
}

// windows and the appimage download, check and restart into the new version, others get the release page
export async function installUpdate(update: UpdateInfo): Promise<void> {
  if (!desktop?.updates || !update.installable) {
    openHref(update.url);
    return;
  }
  set({ kind: 'installing', update, share: 0 });
  const stop = desktop.updates.onProgress((share) => set({ kind: 'installing', update, share }));
  const result = await desktop.updates.install().catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }));
  stop();
  // on success morrow is already closing to start the new version
  if (!result.ok) set({ kind: 'error', message: result.error, update });
}

function offer(update: UpdateInfo): void {
  toast(`Morrow ${update.version} is out.`, {
    durationMs: 15_000,
    action: update.installable
      ? { label: 'Install and restart', run: () => void installUpdate(update) }
      : { label: 'Download', run: () => openHref(update.url) },
  });
}

// when turned on, looks a little after opening and then once a day, and mentions a new version once
export function startUpdateChecks(): () => void {
  if (!desktop?.updates) return () => undefined;
  let offered: string | null = null;
  const look = () => {
    if (!getPreferences().checkUpdates) return;
    void checkForUpdate().then((update) => {
      if (update && update.version !== offered) {
        offered = update.version;
        offer(update);
      }
    });
  };
  const first = setTimeout(look, 15_000);
  const timer = setInterval(look, DAY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
