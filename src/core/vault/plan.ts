// turns a change of layout into file operations the desktop shell carries out in order
import type { PageId } from '../model';
import type { Layout, Placement } from './layout';
import { basename, dirname, joinPath } from './paths';

export type VaultOp =
  // expect is the text the file must still have, null when it must not exist yet, absent to skip the check
  | { op: 'write'; path: string; text: string; expect?: string | null; id?: PageId }
  // optional renames are skipped when the source is missing, used for folders that may not exist
  | { op: 'rename'; from: string; to: string; optional?: boolean }
  // moves the file to the system trash rather than deleting it
  | { op: 'remove'; path: string }
  // removes a folder only when it is empty
  | { op: 'rmdir'; path: string }
  // deletes one of morrow's own files for good, used for history that must not outlive encryption
  | { op: 'delete'; path: string };

export type VaultOpResult =
  | { ok: true }
  | { ok: false; code: 'conflict'; message: string; current: string | null }
  | { ok: false; code: 'exists' | 'error'; message: string };

const depth = (path: string) => (path ? path.split('/').length : 0);

// renames that take every page from where it is to where it should be, parents before children
export function planMoves(previous: Layout, next: Layout): VaultOp[] {
  const ops: VaultOp[] = [];
  const current = new Map<PageId, Placement>();
  for (const [id, placement] of previous) current.set(id, { ...placement });
  const owner = new Map<string, PageId>();
  const claim = (placement: Placement, id: PageId) => {
    owner.set(placement.folder.toLowerCase(), id);
    if (placement.file) owner.set(placement.file.toLowerCase(), id);
  };
  const release = (placement: Placement) => {
    owner.delete(placement.folder.toLowerCase());
    if (placement.file) owner.delete(placement.file.toLowerCase());
  };
  for (const [id, placement] of current) claim(placement, id);

  const rebase = (from: string, to: string) => {
    const prefix = `${from}/`;
    const move = (path: string) => (path.startsWith(prefix) ? to + path.slice(from.length) : path);
    for (const [id, placement] of current) {
      const folder = placement.folder === from ? to : move(placement.folder);
      const file = placement.file === null ? null : move(placement.file);
      if (folder === placement.folder && file === placement.file) continue;
      release(placement);
      placement.folder = folder;
      placement.file = file;
      claim(placement, id);
    }
  };

  const moveFolder = (id: PageId, placement: Placement, to: string) => {
    ops.push({ op: 'rename', from: placement.folder, to, optional: true });
    release(placement);
    rebase(placement.folder, to);
    placement.folder = to;
    claim(placement, id);
  };
  const moveFile = (id: PageId, placement: Placement, to: string) => {
    if (!placement.file) return;
    ops.push({ op: 'rename', from: placement.file, to });
    release(placement);
    placement.file = to;
    claim(placement, id);
  };

  // something else sits where this page is going, it steps aside to a hidden name until its own turn
  const makeRoom = (path: string, id: PageId) => {
    const other = owner.get(path.toLowerCase());
    if (other === undefined || other === id) return;
    const placement = current.get(other)!;
    const temp = joinPath(dirname(placement.folder), `.morrow-move-${other}-${basename(placement.folder)}`);
    const ext = placement.file ? placement.file.slice(placement.folder.length) : '';
    moveFolder(other, placement, temp);
    if (placement.file) moveFile(other, placement, `${temp}${ext}`);
  };

  const moving = [...next]
    .filter(([id, target]) => {
      const before = previous.get(id);
      return (
        before &&
        (before.folder !== target.folder ||
          (before.file !== null && target.file !== null && before.file !== target.file))
      );
    })
    .sort(([, a], [, b]) => depth(a.folder) - depth(b.folder));

  for (const [id, target] of moving) {
    const placement = current.get(id)!;
    if (placement.folder !== target.folder) {
      makeRoom(target.folder, id);
      moveFolder(id, placement, target.folder);
    }
    if (placement.file && target.file && placement.file !== target.file) {
      makeRoom(target.file, id);
      moveFile(id, placement, target.file);
    }
  }
  return ops;
}

// what a list of applied operations did to the layout, used to keep track after a partial failure
export function replayRename(layout: Map<PageId, Placement>, from: string, to: string): void {
  const prefix = `${from}/`;
  const move = (path: string) =>
    path === from ? to : path.startsWith(prefix) ? to + path.slice(from.length) : path;
  for (const [id, placement] of layout) {
    const folder = move(placement.folder);
    const file = placement.file === null ? null : move(placement.file);
    if (folder !== placement.folder || file !== placement.file) layout.set(id, { folder, file });
  }
}

// folders renamed along with their pages, each from where it was to where it is now. pictures and files
// inside them keep the ids pages knew them by until the vault is read again, these say where they went
export type FolderMoves = ReadonlyArray<readonly [string, string]>;

// where a path is now, after the folders it was in were renamed. a later rename can be of a folder inside
// where an earlier one went, so it looks again until nothing more applies
export function movedPath(moves: FolderMoves, path: string): string {
  let current = path;
  for (let step = 0; step < 16; step++) {
    const lower = current.toLowerCase();
    let best: readonly [string, string] | null = null;
    for (const move of moves) {
      const from = move[0].toLowerCase();
      if ((lower === from || lower.startsWith(`${from}/`)) && (!best || move[0].length > best[0].length))
        best = move;
    }
    if (!best) break;
    const next = best[1] + current.slice(best[0].length);
    if (next === current) break;
    current = next;
  }
  return current;
}

// the moves with one more folder renamed. moves into that folder now lead to its new place, and a move
// back cancels the one it undoes, so following them never goes round in a circle
export function withFolderMove(moves: FolderMoves, from: string, to: string): FolderMoves {
  const lower = from.toLowerCase();
  const next = moves
    .filter(([earlier]) => earlier.toLowerCase() !== lower)
    .map(([earlier, now]) => [earlier, movedPath([[from, to]], now)] as const)
    .filter(([earlier, now]) => earlier !== now);
  return [...next, [from, to]];
}
