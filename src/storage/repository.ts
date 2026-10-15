import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { snapshotsToPrune } from '../core/history';
import { readWorkspace } from '../core/migrations';
import type { LoadedWorkspace } from '../core/migrations';
import { SCHEMA_VERSION } from '../core/model';
import type { DocNode, FileId, FileMeta, PageId, PageMeta, Snapshot, WorkspaceState } from '../core/model';
import { errorMessage, fail, ok } from '../core/result';
import type { Result } from '../core/result';

export interface WriteBatch {
  pages: PageMeta[];
  docs: Array<{ id: PageId; doc: DocNode }>;
  removed: PageId[];
  snapshots?: Snapshot[];
  // the whole workspace at the time of the write, file based storage lays out pages from it
  state?: WorkspaceState;
}

// pages changed by another app while morrow was open
export interface ExternalPatch {
  pages: PageMeta[];
  docs: Record<PageId, DocNode>;
  removed: PageId[];
  unreadable: PageId[];
  readable: PageId[];
}

export interface StoredFile {
  meta: FileMeta;
  data: ArrayBuffer;
}

export interface WorkspaceRepository {
  load(): Promise<Result<LoadedWorkspace & { firstRun: boolean }>>;
  // resolves only after the transaction commits, rejects on any failure
  write(batch: WriteBatch): Promise<void>;
  markInitialized(): Promise<void>;
  // stores files and returns their metadata, the ids may differ from the ones passed in
  putFiles(files: StoredFile[]): Promise<FileMeta[]>;
  // a url the page can load the file from directly, null when it has to be read into memory
  fileUrl?(id: FileId): string | null;
  // called with changes made outside morrow, returns the pages it accepted
  onExternalChange?(listener: (patch: ExternalPatch) => PageId[]): () => void;
  // a name for the storage location, shown in settings
  readonly location?: string;
  // gives storage the live workspace, to read outside edits against unsaved changes
  attachState?(getState: () => WorkspaceState): void;
  // where a page's file lives, relative to the storage location
  pathOf?(id: PageId): string | null;
  getFile(id: FileId): Promise<StoredFile | null>;
  listFiles(): Promise<FileMeta[]>;
  deleteFiles(ids: FileId[]): Promise<void>;
  listSnapshots(pageId: PageId): Promise<Snapshot[]>;
  allSnapshots(): Promise<Snapshot[]>;
  close(): void;
}

interface MorrowDB extends DBSchema {
  pages: { key: string; value: PageMeta };
  docs: { key: string; value: { id: PageId; doc: DocNode } };
  meta: { key: string; value: unknown };
  files: { key: string; value: FileMeta & { data: ArrayBuffer } };
  history: { key: string; value: Snapshot; indexes: { pageId: string } };
}

const DB_VERSION = 2;

export async function openRepository(name = 'morrow'): Promise<WorkspaceRepository> {
  const db = await openDB<MorrowDB>(name, DB_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore('pages', { keyPath: 'id' });
        database.createObjectStore('docs', { keyPath: 'id' });
        database.createObjectStore('meta');
        void transaction.objectStore('meta').put(SCHEMA_VERSION, 'schemaVersion');
      }
      // version 2 only adds stores, existing pages are untouched
      if (oldVersion < 2) {
        database.createObjectStore('files', { keyPath: 'id' });
        database.createObjectStore('history', { keyPath: 'id' }).createIndex('pageId', 'pageId');
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
    const tx = this.db.transaction(['pages', 'docs', 'history'], 'readwrite');
    const pages = tx.objectStore('pages');
    const docs = tx.objectStore('docs');
    const history = tx.objectStore('history');
    const byPage = history.index('pageId');
    const requests: Array<Promise<unknown>> = [];
    for (const page of batch.pages) requests.push(pages.put(page));
    for (const record of batch.docs) requests.push(docs.put(record));
    for (const snapshot of batch.snapshots ?? []) requests.push(history.put(snapshot));
    for (const id of batch.removed) {
      requests.push(pages.delete(id), docs.delete(id));
      requests.push(
        byPage.getAllKeys(id).then((keys) => Promise.all(keys.map((key) => history.delete(key)))),
      );
    }
    for (const pageId of new Set((batch.snapshots ?? []).map((snapshot) => snapshot.pageId))) {
      requests.push(
        byPage
          .getAll(pageId)
          .then((all) => Promise.all(snapshotsToPrune(all).map((key) => history.delete(key)))),
      );
    }
    await Promise.all([...requests, tx.done]);
  }

  async markInitialized(): Promise<void> {
    await this.db.put('meta', true, 'initialized');
  }

  async putFiles(files: StoredFile[]): Promise<FileMeta[]> {
    const tx = this.db.transaction('files', 'readwrite');
    await Promise.all([...files.map((file) => tx.store.put({ ...file.meta, data: file.data })), tx.done]);
    return files.map((file) => file.meta);
  }

  async getFile(id: FileId): Promise<StoredFile | null> {
    const record = await this.db.get('files', id);
    if (!record) return null;
    const { data, ...meta } = record;
    return { meta, data };
  }

  async listFiles(): Promise<FileMeta[]> {
    const metas: FileMeta[] = [];
    let cursor = await this.db.transaction('files').store.openCursor();
    while (cursor) {
      const { id, name, type, size, createdAt } = cursor.value;
      metas.push({ id, name, type, size, createdAt });
      cursor = await cursor.continue();
    }
    return metas;
  }

  async deleteFiles(ids: FileId[]): Promise<void> {
    const tx = this.db.transaction('files', 'readwrite');
    await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
  }

  async listSnapshots(pageId: PageId): Promise<Snapshot[]> {
    const all = await this.db.getAllFromIndex('history', 'pageId', pageId);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async allSnapshots(): Promise<Snapshot[]> {
    return this.db.getAll('history');
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
