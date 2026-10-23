export interface CloudFolder {
  provider: string;
  path: string;
}

export interface DesktopVaultApi {
  state(): Promise<{
    current: string | null;
    recent: Array<{ path: string; name: string; exists: boolean }>;
  }>;
  choose(start?: string): Promise<string | null>;
  // the folders cloud apps sync on this computer, and the one the open vault is in
  cloud(): Promise<{ folders: CloudFolder[]; inside: CloudFolder | null }>;
  copyInto(dir: string): Promise<{ ok: boolean; path?: string; error?: string }>;
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
  openFile(path: string): Promise<boolean>;
  copyImage(path: string): Promise<boolean>;
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
export type AssistantProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom';

export interface AssistantSettings {
  provider: AssistantProviderId;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  keyStorage: 'system' | 'session';
  providers: Array<{
    id: AssistantProviderId;
    label: string;
    baseUrl: string;
    needsKey: boolean;
    defaultModel: string;
    keyUrl: string;
  }>;
}

export interface AssistantToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type AssistantTurnResult =
  | {
      ok: true;
      // the conversation as the provider keeps it, sent back unchanged with the next turn
      history: unknown[];
      text: string;
      toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
      stop: 'done' | 'tools' | 'refusal' | 'length';
      model: string;
    }
  | { ok: false; error: string };

// the optional assistant, its key never leaves the main process
export interface DesktopAssistantApi {
  settings(): Promise<AssistantSettings>;
  configure(patch: {
    provider?: AssistantProviderId;
    model?: string;
    baseUrl?: string;
    key?: string | null;
  }): Promise<AssistantSettings>;
  models(): Promise<{ ok: boolean; models: string[]; error?: string }>;
  turn(request: {
    id: string;
    history: unknown[];
    add:
      | { kind: 'user'; text: string }
      | { kind: 'tools'; results: Array<{ id: string; content: string; isError: boolean }>; text?: string };
    system: string;
    tools: AssistantToolSpec[];
  }): Promise<AssistantTurnResult>;
  cancel(id: string): Promise<void>;
}

export interface UpdateInfo {
  version: string;
  notes: string;
  url: string;
  // windows installs and linux appimages update themselves, the rest open the release page
  installable: boolean;
}

export interface DesktopUpdatesApi {
  check(): Promise<{ ok: true; update: UpdateInfo | null } | { ok: false; error: string }>;
  install(): Promise<{ ok: true } | { ok: false; error: string }>;
  onProgress(listener: (share: number) => void): () => void;
}

export interface McpLaunch {
  command: string;
  script: string;
  available: boolean;
}

export interface DesktopMcpApi {
  launch(): Promise<McpLaunch>;
  setEnabled(enabled: boolean): Promise<boolean>;
  isEnabled(): Promise<boolean>;
}

export interface DesktopBridge {
  assistant?: DesktopAssistantApi;
  updates?: DesktopUpdatesApi;
  mcp?: DesktopMcpApi;
  vault?: DesktopVaultApi;
  sync?: DesktopSyncApi;
  platform: string;
  version: string;
  dataPath: string;
  onCommand(listener: (id: string) => void): () => void;
  setTheme(theme: 'light' | 'dark'): void;
  paintTitleBar(color: string, symbolColor: string): void;
  openExternal(url: string): Promise<void>;
  showDataFolder(): Promise<void>;
  writeAutoBackup(json: string): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
  showBackupsFolder(): Promise<void>;
  exportPdf(name: string): Promise<{ ok: true; path: string } | { ok: false; error: string | null }>;
  copyText(text: string): Promise<boolean> | void;
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

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba | null {
  const match = /^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
}

function over(top: Rgba, below: Rgba): Rgba {
  const mix = (index: number) => top[index]! * top[3] + below[index]! * (1 - top[3]);
  return [mix(0), mix(1), mix(2), 1];
}

function hex([r, g, b]: Rgba): string {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

// the colour the app shows right under the window's own buttons, with any dialog's scrim left out
function colorUnderButtons(): Rgba {
  const root = getComputedStyle(document.documentElement);
  const layers: Rgba[] = [];
  for (const element of document.elementsFromPoint(window.innerWidth - 4, 4)) {
    if (element.closest('.dialog-backdrop, [role="dialog"]')) continue;
    const color = parseColor(getComputedStyle(element).backgroundColor);
    if (!color || color[3] === 0) continue;
    layers.push(color);
    if (color[3] === 1) break;
  }
  const base = parseColor(root.getPropertyValue('--bg')) ?? [255, 255, 255, 1];
  return layers.reduceRight<Rgba>((below, top) => over(top, below), [base[0], base[1], base[2], 1]);
}

// the window's own buttons match the bar they sit in, and darken with the rest of the window while a
// dialog is open. they are only repainted when their colour really changes, windows redraws them each time
// dialogs whose scrim has finished fading in
let dialogsOpen = 0;
let painted = '';
let frame = 0;
function paintTitleBar(): void {
  if (!desktop?.paintTitleBar || desktop.platform === 'darwin' || frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const root = getComputedStyle(document.documentElement);
    let color = colorUnderButtons();
    let symbols = parseColor(root.getPropertyValue('--text-muted')) ?? [107, 102, 93, 1];
    const scrim = dialogsOpen > 0 ? parseColor(root.getPropertyValue('--scrim')) : null;
    if (scrim) {
      color = over(scrim, color);
      symbols = over(scrim, symbols);
    }
    const key = `${hex(color)} ${hex(symbols)}`;
    if (key === painted) return;
    painted = key;
    desktop?.paintTitleBar(hex(color), hex(symbols));
  });
}

let watching = false;
// repaints when the theme changes or the bar under the buttons does, such as tabs appearing
export function watchTitleBar(): void {
  if (watching || !desktop?.paintTitleBar || desktop.platform === 'darwin') return;
  watching = true;
  new MutationObserver(paintTitleBar).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'style'],
    childList: true,
    subtree: true,
  });
  window.addEventListener('resize', paintTitleBar);
  paintTitleBar();
}

// the scrim fades in, so the buttons darken once it has, rather than a moment before the rest of the window
const SCRIM_FADE_MS = 120;
export function dialogOpened(): () => void {
  let state: 'fading' | 'dim' | 'closed' = 'fading';
  setTimeout(() => {
    if (state !== 'fading') return;
    state = 'dim';
    dialogsOpen++;
    paintTitleBar();
  }, SCRIM_FADE_MS);
  return () => {
    if (state === 'dim') dialogsOpen--;
    state = 'closed';
    paintTitleBar();
  };
}

// the desktop app copies through electron, which works whether or not the window has focus. the web
// clipboard needs a focused page, so it is only the fallback
export async function copyText(text: string): Promise<boolean> {
  try {
    if (desktop?.copyText && (await desktop.copyText(text)) !== false) return true;
  } catch {
    // falls back to the web clipboard
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function openExternal(url: string): void {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (desktop) void desktop.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
