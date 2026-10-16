// sync between two of your own computers: each side pulls what changed on the other since they last agreed
import { basename, dirname, extension, joinPath, stripExtension } from './vault/paths';

// path to a hash of the file's bytes
export type Manifest = Record<string, string>;

export type SyncAction =
  | { kind: 'download'; path: string; hash: string }
  // both sides changed the file and theirs wins the name, ours is first kept beside it as copy
  | { kind: 'conflict'; path: string; hash: string; copy: string }
  | { kind: 'delete'; path: string; hash: string };

export interface SyncPlan {
  actions: SyncAction[];
  // what both sides will agree on once the actions are done, saved as the base for next time
  base: Manifest;
}

// morrow's own bookkeeping that is shared, keeping this computer's copy when both changed
const KEEP_LOCAL = new Set(['.morrow/workspace.json', '.morrow/review.json']);

export function isSyncedPath(path: string): boolean {
  if (!path || path.includes('.morrow-tmp-') || path.includes('.morrow-move-')) return false;
  if (KEEP_LOCAL.has(path)) return true;
  // other hidden folders belong to other tools, history and sync state are kept per computer
  return !path.split('/').some((part, index) => part.startsWith('.') && !(index === 0 && part === '.trash'));
}

export function conflictName(path: string, device: string, date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const ext = extension(path);
  const stem = basename(stripExtension(path));
  const safeDevice =
    device
      .replace(/[<>:"/\\|?*#^[\]]/g, ' ')
      .trim()
      .slice(0, 40) || 'another computer';
  return joinPath(dirname(path), `${stem} (conflict from ${safeDevice} ${day})${ext ? `.${ext}` : ''}`);
}

// local and remote are now, base is what both had after the last sync, device names this computer
export function planPull(
  local: Manifest,
  remote: Manifest,
  base: Manifest,
  device: string,
  now: Date,
): SyncPlan {
  const actions: SyncAction[] = [];
  const next: Manifest = {};
  const paths = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)]);
  const taken = new Set(Object.keys(local).map((path) => path.toLowerCase()));
  for (const path of [...paths].sort()) {
    if (!isSyncedPath(path)) continue;
    const l = local[path];
    const r = remote[path];
    const b = base[path];
    if (l === r) {
      if (l !== undefined) next[path] = l;
      continue;
    }
    const remoteChanged = r !== b;
    const localChanged = l !== b;
    if (remoteChanged && !localChanged) {
      // only the other side changed it, take theirs
      if (r === undefined) actions.push({ kind: 'delete', path, hash: l! });
      else {
        actions.push({ kind: 'download', path, hash: r });
        next[path] = r;
      }
      continue;
    }
    if (!remoteChanged && localChanged) {
      // only this side changed it, the other side picks it up when it pulls
      if (b !== undefined) next[path] = b;
      continue;
    }
    // both changed it differently
    if (r === undefined) {
      // deleted there, edited here: the edit wins
      continue;
    }
    if (l === undefined) {
      // deleted here, edited there: the edit wins
      actions.push({ kind: 'download', path, hash: r });
      next[path] = r;
      continue;
    }
    if (KEEP_LOCAL.has(path)) {
      if (b !== undefined) next[path] = b;
      continue;
    }
    // both computers pick the same winner without talking: the larger hash keeps the name,
    // and whichever computer loses saves its own version as a copy named after itself
    if (r > l) {
      let copy = conflictName(path, device, now);
      for (let n = 2; taken.has(copy.toLowerCase()); n++) copy = conflictName(path, `${device} ${n}`, now);
      taken.add(copy.toLowerCase());
      actions.push({ kind: 'conflict', path, hash: r, copy });
      next[path] = r;
    } else if (b !== undefined) next[path] = b;
  }
  return { actions, base: next };
}
