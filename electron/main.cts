import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
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
import {
  applyOps,
  chooseFolder,
  closeVault,
  createDefaultVault,
  createFile,
  currentVault,
  forgetVault,
  listDir,
  openVault,
  pathExists,
  prepareCopy,
  readBytes,
  readSyncBase,
  readText,
  copyImage,
  openInDefaultApp,
  revealInFolder,
  scanVault,
  selectVault,
  syncedFileBase64,
  vaultFilePath,
  vaultIdentity,
  vaultManifest,
  vaultState,
  writeSyncBase,
  writeSyncedFile,
  copyVaultInto,
} from './vault.cjs';
import { cloudStatus } from './cloud.cjs';
import {
  getMcpLaunch,
  getMcpStatus,
  isMcpEnabled,
  setMcpEnabled,
  startMcpServer,
  stopMcpServer,
} from './mcp.cjs';
import { aiTurn, cancelAiTurn, getAiSettings, listAiModels, setAiSettings } from './ai.cjs';
import type { TurnRequest } from './ai.cjs';
import { checkForUpdate, installUpdate } from './updates.cjs';
import {
  closeSync,
  forgetPeer,
  initSync,
  markSynced,
  pairWith,
  requestPeer,
  setDeviceName,
  setSyncEnabled,
  startPairing,
  stopPairing,
  syncStatus,
} from './sync.cjs';

const SCHEME = 'morrow';
// images and files inside the open vault load through this scheme, nothing outside the vault is served
const FILE_SCHEME = 'morrow-file';
const APP_ORIGIN = `${SCHEME}://app`;
const DEV_URL = process.env.MORROW_DEV_URL ?? null;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const KEEP_BACKUPS = 20;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const IS_MAC = process.platform === 'darwin';
const APP_ID = 'app.morrow.desktop';
// the window and taskbar use morrow's icon even when running on the plain electron binary
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
// matches the height of the app's top bar so the native buttons sit inside it
const TITLE_BAR_HEIGHT = 46;
const THEMES = {
  light: { background: '#fbfaf7', symbols: '#6b665d' },
  dark: { background: '#1b1a18', symbols: '#a49e93' },
};
// the scrim the app lays over everything behind a dialog, matching --scrim in tokens.css
const SCRIMS = {
  light: { rgb: [24, 22, 19], alpha: 0.32 },
  dark: { rgb: [0, 0, 0], alpha: 0.5 },
};

function dimmed(hex: string, name: 'light' | 'dark'): string {
  const { rgb, alpha } = SCRIMS[name];
  const channels = [1, 3, 5].map((start, i) =>
    Math.round(parseInt(hex.slice(start, start + 2), 16) * (1 - alpha) + rgb[i]! * alpha),
  );
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

// the native window buttons in the theme's colours, darkened like the rest of the window behind a dialog
function paintTitleBar(window: BrowserWindow, name: 'light' | 'dark', dim: boolean): void {
  if (IS_MAC) return;
  const theme = THEMES[name];
  window.setTitleBarOverlay({
    color: dim ? dimmed(theme.background, name) : theme.background,
    symbolColor: dim ? dimmed(theme.symbols, name) : theme.symbols,
  });
}
const windowThemes = new WeakMap<BrowserWindow, 'light' | 'dark'>();

// development and test runs can use a throwaway profile, installed copies never can
if (!app.isPackaged && process.env.MORROW_USER_DATA) app.setPath('userData', process.env.MORROW_USER_DATA);
// automated test runs can keep their window out of sight
const HIDDEN = !app.isPackaged && process.env.MORROW_HIDDEN === '1';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let mainWindow: BrowserWindow | null = null;
let readyToClose = false;

const backupsDir = () => path.join(app.getPath('userData'), 'Backups');
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');
// spelling is checked in the languages this computer prefers. macos checks spelling in the language being
// typed by itself, so there the list is empty and left alone
function systemSpelling(available: string[]): string[] {
  const picked: string[] = [];
  for (const wanted of app.getPreferredSystemLanguages()) {
    const lower = wanted.toLowerCase();
    const match =
      available.find((code) => code.toLowerCase() === lower) ??
      available.find((code) => code.toLowerCase().split('-')[0] === lower.split('-')[0]);
    if (match && !picked.includes(match)) picked.push(match);
    if (picked.length === 3) break;
  }
  return picked.length ? picked : available.filter((code) => code === 'en-US').slice(0, 1);
}

function applySpelling(): void {
  const available = session.defaultSession.availableSpellCheckerLanguages;
  if (available.length) session.defaultSession.setSpellCheckerLanguages(systemSpelling(available));
}

// windows groups the taskbar button and notifications by this id
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

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
    protocol.handle(FILE_SCHEME, serveVaultFile);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
    });
    registerIpc();
    applySpelling();
    void initSync((event) => toWindow('sync:event', event));
    // macos needs its system menu for copy, paste and quit, other platforms get no menu bar
    Menu.setApplicationMenu(IS_MAC ? buildMacMenu() : null);
    await createWindow();
    // quick capture from any app: the window comes forward with a small box for a note
    globalShortcut.register('CommandOrControl+Alt+M', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!HIDDEN) mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('morrow:command', 'capture');
    });
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    closeSync();
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

