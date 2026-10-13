import type { Snapshot } from './model';

export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
export const MAX_SNAPSHOTS_PER_PAGE = 50;

// a page gets a new version at most every ten minutes while it is being edited
export function snapshotDue(lastAt: number | undefined, now: number): boolean {
  return lastAt === undefined || now - lastAt >= SNAPSHOT_INTERVAL_MS;
}

// ids of the oldest versions beyond the per page limit
export function snapshotsToPrune(snapshots: Array<Pick<Snapshot, 'id' | 'createdAt'>>): string[] {
  return [...snapshots]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(MAX_SNAPSHOTS_PER_PAGE)
    .map((snapshot) => snapshot.id);
}
