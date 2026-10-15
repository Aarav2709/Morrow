import { contextBridge, ipcRenderer } from 'electron';

type Listener = (id: string) => void | Promise<void>;

const info = ipcRenderer.sendSync('morrow:info') as {
  version: string;
  dataPath: string;
  platform: string;
} | null;
const listeners = new Set<Listener>();

ipcRenderer.on('morrow:command', (_event, id: unknown) => {
  if (typeof id !== 'string') return;
  const results = [...listeners].map((listener) => Promise.resolve(listener(id)).catch(() => undefined));
  // the main process waits for this before closing the window
  if (id === 'app.prepareToClose')
    void Promise.all(results).finally(() => ipcRenderer.send('morrow:close-ready'));
});

// the only surface the page can reach, everything else stays in the main process
contextBridge.exposeInMainWorld('morrow', {
  platform: info?.platform ?? 'unknown',
  version: info?.version ?? '',
  dataPath: info?.dataPath ?? '',
  onCommand(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setTheme: (theme: 'light' | 'dark') => ipcRenderer.send('morrow:theme', theme),
  checkForUpdates: () => ipcRenderer.invoke('morrow:check-updates'),
  installUpdate: () => ipcRenderer.invoke('morrow:install-update'),
  onUpdateStatus(listener: (status: unknown) => void) {
    const handler = (_event: unknown, status: unknown) => listener(status);
    ipcRenderer.on('morrow:update-status', handler);
    return () => ipcRenderer.removeListener('morrow:update-status', handler);
  },
  openExternal: (url: string) => ipcRenderer.invoke('morrow:open-external', url),
  showDataFolder: () => ipcRenderer.invoke('morrow:show-data-folder'),
  showBackupsFolder: () => ipcRenderer.invoke('morrow:show-backups'),
  writeAutoBackup: (json: string) => ipcRenderer.invoke('morrow:write-backup', json),
  vault: {
    state: () => ipcRenderer.invoke('vault:state'),
    choose: () => ipcRenderer.invoke('vault:choose'),
    createDefault: () => ipcRenderer.invoke('vault:create-default'),
    select: (dir: string) => ipcRenderer.invoke('vault:select', dir),
    forget: (dir: string) => ipcRenderer.invoke('vault:forget', dir),
    open: () => ipcRenderer.invoke('vault:open'),
    close: () => ipcRenderer.invoke('vault:close'),
    scan: () => ipcRenderer.invoke('vault:scan'),
    apply: (ops: unknown) => ipcRenderer.invoke('vault:apply', ops),
    readText: (path: string) => ipcRenderer.invoke('vault:read-text', path),
    readBytes: (path: string) => ipcRenderer.invoke('vault:read-bytes', path),
    createFile: (path: string, data: ArrayBuffer) => ipcRenderer.invoke('vault:create-file', path, new Uint8Array(data)),
    exists: (path: string) => ipcRenderer.invoke('vault:exists', path),
    list: (path: string) => ipcRenderer.invoke('vault:list', path),
    reveal: (path?: string) => ipcRenderer.invoke('vault:reveal', path ?? ''),
    onChanges(listener: (changes: unknown) => void) {
      const handler = (_event: unknown, changes: unknown) => listener(changes);
      ipcRenderer.on('vault:changes', handler);
      return () => ipcRenderer.removeListener('vault:changes', handler);
    },
  },
});
