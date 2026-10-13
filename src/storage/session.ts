import { applyCommand } from '../core/commands';
import type { Command } from '../core/commands';
import { emptyWorkspace } from '../core/model';
import type { PageId, WorkspaceState } from '../core/model';
import { fail, ok } from '../core/result';
import type { Result } from '../core/result';
import { openRepository } from './repository';
import type { WorkspaceRepository } from './repository';
import { SaveQueue } from './saveQueue';
import type { SaveQueueOptions, SaveStatus } from './saveQueue';

// the single place where commands run, state lives and changes are queued for disk
export class WorkspaceSession {
  private state: WorkspaceState;
  private readonly listeners = new Set<() => void>();
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
    this.queue = new SaveQueue(repository, () => this.state, options);
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

  async close(): Promise<void> {
    await this.queue.flush();
    this.queue.dispose();
    this.repository.close();
  }
}
