import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEME = 'morrow';
const APP_ORIGIN = `${SCHEME}://app`;
const DEV_URL = process.env.MORROW_DEV_URL ?? null;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const KEEP_BACKUPS = 20;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const IS_MAC = process.platform === 'darwin';
// matches the height of the app's top bar so the native buttons sit inside it
const TITLE_BAR_HEIGHT = 46;
const THEMES = {
  light: { background: '#fbfaf7', symbols: '#6b665d' },
  dark: { background: '#1b1a18', symbols: '#a49e93' },
};

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;
let readyToClose = false;

const backupsDir = () => path.join(app.getPath('userData'), 'Backups');
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    protocol.handle(SCHEME, serveApp);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
    });
    registerIpc();
    // macos needs its system menu for copy, paste and quit, other platforms get no menu bar
    Menu.setApplicationMenu(IS_MAC ? buildMacMenu() : null);
    await createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!IS_MAC) app.quit();
  });
}

// serves the built renderer from disk and refuses anything outside it
async function serveApp(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(DIST_DIR, relative));
  if (!file.startsWith(DIST_DIR + path.sep) || !existsSync(file))
    return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

async function readWindowState(): Promise<WindowState> {
  const fallback = { width: 1280, height: 820 };
  try {
    const state = JSON.parse(await readFile(windowStateFile(), 'utf8')) as WindowState;
    const visible = screen.getAllDisplays().some(({ workArea }) => {
      const x = state.x ?? workArea.x;
      const y = state.y ?? workArea.y;
      return (
        x >= workArea.x - 50 &&
        y >= workArea.y - 50 &&
        x < workArea.x + workArea.width &&
        y < workArea.y + workArea.height
      );
    });
    if (!visible || state.width < 400 || state.height < 300) return fallback;
    return state;
  } catch {
    return fallback;
  }
}

async function createWindow(): Promise<void> {
  const state = await readWindowState();
  const theme = THEMES[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
  const window = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 520,
    minHeight: 420,
    show: false,
    title: 'Morrow',
    backgroundColor: theme.background,
    titleBarStyle: 'hidden',
    ...(IS_MAC
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : {
          titleBarOverlay: { color: theme.background, symbolColor: theme.symbols, height: TITLE_BAR_HEIGHT },
        }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  mainWindow = window;
  readyToClose = false;
  if (state.maximized) window.maximize();
  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = IS_MAC ? input.meta : input.control;
    // zoom used to live in the menu bar, keep the usual keys working without it
    if (mod && (input.key === '=' || input.key === '+')) {
      window.webContents.setZoomLevel(Math.min(5, window.webContents.getZoomLevel() + 0.5));
      event.preventDefault();
    } else if (mod && input.key === '-') {
      window.webContents.setZoomLevel(Math.max(-3, window.webContents.getZoomLevel() - 0.5));
      event.preventDefault();
    } else if (mod && input.key === '0') {
      window.webContents.setZoomLevel(0);
      event.preventDefault();
    } else if (DEV_URL && input.key === 'F12') {
      window.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  window.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: suggestion, click: () => window.webContents.replaceMisspelling(suggestion) });
    }
    if (params.misspelledWord) {
      items.push({
        label: 'Add to dictionary',
        click: () => window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      items.push({ type: 'separator' });
    }
    if (params.isEditable)
      items.push(
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      );
    else if (params.selectionText) items.push({ role: 'copy' });
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window });
  });

  // the renderer writes pending edits and a backup before the window closes
  window.on('close', (event) => {
    void saveWindowState(window);
    if (readyToClose || window.webContents.isCrashed()) return;
    event.preventDefault();
    window.webContents.send('morrow:command', 'app.prepareToClose');
    setTimeout(() => {
      readyToClose = true;
      if (!window.isDestroyed()) window.close();
    }, 5000);
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  await window.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
}

async function saveWindowState(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) return;
  const bounds = window.getNormalBounds();
  const state: WindowState = { ...bounds, maximized: window.isMaximized() };
  await writeFile(windowStateFile(), JSON.stringify(state)).catch(() => undefined);
}

function isAppUrl(url: string): boolean {
  return url.startsWith(`${APP_ORIGIN}/`) || (DEV_URL !== null && url.startsWith(DEV_URL));
}

function openExternal(url: string): void {
  if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
}

function fromApp(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return isAppUrl(url);
}

function registerIpc(): void {
  ipcMain.on('morrow:info', (event) => {
    event.returnValue = fromApp(event)
      ? { version: app.getVersion(), dataPath: app.getPath('userData'), platform: process.platform }
      : null;
  });
  ipcMain.on('morrow:close-ready', (event) => {
    if (!fromApp(event) || !mainWindow) return;
    readyToClose = true;
    mainWindow.close();
  });
  // keeps the native window buttons in the same colours as the app theme
  ipcMain.on('morrow:theme', (event, name: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!fromApp(event) || !window || (name !== 'light' && name !== 'dark')) return;
    const theme = THEMES[name];
    window.setBackgroundColor(theme.background);
    if (!IS_MAC) window.setTitleBarOverlay({ color: theme.background, symbolColor: theme.symbols });
  });
  ipcMain.handle('morrow:open-external', (event, url: unknown) => {
    if (fromApp(event) && typeof url === 'string') openExternal(url);
  });
  ipcMain.handle('morrow:show-data-folder', async (event) => {
    if (fromApp(event)) await shell.openPath(app.getPath('userData'));
  });
  ipcMain.handle('morrow:show-backups', async (event) => {
    if (!fromApp(event)) return;
    await mkdir(backupsDir(), { recursive: true });
    await shell.openPath(backupsDir());
  });
  ipcMain.handle('morrow:write-backup', async (event, json: unknown) => {
    if (!fromApp(event)) return { ok: false, error: 'Not allowed.' };
    if (typeof json !== 'string' || json.length > MAX_BACKUP_BYTES)
      return { ok: false, error: 'Invalid backup data.' };
    try {
      return { ok: true, path: await writeBackup(json) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

// writes to a temporary file first so a crash never leaves a half written backup
async function writeBackup(json: string): Promise<string> {
  const dir = backupsDir();
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(dir, `morrow-backup-${stamp}.json`);
  const temp = `${target}.tmp`;
  await writeFile(temp, json, 'utf8');
  await rename(temp, target);
  const files = (await readdir(dir)).filter((name) => /^morrow-backup-.*\.json$/.test(name)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS)))
    await rm(path.join(dir, old), { force: true });
  return target;
}

function buildMacMenu(): Menu {
  const send = (id: string) => () => mainWindow?.webContents.send('morrow:command', id);
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        // the renderer owns these shortcuts, the menu only shows them
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          registerAccelerator: false,
          click: send('view.settings'),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'Cmd+Z', registerAccelerator: false, click: send('edit.undo') },
        { label: 'Redo', accelerator: 'Cmd+Shift+Z', registerAccelerator: false, click: send('edit.redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    { role: 'windowMenu' },
  ]);
}
