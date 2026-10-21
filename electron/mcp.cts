import { app } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const configFile = () => path.join(app.getPath('userData'), 'mcp.json');

export async function isMcpEnabled(): Promise<boolean> {
  try {
    const raw = await readFile(configFile(), 'utf8');
    const parsed = JSON.parse(raw) as { enabled?: boolean };
    return parsed.enabled === true;
  } catch {
    return false;
  }
}

export async function setMcpEnabled(enabled: boolean): Promise<boolean> {
  try {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(configFile(), JSON.stringify({ enabled }, null, 2), 'utf8');
    return enabled;
  } catch {
    return false;
  }
}

function resolveMcpScript(): string {
  const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : process.cwd();
  // an installed copy keeps the server outside the app archive, where node can load it
  const unpacked = path.join(`${appPath}.unpacked`, 'dist-mcp', 'index.js');
  if (app?.isPackaged && existsSync(unpacked)) return unpacked;
  const direct = path.join(appPath, 'dist-mcp', 'index.js');
  if (existsSync(direct)) return direct;
  const fromCwd = path.join(process.cwd(), 'dist-mcp', 'index.js');
  if (existsSync(fromCwd)) return fromCwd;
  return direct;
}

export interface McpLaunch {
  command: string;
  script: string;
  available: boolean;
}

// how an app such as claude desktop starts morrow's server: this executable run as plain node with the bundled
// server script. an appimage mounts into a new temporary folder every run, so it gets a copy of the script in
// morrow's own folder, written as .mjs because it is an es module
export async function getMcpLaunch(): Promise<McpLaunch> {
  const bundled = resolveMcpScript();
  if (!existsSync(bundled)) return { command: process.execPath, script: bundled, available: false };
  const appImage = process.env.APPIMAGE;
  if (!appImage) return { command: process.execPath, script: bundled, available: true };
  const script = path.join(app.getPath('userData'), 'mcp-server.mjs');
  try {
    const source = await readFile(bundled);
    const existing = await readFile(script).catch(() => null);
    if (!existing || !existing.equals(source)) await writeFile(script, source);
    return { command: appImage, script, available: true };
  } catch {
    return { command: appImage, script, available: false };
  }
}
