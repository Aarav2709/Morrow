// pages kept by earlier builds of morrow inside the app's own storage, copied once into a vault folder
import { fileIdsInDoc, remapFileIds } from '../core/doc';
import type { FileId, PageMeta } from '../core/model';
import { fail, ok } from '../core/result';
import type { Result } from '../core/result';
import { openRepository } from '../storage/repository';
import type { WorkspaceSession } from '../storage/session';

const LEGACY_DB = 'morrow';
// set by the vault chooser when pages from an earlier build should be copied into the folder being opened
export const COPY_LEGACY_KEY = 'morrow.copyLegacy';
const MIGRATED_KEY = 'morrow.legacyMigrated';

async function legacyExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  try {
    const databases = await indexedDB.databases();
    return databases.some((db) => db.name === LEGACY_DB);
  } catch {
    return false;
  }
}

// how many pages are waiting to be copied, zero when there is nothing or it was done before
export async function legacyPageCount(): Promise<number> {
  if (localStorage.getItem(MIGRATED_KEY) || !(await legacyExists())) return 0;
  const repository = await openRepository(LEGACY_DB);
  try {
    const loaded = await repository.load();
    return loaded.ok ? loaded.value.pages.length : 0;
  } finally {
    repository.close();
  }
}

// copies every page, image and earlier version into the open vault, the old copy is left as it was
export async function copyLegacyInto(session: WorkspaceSession): Promise<Result<number>> {
  const repository = await openRepository(LEGACY_DB);
  try {
    const loaded = await repository.load();
    if (!loaded.ok) return loaded;
    const { pages, docs } = loaded.value;
    if (pages.length === 0) {
      localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
      return ok(0);
    }
    const used = new Set<FileId>();
    for (const doc of Object.values(docs)) for (const id of fileIdsInDoc(doc)) used.add(id);
    const ids = new Map<FileId, FileId>();
    for (const id of used) {
      const file = await repository.getFile(id);
      if (!file) continue;
      const stored = await session.addFiles([file]);
      if (!stored.ok) return stored;
      ids.set(id, stored.value[0]!.id);
    }
    const taken = new Set(Object.keys(session.getState().pages));
    const incoming: PageMeta[] = pages.filter((page) => !taken.has(page.id));
    const incomingDocs = Object.fromEntries(
      incoming.map((page) => [
        page.id,
        remapFileIds(docs[page.id] ?? { type: 'doc', content: [{ type: 'paragraph' }] }, ids),
      ]),
    );
    const result = session.execute({ type: 'pages.insert', pages: incoming, docs: incomingDocs });
    if (!result.ok) return fail(result.error);
    if (!(await session.flush())) return fail('The pages could not be written to the folder.');
    const copied = new Set(incoming.map((page) => page.id));
    const versions = (await repository.allSnapshots())
      .filter((snapshot) => copied.has(snapshot.pageId))
      .map((snapshot) => ({ ...snapshot, doc: remapFileIds(snapshot.doc, ids) }));
    await session.importSnapshots(versions).catch(() => undefined);
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
    return ok(incoming.length);
  } finally {
    repository.close();
  }
}
