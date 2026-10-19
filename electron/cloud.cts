// finds the folders cloud apps keep in sync, so a vault can live in one and follow you between computers.
// morrow never talks to these services, the vault is just a folder their own apps copy around
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface CloudFolder {
  provider: string;
  path: string;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

// dropbox writes where its folders are, one per account, in an info.json of its own
async function dropboxFolders(home: string): Promise<string[]> {
  const files = [path.join(home, '.dropbox', 'info.json')];
  if (process.platform === 'win32')
    for (const variable of ['APPDATA', 'LOCALAPPDATA'])
      if (process.env[variable]) files.push(path.join(process.env[variable], 'Dropbox', 'info.json'));
  const found: string[] = [];
  for (const file of files) {
    try {
      const info = JSON.parse(await readFile(file, 'utf8')) as Record<string, { path?: unknown }>;
      for (const account of Object.values(info))
        if (typeof account?.path === 'string' && path.isAbsolute(account.path)) found.push(account.path);
    } catch {
      // no dropbox, or not signed in
    }
  }
  return found;
}

export async function cloudFolders(): Promise<CloudFolder[]> {
  const home = os.homedir();
  const candidates: CloudFolder[] = [];
  const add = (provider: string, dir: string | undefined) => {
    if (dir) candidates.push({ provider, path: path.resolve(dir) });
  };
  for (const dir of await dropboxFolders(home)) add('Dropbox', dir);
  if (process.platform === 'darwin') {
    add('iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
    // apps built on apple's file provider all keep their folder here, named after the app and the account
    const storage = path.join(home, 'Library', 'CloudStorage');
    for (const name of await readdir(storage).catch(() => [] as string[])) {
      const provider = name.startsWith('GoogleDrive')
        ? 'Google Drive'
        : name.startsWith('OneDrive')
          ? 'OneDrive'
          : (name.split('-')[0] ?? name);
      const dir = path.join(storage, name);
      // google drive keeps your own files in My Drive, the rest of the account folder is shared drives
      add(provider, (await isDirectory(path.join(dir, 'My Drive'))) ? path.join(dir, 'My Drive') : dir);
    }
  }
  if (process.platform === 'win32') {
    for (const variable of ['OneDriveConsumer', 'OneDriveCommercial', 'OneDrive'])
      add('OneDrive', process.env[variable]);
    add('iCloud Drive', path.join(home, 'iCloudDrive'));
    // google drive for desktop shows up as a drive of its own, G: unless that letter was taken
    for (const letter of 'GHIJKLMNOPQRSTUVWXYZDEF') add('Google Drive', `${letter}:\\My Drive`);
  }
  const usual: Array<[string, string]> = [
    ['Dropbox', 'Dropbox'],
    ['OneDrive', 'OneDrive'],
    ['Google Drive', 'Google Drive'],
    ['Nextcloud', 'Nextcloud'],
    ['ownCloud', 'ownCloud'],
    ['Syncthing', 'Sync'],
    ['pCloud', 'pCloudDrive'],
    ['MEGA', 'MEGA'],
    ['Box', 'Box'],
    ['Proton Drive', 'Proton Drive'],
  ];
  for (const [provider, name] of usual) add(provider, path.join(home, name));

  const found: CloudFolder[] = [];
  for (const candidate of candidates) {
    if (found.some((item) => samePath(item.path, candidate.path))) continue;
    if (await isDirectory(candidate.path)) found.push(candidate);
  }
  return found;
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase();
}

export function isInside(dir: string, parent: string): boolean {
  const relative = path.relative(parent, dir);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// where the open vault is, among the cloud folders, if it is in one
export async function cloudStatus(
  current: string | null,
): Promise<{ folders: CloudFolder[]; inside: CloudFolder | null }> {
  const folders = await cloudFolders();
  const fold = (dir: string) => (process.platform === 'linux' ? dir : dir.toLowerCase());
  const inside = current
    ? (folders.find((folder) => isInside(fold(current), fold(folder.path))) ?? null)
    : null;
  return { folders, inside };
}
