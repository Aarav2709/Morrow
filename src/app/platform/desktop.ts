export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  error?: string;
}

export interface DesktopVaultApi {
  state(): Promise<{ current: string | null; recent: Array<{ path: string; name: string; exists: boolean }> }>;
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
}

// bridge exposed by the electron preload script, absent when running in a browser
export interface DesktopBridge {
  vault?: DesktopVaultApi;
  platform: string;
  version: string;
  dataPath: string;
  onCommand(listener: (id: string) => void): () => void;
  setTheme(theme: 'light' | 'dark'): void;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateStatus(listener: (status: UpdateStatus) => void): () => void;
  openExternal(url: string): Promise<void>;
  showDataFolder(): Promise<void>;
  writeAutoBackup(json: string): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  showBackupsFolder(): Promise<void>;
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
