import { applyCommand } from '../core/commands';
import type { Command } from '../core/commands';
import { isDocEmpty } from '../core/doc';
import { snapshotDue } from '../core/history';
import { emptyWorkspace } from '../core/model';
import type { DocNode, FileId, FileMeta, PageId, Snapshot, WorkspaceState } from '../core/model';
import { fail, ok } from '../core/result';
import type { Result } from '../core/result';
import { openRepository } from './repository';
import type { StoredFile, WorkspaceRepository } from './repository';
import { SaveQueue } from './saveQueue';
import type { SaveQueueOptions, SaveStatus } from './saveQueue';

// the single place where commands run, state lives and changes are queued for disk
export class WorkspaceSession {
  private state: WorkspaceState;
  private readonly listeners = new Set<() => void>();
  private readonly lastSnapshot = new Map<PageId, number>();
  readonly queue: SaveQueue;

  private constructor(
    private readonly repository: WorkspaceRepository,
    initial: WorkspaceState,
    readonly unreadable: ReadonlySet<PageId>,
    readonly problems: readonly string[],
    readonly firstRun: boolean,
    options: SaveQueueOptions,
  ) {
    this.state = initial;
    this.queue = new SaveQueue(repository, () => this.state, {
      ...options,
      snapshotsFor: (ids, state) => {
        const now = Date.now();
        return ids
          .filter((id) => {
            const doc = state.docs[id];
            // an empty page has nothing worth going back to
            return doc && !isDocEmpty(doc) && snapshotDue(this.lastSnapshot.get(id), now);
          })
          .map((id) => this.snapshotOf(id, state, now));
      },
      onSnapshotsWritten: (snapshots) => {
        for (const snapshot of snapshots) this.lastSnapshot.set(snapshot.pageId, snapshot.createdAt);
      },
    });
  }

  static async open(
    repository?: WorkspaceRepository,
    options: SaveQueueOptions = {},
  ): Promise<Result<WorkspaceSession>> {
    const repo = repository ?? (await openRepository());
    const loaded = await repo.load();
    if (!loaded.ok) return loaded;
    const state = emptyWorkspace();
    const pages = Object.fromEntries(loaded.value.pages.map((page) => [page.id, page]));
    return ok(
      new WorkspaceSession(
        repo,
        { ...state, pages, docs: loaded.value.docs },
        new Set(loaded.value.unreadable),
        loaded.value.problems,
        loaded.value.firstRun,
        options,
      ),
    );
  }

  getState = (): WorkspaceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get saveStatus(): SaveStatus {
    return this.queue.status;
  }

  execute(command: Command): Result<WorkspaceState> {
    const id = 'id' in command ? command.id : 'pageId' in command ? command.pageId : null;
    if (
      typeof id === 'string' &&
      this.unreadable.has(id) &&
      (command.type === 'page.setDoc' || command.type === 'task.setChecked')
    ) {
      return fail('This page could not be read, so it is protected from changes.');
    }
    const result = applyCommand(this.state, command);
    if (!result.ok) return result;
    const { state, changes } = result.value;
    if (state === this.state) return ok(state);
    this.state = state;
    this.queue.enqueue(changes);
    for (const listener of this.listeners) listener();
    return ok(state);
  }

  // runs several commands as one unit, nothing is applied if any of them fails
  executeAll(commands: Command[]): Result<WorkspaceState> {
    let draft = this.state;
    const all = { pages: new Set<PageId>(), docs: new Set<PageId>(), removed: new Set<PageId>() };
    for (const command of commands) {
      const result = applyCommand(draft, command);
      if (!result.ok) return result;
      draft = result.value.state;
      for (const id of result.value.changes.pages) all.pages.add(id);
      for (const id of result.value.changes.docs) all.docs.add(id);
      for (const id of result.value.changes.removed) all.removed.add(id);
    }
    this.state = draft;
    this.queue.enqueue(all);
    for (const listener of this.listeners) listener();
    return ok(draft);
  }

  flush(): Promise<boolean> {
    return this.queue.flush();
  }

  markInitialized(): Promise<void> {
    return this.repository.markInitialized();
  }

  // files are written straight away, a page only references them once they are safely stored
  async addFiles(files: StoredFile[]): Promise<Result<FileMeta[]>> {
    try {
      await this.repository.putFiles(files);
      return ok(files.map((file) => file.meta));
    } catch (error) {
      return fail(`The file could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getFile(id: FileId): Promise<StoredFile | null> {
    return this.repository.getFile(id);
  }

  listFiles(): Promise<FileMeta[]> {
    return this.repository.listFiles();
  }

  deleteFiles(ids: FileId[]): Promise<void> {
    return this.repository.deleteFiles(ids);
  }

  listSnapshots(pageId: PageId): Promise<Snapshot[]> {
    return this.repository.listSnapshots(pageId);
  }

  allSnapshots(): Promise<Snapshot[]> {
    return this.repository.allSnapshots();
  }

  // the current content is kept as a version first, so restoring can always be undone
  async restoreSnapshot(snapshot: Snapshot): Promise<Result<WorkspaceState>> {
    if (!this.state.pages[snapshot.pageId]) return fail('That page no longer exists.');
    await this.queue.flush();
    try {
      const current = this.snapshotOf(snapshot.pageId, this.state, Date.now());
      await this.repository.write({ pages: [], docs: [], removed: [], snapshots: [current] });
      this.lastSnapshot.set(snapshot.pageId, current.createdAt);
    } catch (error) {
      return fail(`The current version could not be kept, so nothing was restored: ${String(error)}`);
    }
    return this.execute({ type: 'page.setDoc', id: snapshot.pageId, doc: snapshot.doc, now: Date.now() });
  }

  private snapshotOf(pageId: PageId, state: WorkspaceState, now: number): Snapshot {
    return {
      id: crypto.randomUUID(),
      pageId,
      title: state.pages[pageId]?.title ?? '',
      doc: state.docs[pageId] as DocNode,
      createdAt: now,
    };
  }

  async close(): Promise<void> {
    await this.queue.flush();
    this.queue.dispose();
    this.repository.close();
  }
}
