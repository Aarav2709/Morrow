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

export interface DesktopBridge {
  assistant?: DesktopAssistantApi;
  updates?: DesktopUpdatesApi;
  vault?: DesktopVaultApi;
  sync?: DesktopSyncApi;
  platform: string;
  version: string;
  dataPath: string;
  onCommand(listener: (id: string) => void): () => void;
  setTheme(theme: 'light' | 'dark'): void;
  dimTitleBar(dim: boolean): void;
  spelling: {
    get(): Promise<SpellingLanguages | null>;
    set(languages: string[] | null): Promise<SpellingLanguages | null>;
  };
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

export interface SpellingLanguages {
  // dictionaries this system can check with, empty on macos, which picks the language by itself
  available: string[];
  // what was chosen in settings, null to follow the computer's languages
  chosen: string[] | null;
  active: string[];
}

// the window's own buttons darken with the rest of the window while any dialog is open
let dialogsOpen = 0;
export function dialogOpened(): () => void {
  if (dialogsOpen++ === 0) desktop?.dimTitleBar(true);
  return () => {
    if (--dialogsOpen === 0) desktop?.dimTitleBar(false);
  };
}

export function openExternal(url: string): void {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (desktop) void desktop.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
