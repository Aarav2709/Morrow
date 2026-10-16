export interface DesktopVaultApi {
  state(): Promise<{
    current: string | null;
    recent: Array<{ path: string; name: string; exists: boolean }>;
  }>;
  choose(): Promise<string | null>;
  createDefault(): Promise<string>;
  select(dir: string): Promise<{ ok: boolean; error?: string }>;
  forget(dir: string): Promise<void>;
  open(): Promise<{ ok: boolean; root: string | null }>;
  close(): Promise<void>;
  scan(): Promise<unknown>;
  apply(ops: unknown): Promise<unknown>;
  readText(path: string): Promise<string | null>;
  readBytes(path: string): Promise<Uint8Array | null>;
  createFile(path: string, data: ArrayBuffer): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<Array<{ path: string; size: number; mtime: number }>>;
  reveal(path?: string): Promise<void>;
  onChanges(listener: (changes: unknown) => void): () => void;
  manifest(): Promise<Record<string, string>>;
  identity(): Promise<{ id: string; name: string }>;
  readSynced(path: string): Promise<string | null>;
  writeSynced(
    path: string,
    data: string,
    expect: string | null,
  ): Promise<{ ok: boolean; code?: string; message?: string }>;
  prepareCopy(dir: string, vaultId: string): Promise<{ ok: boolean; error?: string }>;
  syncBase(peerId: string): Promise<Record<string, string>>;
  saveSyncBase(peerId: string, files: Record<string, string>): Promise<void>;
}

export interface SyncPeer {
  id: string;
  name: string;
  online: boolean;
  reachable: boolean;
  lastSync: number | null;
}

export interface SyncStatus {
  enabled: boolean;
  name: string;
  deviceId: string;
  pairingCode: string | null;
  peers: SyncPeer[];
  // computers nearby waiting to be paired
  waiting: Array<{ id: string; name: string; address: string; port: number }>;
}

export type SyncEvent =
  | { type: 'pull-requested'; peerId: string }
  | { type: 'paired'; peerId: string; name: string }
  | { type: 'changed' };

export interface DesktopSyncApi {
  status(): Promise<SyncStatus>;
  enable(enabled: boolean): Promise<void>;
  setName(name: string): Promise<void>;
  startPairing(): Promise<string>;
  stopPairing(): Promise<void>;
  pair(
    target: { id?: string; address: string; port?: number },
    code: string,
  ): Promise<{ ok: boolean; error?: string; name?: string }>;
  forget(id: string): Promise<void>;
  request(peerId: string, payload: Record<string, unknown>): Promise<unknown>;
  mark(peerId: string): Promise<void>;
  onEvent(listener: (event: SyncEvent) => void): () => void;
}

// bridge exposed by the electron preload script, absent when running in a browser
export interface DesktopBridge {
  vault?: DesktopVaultApi;
  sync?: DesktopSyncApi;
  platform: string;
  version: string;
  dataPath: string;
  onCommand(listener: (id: string) => void): () => void;
  setTheme(theme: 'light' | 'dark'): void;
  openExternal(url: string): Promise<void>;
  showDataFolder(): Promise<void>;
  writeAutoBackup(json: string): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  showBackupsFolder(): Promise<void>;
  exportPdf(name: string): Promise<{ ok: true; path: string } | { ok: false; error: string | null }>;
}

declare global {
  interface Window {
    morrow?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? (window.morrow ?? null) : null;

export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(desktop?.platform === 'darwin' ? 'Mac' : navigator.platform);

export function openExternal(url: string): void {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (desktop) void desktop.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
