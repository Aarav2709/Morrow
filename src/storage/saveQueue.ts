import type { Changes } from '../core/commands';
import type { PageId, WorkspaceState } from '../core/model';
import { errorMessage } from '../core/result';
import type { WriteBatch } from './repository';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export interface SaveStatus {
  state: SaveState;
  lastSavedAt: number | null;
  error: string | null;
  failures: number;
}

export interface SaveQueueOptions {
  delayMs?: number;
  maxRetryMs?: number;
  now?: () => number;
}

// batches changed records into serialised writes and keeps failed ones until they land
export class SaveQueue {
  private readonly dirtyPages = new Set<PageId>();
  private readonly dirtyDocs = new Set<PageId>();
  private readonly removed = new Set<PageId>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private current: SaveStatus = { state: 'saved', lastSavedAt: null, error: null, failures: 0 };
  private readonly delayMs: number;
  private readonly maxRetryMs: number;
  private readonly now: () => number;

  constructor(
    private readonly writer: { write(batch: WriteBatch): Promise<void> },
    private readonly getState: () => WorkspaceState,
    options: SaveQueueOptions = {},
  ) {
    this.delayMs = options.delayMs ?? 300;
    this.maxRetryMs = options.maxRetryMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  get status(): SaveStatus {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hasPending(): boolean {
    return this.dirtyPages.size + this.dirtyDocs.size + this.removed.size > 0 || this.inFlight !== null;
  }

  enqueue(changes: Changes): void {
    for (const id of changes.pages) this.dirtyPages.add(id);
    for (const id of changes.docs) this.dirtyDocs.add(id);
    for (const id of changes.removed) {
      this.removed.add(id);
      this.dirtyPages.delete(id);
      this.dirtyDocs.delete(id);
    }
    if (!this.hasPending()) return;
    if (this.current.state !== 'error') this.setStatus({ ...this.current, state: 'pending' });
    this.schedule(this.current.state === 'error' ? this.retryDelay() : this.delayMs);
  }

  // writes everything outstanding now, resolves true when nothing is left unsaved
  async flush(): Promise<boolean> {
    this.clearTimer();
    while (this.inFlight) await this.inFlight;
    if (this.dirtyPages.size + this.dirtyDocs.size + this.removed.size > 0) {
      this.inFlight = this.writeOnce();
      await this.inFlight;
    }
    return !this.hasPending();
  }

  dispose(): void {
    this.clearTimer();
    this.listeners.clear();
  }

  private async writeOnce(): Promise<void> {
    const pages = [...this.dirtyPages];
    const docs = [...this.dirtyDocs];
    const removed = [...this.removed];
    this.dirtyPages.clear();
    this.dirtyDocs.clear();
    this.removed.clear();
    this.setStatus({ ...this.current, state: 'saving' });

    const state = this.getState();
    const batch: WriteBatch = { pages: [], docs: [], removed: [] };
    for (const id of pages) {
      const page = state.pages[id];
      if (page) batch.pages.push(page);
    }
    for (const id of docs) {
      const doc = state.docs[id];
      if (doc) batch.docs.push({ id, doc });
    }
    for (const id of removed) if (!state.pages[id]) batch.removed.push(id);

    try {
      await this.writer.write(batch);
      this.inFlight = null;
      const more = this.dirtyPages.size + this.dirtyDocs.size + this.removed.size > 0;
      this.setStatus({
        state: more ? 'pending' : 'saved',
        lastSavedAt: this.now(),
        error: null,
        failures: 0,
      });
      if (more) this.schedule(this.delayMs);
    } catch (error) {
      // put the ids back so the next attempt writes the latest version of each record
      for (const id of pages) if (!this.removed.has(id)) this.dirtyPages.add(id);
      for (const id of docs) if (!this.removed.has(id)) this.dirtyDocs.add(id);
      for (const id of removed) this.removed.add(id);
      this.inFlight = null;
      this.setStatus({
        ...this.current,
        state: 'error',
        error: errorMessage(error),
        failures: this.current.failures + 1,
      });
      this.schedule(this.retryDelay());
    }
  }

  private retryDelay(): number {
    return Math.min(this.maxRetryMs, 1000 * 2 ** Math.max(0, this.current.failures - 1));
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private setStatus(status: SaveStatus): void {
    this.current = status;
    for (const listener of this.listeners) listener();
  }
}
