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
});
