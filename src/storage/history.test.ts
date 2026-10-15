import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../core/model';
import type { DocNode } from '../core/model';
import { openRepository } from './repository';
import { WorkspaceSession } from './session';

const names: string[] = [];
let count = 0;
const freshName = () => {
  const name = `morrow-history-${count++}`;
  names.push(name);
  return name;
};

afterEach(async () => {
  while (names.length) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(names.pop()!);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  }
});

const doc = (text: string): DocNode => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

async function open(name: string): Promise<WorkspaceSession> {
  const session = await WorkspaceSession.open(await openRepository(name));
  if (!session.ok) throw new Error(session.error);
  return session.value;
}

describe('page history', () => {
  it('keeps a version on save and restores without losing the current text', async () => {
    const session = await open(freshName());
    session.execute({ type: 'page.create', id: 'p', parentId: null, now: 1, title: 'Notes' });
    session.execute({ type: 'page.setDoc', id: 'p', doc: doc('first draft'), now: 2 });
    await session.flush();
    let versions = await session.listSnapshots('p');
    expect(versions).toHaveLength(1);
    expect(versions[0]!.doc).toEqual(doc('first draft'));

    // edits inside the ten minute window do not add versions
    session.execute({ type: 'page.setDoc', id: 'p', doc: doc('second draft'), now: 3 });
    await session.flush();
    expect(await session.listSnapshots('p')).toHaveLength(1);

    const restored = await session.restoreSnapshot(versions[0]!);
    expect(restored.ok).toBe(true);
    expect(session.getState().docs.p).toEqual(doc('first draft'));
    versions = await session.listSnapshots('p');
    expect(versions.map((version) => version.doc)).toContainEqual(doc('second draft'));
    await session.close();
  });

  it('removes history together with a page deleted forever', async () => {
    const name = freshName();
    const session = await open(name);
    session.execute({ type: 'page.create', id: 'p', parentId: null, now: 1 });
    session.execute({ type: 'page.setDoc', id: 'p', doc: doc('x'), now: 2 });
    await session.flush();
    session.execute({ type: 'page.trash', id: 'p', now: 3 });
    session.execute({ type: 'page.deleteForever', id: 'p' });
    await session.flush();
    expect(await session.listSnapshots('p')).toEqual([]);
    await session.close();
  });
});

describe('files', () => {
  it('stores, lists, reads and deletes attachments', async () => {
    const session = await open(freshName());
    const meta = { id: 'f1', name: 'note.txt', type: 'text/plain', size: 3, createdAt: 1 };
    const saved = await session.addFiles([
      { meta, data: new TextEncoder().encode('abc').buffer as ArrayBuffer },
    ]);
    expect(saved.ok).toBe(true);
    expect(await session.listFiles()).toEqual([meta]);
    const file = await session.getFile('f1');
    expect(new TextDecoder().decode(file!.data)).toBe('abc');
    await session.deleteFiles(['f1']);
    expect(await session.getFile('f1')).toBeNull();
    await session.close();
  });
});

describe('upgrading from version 1', () => {
  it('opens a version 1 database without touching its pages', async () => {
    const name = freshName();
    const old = await openDB(name, 1, {
      upgrade(database) {
        database.createObjectStore('pages', { keyPath: 'id' });
        database.createObjectStore('docs', { keyPath: 'id' });
        database.createObjectStore('meta');
      },
    });
    await old.put('pages', {
      id: 'p',
      parentId: null,
      title: 'Old page',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    await old.put('docs', { id: 'p', doc: doc('kept') });
    await old.put('meta', 1, 'schemaVersion');
    old.close();

    const session = await open(name);
    expect(session.getState().pages.p?.title).toBe('Old page');
    expect(session.getState().docs.p).toEqual(doc('kept'));
    expect(await session.listFiles()).toEqual([]);
    await session.close();

    const upgraded = await openDB(name);
    expect(await upgraded.get('meta', 'schemaVersion')).toBe(SCHEMA_VERSION);
    upgraded.close();
  });
});
