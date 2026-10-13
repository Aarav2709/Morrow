import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { readWorkspace } from '../core/migrations';
import type { LoadedWorkspace } from '../core/migrations';
import { SCHEMA_VERSION } from '../core/model';
import type { DocNode, PageId, PageMeta } from '../core/model';
import { errorMessage, fail, ok } from '../core/result';
import type { Result } from '../core/result';

export interface WriteBatch {
  pages: PageMeta[];
  docs: Array<{ id: PageId; doc: DocNode }>;
  removed: PageId[];
}

export interface WorkspaceRepository {
  load(): Promise<Result<LoadedWorkspace & { firstRun: boolean }>>;
  // resolves only after the transaction commits, rejects on any failure
  write(batch: WriteBatch): Promise<void>;
  markInitialized(): Promise<void>;
  close(): void;
}

interface MorrowDB extends DBSchema {
  pages: { key: string; value: PageMeta };
  docs: { key: string; value: { id: PageId; doc: DocNode } };
  meta: { key: string; value: unknown };
}

const DB_VERSION = 1;

export async function openRepository(name = 'morrow'): Promise<WorkspaceRepository> {
  const db = await openDB<MorrowDB>(name, DB_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore('pages', { keyPath: 'id' });
        database.createObjectStore('docs', { keyPath: 'id' });
        database.createObjectStore('meta');
        void transaction.objectStore('meta').put(SCHEMA_VERSION, 'schemaVersion');
      }
    },
    blocking() {
      // a newer version of the app wants to upgrade, let it
      db.close();
    },
  });
  return new IndexedDbRepository(db);
}

class IndexedDbRepository implements WorkspaceRepository {
  constructor(private readonly db: IDBPDatabase<MorrowDB>) {}

  async load(): Promise<Result<LoadedWorkspace & { firstRun: boolean }>> {
    try {
      const tx = this.db.transaction(['pages', 'docs', 'meta'], 'readonly');
      const [pages, docRecords, version, initialized] = await Promise.all([
        tx.objectStore('pages').getAll(),
        tx.objectStore('docs').getAll(),
        tx.objectStore('meta').get('schemaVersion'),
        tx.objectStore('meta').get('initialized'),
        tx.done,
      ]);
      const docs: Record<string, unknown> = {};
      for (const record of docRecords) docs[record.id] = record.doc;
      const storedVersion = typeof version === 'number' ? version : 1;
      const loaded = readWorkspace(storedVersion, { pages, docs });
      if (!loaded.ok) return loaded;
      if (storedVersion < SCHEMA_VERSION) await this.rewrite(loaded.value);
      return ok({ ...loaded.value, firstRun: initialized !== true && pages.length === 0 });
    } catch (error) {
      return fail(`Could not open your workspace: ${errorMessage(error)}`);
    }
  }

  async write(batch: WriteBatch): Promise<void> {
    const tx = this.db.transaction(['pages', 'docs'], 'readwrite');
    const pages = tx.objectStore('pages');
    const docs = tx.objectStore('docs');
    const requests: Array<Promise<unknown>> = [];
    for (const page of batch.pages) requests.push(pages.put(page));
    for (const record of batch.docs) requests.push(docs.put(record));
    for (const id of batch.removed) requests.push(pages.delete(id), docs.delete(id));
    await Promise.all([...requests, tx.done]);
  }

  async markInitialized(): Promise<void> {
    await this.db.put('meta', true, 'initialized');
  }

  close(): void {
    this.db.close();
  }

  // writes migrated records back and records the new version in one transaction
  private async rewrite(loaded: LoadedWorkspace): Promise<void> {
    const tx = this.db.transaction(['pages', 'docs', 'meta'], 'readwrite');
    await Promise.all([
      ...loaded.pages.map((page) => tx.objectStore('pages').put(page)),
      ...Object.entries(loaded.docs).map(([id, doc]) => tx.objectStore('docs').put({ id, doc })),
      tx.objectStore('meta').put(SCHEMA_VERSION, 'schemaVersion'),
      tx.done,
    ]);
  }
}
