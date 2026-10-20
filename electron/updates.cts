// new versions come from the github releases this repository publishes. only checked when the person
// turned it on or pressed the button, and installed only when they say so
import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const LATEST = 'https://api.github.com/repos/Aarav2709/Morrow/releases/latest';

export interface UpdateInfo {
  version: string;
  notes: string;
  // the release page, for systems where morrow can not install by itself
  url: string;
  // morrow can download and install this one: the windows installer and the linux appimage
  installable: boolean;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
}

let latest: { info: UpdateInfo; asset: ReleaseAsset | null } | null = null;

// 1.10.0 is newer than 1.9.2, and a version with a suffix like 1.2.0-beta comes before 1.2.0
export function isNewer(candidate: string, current: string): boolean {
  const parse = (version: string) => {
    const [core = '', pre] = version.replace(/^v/, '').split('-', 2);
    return { parts: core.split('.').map((part) => Number(part) || 0), pre: pre ?? null };
  };
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    const difference = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  if (a.pre === b.pre) return false;
  return a.pre === null || (b.pre !== null && a.pre > b.pre);
}

// the file this copy of morrow can install itself from, null when it has to be downloaded by hand
function installerFor(assets: ReleaseAsset[], version: string): ReleaseAsset | null {
  if (process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE && app.isPackaged)
    return assets.find((asset) => asset.name === `Morrow-Setup-${version}-${process.arch}.exe`) ?? null;
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    const name =
      process.arch === 'x64' ? `Morrow-${version}.AppImage` : `Morrow-${version}-${process.arch}.AppImage`;
    return assets.find((asset) => asset.name === name) ?? null;
  }
  return null;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const response = await net.fetch(LATEST, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Morrow/${app.getVersion()}` },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`);
  const release = (await response.json()) as {
    tag_name?: string;
    body?: string | null;
    html_url?: string;
    draft?: boolean;
    prerelease?: boolean;
    assets?: ReleaseAsset[];
  };
  const version = String(release.tag_name ?? '').replace(/^v/, '');
  if (!version || release.draft || release.prerelease || !isNewer(version, app.getVersion())) {
    latest = null;
    return null;
  }
  const asset = installerFor(release.assets ?? [], version);
  const info: UpdateInfo = {
    version,
    notes: (release.body ?? '').slice(0, 8000),
    url: String(release.html_url ?? 'https://github.com/Aarav2709/Morrow/releases/latest'),
    installable: asset !== null,
  };
  latest = { info, asset };
  return info;
}

// downloads the new version, checks it is the file github says it is, then hands over to it
export async function installUpdate(onProgress: (share: number) => void): Promise<void> {
  const asset = latest?.asset;
  if (!asset) throw new Error('There is no update to install.');
  const response = await net.fetch(asset.browser_download_url);
  if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}).`);
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(asset.size ? Math.min(1, received / asset.size) : 0);
  }
  const data = Buffer.concat(chunks);
  const expected = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7).toLowerCase() : null;
  if (expected && createHash('sha256').update(data).digest('hex') !== expected)
    throw new Error('The download did not match the release, so it was not installed.');

  if (process.platform === 'win32') {
    const file = path.join(app.getPath('temp'), asset.name);
    await writeFile(file, data);
    // the installer replaces this copy where it is installed and starts it again when done
    spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
    return;
  }
  const target = process.env.APPIMAGE;
  if (!target) throw new Error('This copy of Morrow can not update itself.');
  const next = `${target}.update`;
  try {
    await writeFile(next, data);
    await chmod(next, 0o755);
    await rename(next, target);
  } catch (error) {
    await rm(next, { force: true });
    throw error;
  }
  app.relaunch({ execPath: target, args: process.argv.slice(1) });
  app.quit();
}