async function serveVaultFile(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let relative: string;
  try {
    relative = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const file = url.host === 'vault' ? vaultFilePath(relative) : null;
  if (!file || !existsSync(file)) return new Response('Not found', { status: 404 });
  const response = await net.fetch(pathToFileURL(file).toString());
  // svg images can carry scripts, they are only ever shown as images, pdfs open in the built in viewer
  const headers = new Headers(response.headers);
  if (!/\.pdf$/i.test(file))
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    );
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
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
    ...(IS_MAC || !existsSync(ICON) ? {} : { icon: ICON }),
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
      backgroundThrottling: !HIDDEN,
      // hidden test windows still paint, so they can be screenshotted
      offscreen: HIDDEN,
      // the built in pdf viewer, for pdfs attached to pages
      plugins: true,
    },
  });
  mainWindow = window;
  readyToClose = false;
  if (state.maximized) window.maximize();
  if (!HIDDEN) window.once('ready-to-show', () => window.show());

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
    closeVault();
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

// a file watcher or sync can still report something while the window closes, that is dropped
function toWindow(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed())
    mainWindow.webContents.send(channel, payload);
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
    window.setBackgroundColor(THEMES[name].background);
    windowThemes.set(window, name);
    paintTitleBar(window, name, false);
  });
  ipcMain.on('morrow:dim', (event, dim: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!fromApp(event) || !window) return;
    const name = windowThemes.get(window) ?? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    paintTitleBar(window, name, dim === true);
  });
  ipcMain.handle('morrow:open-external', (event, url: unknown) => {
    if (fromApp(event) && typeof url === 'string') openExternal(url);
  });
  ipcMain.handle('morrow:copy-text', (event, text: unknown) => {
    if (fromApp(event) && typeof text === 'string') {
      clipboard.writeText(text);
      return true;
    }
    return false;
  });
  ipcMain.handle('morrow:show-data-folder', async (event) => {
    if (fromApp(event)) await shell.openPath(app.getPath('userData'));
  });
  ipcMain.handle('morrow:show-backups', async (event) => {
    if (!fromApp(event)) return;
    await mkdir(backupsDir(), { recursive: true });
    await shell.openPath(backupsDir());
  });
  registerVaultIpc();
  // prints the page as it looks, with print styles hiding the rest of the app, and saves it where asked
  ipcMain.handle('morrow:export-pdf', async (event, name: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!fromApp(event) || !window) return { ok: false, error: 'Not allowed.' };
    const base =
      (typeof name === 'string' ? name : 'Page')
        .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
        .trim()
        .slice(0, 120) || 'Page';
    const choice = await dialog.showSaveDialog(window, {
      title: 'Export as PDF',
      defaultPath: path.join(app.getPath('documents'), `${base}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (choice.canceled || !choice.filePath) return { ok: false, error: null };
    try {
      const data = await event.sender.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        generateDocumentOutline: true,
      });
      await writeFile(choice.filePath, data);
      return { ok: true, path: choice.filePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
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

// the renderer reaches the vault only through these, each one checks the page asking is morrow itself
function registerVaultIpc(): void {
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!fromApp(event)) throw new Error('Not allowed.');
      return fn(...args);
    });
  handle('ai:settings', () => getAiSettings());
  // errors come back as text, an invoke that throws reaches the page with electron's wording around it
  const failed = (error: unknown) => ({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  handle('update:check', () => checkForUpdate().then((update) => ({ ok: true, update }), failed));
  handle('update:install', () =>
    installUpdate((share) => toWindow('update:progress', share)).then(() => ({ ok: true }), failed),
  );
  handle('ai:configure', (patch) => setAiSettings((patch ?? {}) as Record<string, unknown>));
  handle('ai:models', () => listAiModels());
  handle('ai:turn', (request) => aiTurn(request as TurnRequest));
  handle('ai:cancel', (id) => cancelAiTurn(id));
  handle('mcp:status', () => getMcpStatus());
  handle('mcp:launch', () => getMcpLaunch());
  handle('mcp:start', (port) => startMcpServer(typeof port === 'number' ? port : 3030));
  handle('mcp:stop', () => stopMcpServer());
  handle('mcp:set-enabled', (enabled) => setMcpEnabled(enabled === true));
  handle('mcp:is-enabled', () => isMcpEnabled());
  handle('vault:state', () => vaultState());
  handle('vault:choose', (start) => chooseFolder(mainWindow, start));
  handle('vault:cloud', () => cloudStatus(currentVault()));
  handle('vault:copy-into', (dir) => copyVaultInto(dir));
  handle('vault:create-default', () => createDefaultVault());
  handle('vault:select', (dir) => selectVault(String(dir)));
  handle('vault:forget', (dir) => forgetVault(String(dir)));
  handle('vault:open', async () => {
    const state = await vaultState();
    if (!state.current) return { ok: false, root: null };
    await openVault(state.current, (changes) => toWindow('vault:changes', changes));
    return { ok: true, root: state.current };
  });
  handle('vault:close', () => closeVault());
  handle('vault:scan', () => scanVault());
  handle('vault:apply', (ops) => applyOps(ops));
  handle('vault:read-text', (relative) => readText(relative));
  handle('vault:read-bytes', (relative) => readBytes(relative));
  handle('vault:create-file', (relative, data) => createFile(relative, data));
  handle('vault:exists', (relative) => pathExists(relative));
  handle('vault:list', (relative) => listDir(relative));
  handle('vault:reveal', (relative) => revealInFolder(relative ?? ''));
  handle('vault:open-file', (relative) => openInDefaultApp(relative));
  handle('vault:copy-image', (relative) => copyImage(relative));
  handle('vault:current', () => currentVault());
  handle('vault:manifest', () => vaultManifest());
  handle('vault:identity', () => vaultIdentity());
  handle('vault:read-synced', (relative) => syncedFileBase64(relative));
  handle('vault:write-synced', (relative, data, expect) => writeSyncedFile(relative, data, expect));
  handle('vault:prepare-copy', (dir, vaultId) => prepareCopy(String(dir), String(vaultId)));
  handle('vault:sync-base', (peerId) => readSyncBase(String(peerId)));
  handle('vault:save-sync-base', (peerId, files) => writeSyncBase(String(peerId), files));
  handle('sync:status', () => syncStatus());
  handle('sync:enable', (enabled) => setSyncEnabled(enabled === true));
  handle('sync:name', (name) => setDeviceName(String(name)));
  handle('sync:start-pairing', () => startPairing());
  handle('sync:stop-pairing', () => stopPairing());
  handle('sync:pair', (target, code) =>
    pairWith(target as { id?: string; address: string; port?: number }, String(code)),
  );
  handle('sync:forget', (id) => forgetPeer(String(id)));
  handle('sync:request', (peerId, payload) =>
    requestPeer(String(peerId), payload as Record<string, unknown>),
  );
  handle('sync:mark', (peerId) => markSynced(String(peerId)));
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
  const send = (id: string) => () => toWindow('morrow:command', id);
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
    {
      // cmd w closes the tab, the window closes with cmd shift w
      label: 'Window',
      submenu: [
        { label: 'New Tab', accelerator: 'Cmd+T', registerAccelerator: false, click: send('tab.new') },
        { label: 'Close Tab', accelerator: 'Cmd+W', registerAccelerator: false, click: send('tab.close') },
        { role: 'close', accelerator: 'Cmd+Shift+W' },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]);
}
