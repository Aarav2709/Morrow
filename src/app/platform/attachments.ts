import type { FileId, FileMeta } from '../../core/model';
import type { StoredFile } from '../../storage/repository';
import { toast } from '../ui';
import { getSession } from '../workspace';
import { newId, saveFile } from './files';

export const MAX_FILE_BYTES = 100 * 1024 * 1024;

const urls = new Map<FileId, Promise<string | null>>();

// files in a vault load straight from disk, browser storage hands out object urls created once per file
export function fileUrl(id: FileId): Promise<string | null> {
  const direct = getSession().fileUrl(id);
  if (direct) return Promise.resolve(direct);
  let url = urls.get(id);
  if (!url) {
    url = getSession()
      .getFile(id)
      .then((file) => (file ? URL.createObjectURL(new Blob([file.data], { type: file.meta.type })) : null))
      .catch(() => null);
    urls.set(id, url);
  }
  return url;
}

// reads and stores files, returns their metadata only once every file is safely saved
export async function storeFiles(files: File[]): Promise<FileMeta[]> {
  const accepted = files.filter((file) => file.size <= MAX_FILE_BYTES);
  if (accepted.length < files.length) toast('Files larger than 100 MB were not added.', { tone: 'error' });
  if (accepted.length === 0) return [];
  const stored: StoredFile[] = await Promise.all(
    accepted.map(async (file) => ({
      meta: {
        id: newId(),
        name: file.name || 'file',
        type: file.type || 'application/octet-stream',
        size: file.size,
        createdAt: Date.now(),
      },
      data: await file.arrayBuffer(),
    })),
  );
  const result = await getSession().addFiles(stored);
  if (!result.ok) {
    toast(result.error, { tone: 'error' });
    return [];
  }
  return result.value;
}

export async function downloadFile(id: FileId): Promise<void> {
  const file = await getSession().getFile(id);
  if (!file) {
    toast('This file is missing from your workspace.', { tone: 'error' });
    return;
  }
  saveFile(file.meta.name, file.data, file.meta.type);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
