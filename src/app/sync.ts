// pulls changes from your other computers into this vault, the files then flow in like any other outside edit
import { planPull } from '../core/sync';
import { commitEditors } from './editor/commits';
import { desktop } from './platform/desktop';
import type { SyncStatus } from './platform/desktop';
import { t } from './i18n';
import { toast } from './ui';
import { getSession } from './workspace';

const AUTO_SYNC_MS = 90_000;
const AFTER_EDIT_MS = 12_000;

export interface SyncResult {
  ok: boolean;
  received: number;
  conflicts: number;
  error?: string;
}

let running: Promise<SyncResult> | null = null;

// one pull from one computer, then that computer is asked to pull from this one
export async function syncWith(peerId: string, options: { askBack?: boolean } = {}): Promise<SyncResult> {
  running ??= pullFrom(peerId, options.askBack !== false).finally(() => (running = null));
  return running;
}

async function pullFrom(peerId: string, askBack: boolean): Promise<SyncResult> {
  const sync = desktop?.sync;
  const vault = desktop?.vault;
  if (!sync || !vault) return { ok: false, received: 0, conflicts: 0, error: 'Sync needs the desktop app.' };
  try {
    const status = await sync.status();
    const here = await vault.identity();
    const hello = (await sync.request(peerId, { op: 'hello' })) as {
      vaultId: string | null;
      vaultName: string | null;
      name: string;
    };
    if (hello.vaultId !== here.id) {
      return {
        ok: false,
        received: 0,
        conflicts: 0,
        error: hello.vaultId
          ? `${hello.name} has a different vault open (${hello.vaultName}). Open the same vault on both, or copy it over first.`
          : `${hello.name} has no vault open.`,
      };
    }
    commitEditors();
    await getSession().flush();
    const local = await vault.manifest();
    const answer = (await sync.request(peerId, { op: 'manifest', vaultId: here.id })) as {
      manifest?: Record<string, string>;
      error?: string;
    };
    if (!answer.manifest) throw new Error(answer.error ?? 'No list of files came back.');
    const remote = answer.manifest;
    const base = await vault.syncBase(peerId);
    const plan = planPull(local, remote, base, status.name, new Date());
    const nextBase = { ...plan.base };
    let received = 0;
    let conflicts = 0;
    const fetchFile = async (path: string) => {
      const file = (await sync.request(peerId, { op: 'get', vaultId: here.id, path })) as {
        data?: string | null;
      };
      return file.data ?? null;
    };
    for (const action of plan.actions) {
      if (action.kind === 'delete') {
        const results = (await vault.apply([{ op: 'remove', path: action.path }])) as Array<{ ok: boolean }>;
        if (!results[0]?.ok) restore(nextBase, base, action.path);
        continue;
      }
      const data = await fetchFile(action.path);
      if (data === null) {
        restore(nextBase, base, action.path);
        continue;
      }
      if (action.kind === 'conflict') {
        // our version keeps living under a conflict name before theirs takes the file's name
        const ours = await vault.readSynced(action.path);
        if (ours === null || !(await vault.writeSynced(action.copy, ours, null)).ok) {
          restore(nextBase, base, action.path);
          continue;
        }
        conflicts++;
      }
      const written = await vault.writeSynced(action.path, data, local[action.path] ?? null);
      if (written.ok) received++;
      // changed here while syncing, the next sync sorts it out
      else restore(nextBase, base, action.path);
    }
    await vault.saveSyncBase(peerId, nextBase);
    await sync.mark(peerId);
    if (askBack) await sync.request(peerId, { op: 'pull' }).catch(() => undefined);
    return { ok: true, received, conflicts };
  } catch (error) {
    return {
      ok: false,
      received: 0,
      conflicts: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function restore(next: Record<string, string>, base: Record<string, string>, path: string): void {
  if (base[path] === undefined) delete next[path];
  else next[path] = base[path]!;
}

export async function syncAll(quiet = true): Promise<void> {
  const sync = desktop?.sync;
  if (!sync) return;
  let status: SyncStatus;
  try {
    status = await sync.status();
  } catch {
    return;
  }
  if (!status.enabled) return;
  for (const peer of status.peers.filter((item) => item.online || item.reachable)) {
    const result = await syncWith(peer.id);
    if (!result.ok && !quiet)
      toast(t('toasts.syncFailed', { name: peer.name, error: result.error }), { tone: 'error' });
    else if (result.conflicts > 0)
      toast(
        `${result.conflicts} page${result.conflicts === 1 ? ' was' : 's were'} changed on both computers. Both versions are kept, look for “conflict” in the name.`,
        { durationMs: 12_000 },
      );
  }
}

// syncs every so often, soon after edits, and whenever another computer says it has changes
export function startAutoSync(): () => void {
  const sync = desktop?.sync;
  if (!sync) return () => {};
  const interval = setInterval(() => void syncAll(), AUTO_SYNC_MS);
  let soon: ReturnType<typeof setTimeout> | null = null;
  const stopSaves = getSession().queue.subscribe(() => {
    if (getSession().queue.status.state !== 'saved') return;
    if (soon) clearTimeout(soon);
    soon = setTimeout(() => void syncAll(), AFTER_EDIT_MS);
  });
  const stopEvents = sync.onEvent((event) => {
    if (event.type === 'pull-requested') void syncWith(event.peerId, { askBack: false });
    if (event.type === 'paired') toast(t('toasts.pairedWith', { name: event.name }));
  });
  const first = setTimeout(() => void syncAll(), 5000);
  return () => {
    clearInterval(interval);
    clearTimeout(first);
    if (soon) clearTimeout(soon);
    stopSaves();
    stopEvents();
  };
}

// makes a chosen empty folder a copy of the vault open on another computer, then opens it
export async function copyVaultFrom(peerId: string, dir: string): Promise<{ ok: boolean; error?: string }> {
  const sync = desktop?.sync;
  const vault = desktop?.vault;
  if (!sync || !vault) return { ok: false, error: 'Sync needs the desktop app.' };
  const hello = (await sync.request(peerId, { op: 'hello' })) as { vaultId: string | null; name: string };
  if (!hello.vaultId) return { ok: false, error: `${hello.name} has no vault open.` };
  const prepared = await vault.prepareCopy(dir, hello.vaultId);
  if (!prepared.ok) return prepared;
  sessionStorage.setItem('morrow.syncAfterOpen', peerId);
  const selected = await vault.select(dir);
  if (!selected.ok) return { ok: false, error: selected.error ?? 'That folder could not be opened.' };
  window.location.reload();
  return { ok: true };
}
