// bridge exposed by the electron preload script, absent when running in a browser
export interface DesktopBridge {
  platform: string;
  version: string;
  dataPath: string;
  onCommand(listener: (id: string) => void): () => void;
  setTheme(theme: 'light' | 'dark'): void;
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
