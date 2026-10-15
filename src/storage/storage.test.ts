import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../core/commands';
import { newPageMeta } from '../core/model';
import type { DocNode } from '../core/model';
import { openRepository } from './repository';
import type { WorkspaceRepository, WriteBatch } from './repository';
import { SaveQueue } from './saveQueue';
import { WorkspaceSession } from './session';

function deleteRepository(name: string | undefined): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name ?? '');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

let dbCount = 0;
const names: string[] = [];
const freshName = () => {
  const name = `morrow-test-${dbCount++}`;
  names.push(name);
  return name;
};

afterEach(async () => {
  vi.useRealTimers();
  while (names.length) await deleteRepository(names.pop());
});

const doc = (text: string): DocNode => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

async function open(name: string, repository?: WorkspaceRepository): Promise<WorkspaceSession> {
  const session = await WorkspaceSession.open(repository ?? (await openRepository(name)));
  if (!session.ok) throw new Error(session.error);
  return session.value;
}

function must(session: WorkspaceSession, command: Command) {
  const result = session.execute(command);
  if (!result.ok) throw new Error(result.error);
}

describe('persistence', () => {
  it('survives closing and reopening the database', async () => {
    const name = freshName();
    const first = await open(name);
    expect(first.firstRun).toBe(true);
    must(first, { type: 'page.create', id: 'p', parentId: null, now: 1, title: 'Plans' });
    must(first, { type: 'page.create', id: 'c', parentId: 'p', now: 2, title: 'Child' });
    must(first, { type: 'page.setDoc', id: 'c', doc: doc('hello world'), now: 3 });
    await first.markInitialized();
    await first.close();

    const second = await open(name);
    expect(second.firstRun).toBe(false);
    expect(second.getState().pages.c?.parentId).toBe('p');
    expect(second.getState().docs.c).toEqual(doc('hello world'));
    await second.close();
  });

  it('persists deletions', async () => {
    const name = freshName();
    const first = await open(name);
    must(first, { type: 'page.create', id: 'p', parentId: null, now: 1 });
    await first.flush();
    must(first, { type: 'page.trash', id: 'p', now: 2 });
    must(first, { type: 'page.deleteForever', id: 'p' });
    await first.close();
    const second = await open(name);
    expect(second.getState().pages).toEqual({});
    expect(second.getState().docs).toEqual({});
    await second.close();
  });

  it('does not mark an emptied workspace as a first run', async () => {
    const name = freshName();
    const first = await open(name);
    await first.markInitialized();
    await first.close();
    const second = await open(name);
    expect(second.firstRun).toBe(false);
    await second.close();
  });
});

describe('save queue', () => {
  it('keeps failed writes and retries them with the latest content', async () => {
    vi.useFakeTimers();
    const writes: WriteBatch[] = [];
    let failNext = true;
    const writer = {
      async write(batch: WriteBatch) {
        if (failNext) {
          failNext = false;
          throw new Error('disk full');
        }
        writes.push(batch);
      },
    };
    let state = { pages: {}, docs: { a: doc('one') } };
    const queue = new SaveQueue(writer, () => state, { delayMs: 10 });
    queue.enqueue({ pages: new Set(), docs: new Set(['a']), removed: new Set() });
    await vi.advanceTimersByTimeAsync(10);
    expect(queue.status.state).toBe('error');
    expect(queue.status.error).toBe('disk full');
    expect(queue.hasPending()).toBe(true);

    state = { pages: {}, docs: { a: doc('two') } };
    await vi.advanceTimersByTimeAsync(1000);
    expect(queue.status.state).toBe('saved');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.docs).toEqual([{ id: 'a', doc: doc('two') }]);
    expect(queue.hasPending()).toBe(false);
  });

  it('serialises writes so a slow write is never overtaken', async () => {
    const order: string[] = [];
    let release!: () => void;
    const writer = {
      write: (batch: WriteBatch) => {
        const label = batch.docs.map((d) => d.id).join();
        order.push(`start ${label}`);
        if (label === 'a')
          return new Promise<void>(
            (resolve) =>
              (release = () => {
                order.push('end a');
                resolve();
              }),
          );
        order.push(`end ${label}`);
        return Promise.resolve();
      },
    };
    const state = { pages: {}, docs: { a: doc('a'), b: doc('b') } };
    const queue = new SaveQueue(writer, () => state, { delayMs: 1 });
    queue.enqueue({ pages: new Set(), docs: new Set(['a']), removed: new Set() });
    const first = queue.flush();
    queue.enqueue({ pages: new Set(), docs: new Set(['b']), removed: new Set() });
    const second = queue.flush();
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});

describe('session', () => {
  it('rejects failed commands without touching state or storage', async () => {
    const session = await open(freshName());
    const before = session.getState();
    expect(session.execute({ type: 'page.rename', id: 'missing', title: 'x', now: 1 }).ok).toBe(false);
    expect(session.getState()).toBe(before);
    expect(session.queue.hasPending()).toBe(false);
    await session.close();
  });

  it('applies grouped commands atomically', async () => {
    const session = await open(freshName());
    const result = session.executeAll([
      { type: 'page.create', id: 'a', parentId: null, now: 1 },
      { type: 'page.create', id: 'a', parentId: null, now: 1 },
    ]);
    expect(result.ok).toBe(false);
    expect(session.getState().pages).toEqual({});
    await session.close();
  });

  it('protects pages whose content could not be read', async () => {
    const name = freshName();
    const repository = await openRepository(name);
    await repository.write({
      pages: [newPageMeta({ id: 'x', parentId: null, title: 'Broken' })],
      docs: [{ id: 'x', doc: { type: 'unknown-root' } as DocNode }],
      removed: [],
    });
    const session = await open(name, repository);
    expect(session.unreadable.has('x')).toBe(true);
    expect(session.problems).toHaveLength(1);
    expect(session.execute({ type: 'page.setDoc', id: 'x', doc: doc('overwrite'), now: 1 }).ok).toBe(false);
    await session.close();
  });
});
