// the desktop bridge on top of tauri. the interface talks to window.morrow the way it always has, this turns
// each call into a command for morrow's native side
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { DesktopBridge } from './desktop';

interface NativeInfo {
  version: string;
  dataPath: string;
  platform: string;
  capturesWindow: boolean;
}

declare global {
  interface Window {
    __MORROW_INFO__?: NativeInfo;
    __TAURI_INTERNALS__?: unknown;
  }
}

type Listener = (id: string) => void | Promise<void>;

// a listener that can be removed straight away, though tauri hands back its remover a moment later
function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  let stopped = false;
  let remove: (() => void) | null = null;
  void listen<T>(event, (message) => {
    if (!stopped) handler(message.payload);
  }).then((unlisten) => {
    if (stopped) unlisten();
    else remove = unlisten;
  });
  return () => {
    stopped = true;
    remove?.();
  };
}

// small values travel as json, file contents as raw bytes with their path in a header
const pathHeader = (path: string) => ({ headers: { path: encodeURIComponent(path) } });

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  pdf: 'application/pdf',
};
const mimeOfName = (name: string) =>
  MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

async function bytesOrNull(command: string, args: Record<string, unknown>): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await invoke<ArrayBuffer>(command, args));
  } catch {
    return null;
  }
}

// zoom goes in half steps of chromium's levels, as it did before
const ZOOM_KEY = 'morrow.zoom';
const zoomFactor = (level: number) => Math.pow(1.2, level);

export function tauriBridge(): DesktopBridge | null {
  if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) return null;
  const info: NativeInfo = window.__MORROW_INFO__ ?? {
    version: '',
    dataPath: '',
    platform: 'unknown',
    capturesWindow: false,
  };
  const listeners = new Set<Listener>();
  const zoomListeners = new Set<(percent: number) => void>();
  const run = (id: string) =>
    Promise.all([...listeners].map((listener) => Promise.resolve(listener(id)).catch(() => undefined)));

  subscribe<string>('morrow:command', (id) => {
    if (typeof id !== 'string') return;
    const done = run(id);
    // the native side waits for this before closing the window
    if (id === 'app.prepareToClose') void done.finally(() => invoke('close_ready'));
  });

  setupWindow(info.platform, run);

  let zoom = 0;
  try {
    zoom = Number(localStorage.getItem(ZOOM_KEY)) || 0;
  } catch {
    // starts at the usual size
  }
  if (zoom) void invoke('set_zoom', { factor: zoomFactor(zoom) });
  const setZoom = (level: number) => {
    zoom = Math.round(Math.max(-3, Math.min(5, level)) * 2) / 2;
    void invoke('set_zoom', { factor: zoomFactor(zoom) });
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      // only lasts until morrow closes
    }
    const percent = Math.round(zoomFactor(zoom) * 100);
    for (const listener of zoomListeners) listener(percent);
  };
  const mac = info.platform === 'darwin';
  window.addEventListener(
    'keydown',
    (event) => {
      if (!(mac ? event.metaKey : event.ctrlKey) || event.altKey) return;
      if (event.key === '=' || event.key === '+') setZoom(zoom + 0.5);
      else if (event.key === '-') setZoom(zoom - 0.5);
      else if (event.key === '0') setZoom(0);
      else return;
      event.preventDefault();
    },
    true,
  );

  return {
    platform: info.platform,
    version: info.version,
    dataPath: info.dataPath,
    onCommand(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onZoom(listener) {
      zoomListeners.add(listener);
      return () => zoomListeners.delete(listener);
    },
    setTheme: (theme) => void invoke('set_theme', { theme }),
    openExternal: (url) => invoke('open_external', { url }),
    showDataFolder: () => invoke('show_data_folder'),
    showBackupsFolder: () => invoke('show_backups'),
    writeAutoBackup: (json) => invoke('write_backup', { json }),
    notify: (title, body) => void invoke('notify', { title, body }),
    exportPdf: (name) => invoke('export_pdf', { name }),
    ...(info.capturesWindow
      ? {
          exportPng: (name: string, area: { x: number; y: number; width: number; height: number }) =>
            invoke('export_png', { name, area: { ...area, viewportWidth: window.innerWidth } }),
        }
      : {}),
    copyText: (text) => invoke<boolean>('copy_text', { text }),
    copyRich: (text, html) => invoke<boolean>('copy_rich', { text, html }),
    async clipboardFiles() {
      const paths = await invoke<string[]>('clipboard_files').catch(() => []);
      const files: File[] = [];
      for (const path of paths) {
        const data = await bytesOrNull('read_clipboard_file', { path });
        const name = path.split(/[\\/]/).pop() || 'file';
        if (data)
          files.push(new File([data.slice().buffer as ArrayBuffer], name, { type: mimeOfName(name) }));
      }
      return files;
    },
    // the webview checks spelling itself, a page without spellcheck turns it off
    setSpellcheck: () => undefined,
    async fetchImage(url) {
      const bytes = await bytesOrNull('fetch_image', { url });
      if (!bytes) return null;
      const end = bytes.indexOf(10);
      const type = new TextDecoder().decode(bytes.subarray(0, end));
      return { type, data: bytes.slice(end + 1).buffer as ArrayBuffer };
    },
    saveFile: (name, data) =>
      invoke('save_file', new Uint8Array(data), { headers: { name: encodeURIComponent(name) } }),
    sync: {
      status: () => invoke('sync_status'),
      enable: (enabled) => invoke('sync_enable', { enabled }),
      setName: (name) => invoke('sync_name', { name }),
      startPairing: () => invoke('sync_start_pairing'),
      stopPairing: () => invoke('sync_stop_pairing'),
      pair: (target, code) => invoke('sync_pair', { target, code }),
      forget: (id) => invoke('sync_forget', { id }),
      request: (peerId, payload) => invoke('sync_request', { peerId, payload }),
      mark: (peerId) => invoke('sync_mark', { peerId }),
      onEvent: (listener) => subscribe('sync:event', listener),
    },
    updates: {
      check: () => invoke('update_check'),
      install: () => invoke('update_install'),
      onProgress: (listener) => subscribe<number>('update:progress', listener),
    },
    assistant: {
      settings: () => invoke('ai_settings'),
      configure: (patch) => invoke('ai_configure', { patch }),
      models: () => invoke('ai_models'),
      turn: (request) => invoke('ai_turn', { request }),
      cancel: (id) => invoke('ai_cancel', { id }),
    },
    mcp: {
      launch: () => invoke('mcp_launch'),
      setEnabled: (enabled) => invoke('mcp_set_enabled', { enabled }),
      isEnabled: () => invoke('mcp_is_enabled'),
    },
    vault: {
      state: () => invoke('vault_state'),
      choose: (start) => invoke('vault_choose', { start: start ?? null }),
      cloud: () => invoke('vault_cloud'),
      copyInto: (dir) => invoke('vault_copy_into', { dir }),
      createDefault: () => invoke('vault_create_default'),
      select: (dir) => invoke('vault_select', { dir }),
      forget: (dir) => invoke('vault_forget', { dir }),
      open: () => invoke('vault_open'),
      close: () => invoke('vault_close'),
      scan: () => invoke('vault_scan'),
      apply: (ops) => invoke('vault_apply', { ops }),
      readText: (path) => invoke('vault_read_text', { path }),
      readBytes: (path) => bytesOrNull('vault_read_bytes', { path }),
      createFile: (path, data) => invoke('vault_create_file', new Uint8Array(data), pathHeader(path)),
      exists: (path) => invoke('vault_exists', { path }),
      list: (path) => invoke('vault_list', { path }),
      reveal: (path) => invoke('vault_reveal', { path: path ?? null }),
      openFile: (path) => invoke('vault_open_file', { path }),
      openLink: (href, pagePath) => invoke('vault_open_link', { href, pagePath }),
      copyImage: (path) => invoke('vault_copy_image', { path }),
      manifest: () => invoke('vault_manifest'),
      identity: () => invoke('vault_identity'),
      readSynced: (path) => invoke('vault_read_synced', { path }),
      writeSynced: (path, data, expect) => invoke('vault_write_synced', { path, data, expect }),
      prepareCopy: (dir, vaultId) => invoke('vault_prepare_copy', { dir, vaultId }),
      syncBase: (peerId) => invoke('vault_sync_base', { peerId }),
      saveSyncBase: (peerId, files) => invoke('vault_save_sync_base', { peerId, files }),
      onChanges: (listener) => subscribe('vault:changes', listener),
    },
  };
}

// the parts of the top bars that are not buttons move the window, and windows and linux get morrow's own
// window buttons at the end of the tab bar. they sit under dialogs, so they dim with the rest of the window
const DRAG_AREAS = '.topbar, .sidebar-header, .tab-bar, .assistant-header';
const NOT_DRAGGABLE =
  'button, a, input, textarea, select, [contenteditable="true"], [draggable="true"], [role="tab"], .tab, .topbar-meta, .sidebar-resizer, .menu, .popover, .window-controls';

function setupWindow(platform: string, run: (id: string) => Promise<unknown>): void {
  const current = getCurrentWindow();
  const mobile = platform === 'android' || platform === 'ios';
  document.addEventListener('mousedown', (event) => {
    if (mobile) return;
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    if (!event.target.closest(DRAG_AREAS) || event.target.closest(NOT_DRAGGABLE)) return;
    event.preventDefault();
    if (event.detail === 2) void current.toggleMaximize();
    else void current.startDragging();
  });
  // the back and forward buttons on a mouse
  document.addEventListener('mouseup', (event) => {
    if (event.button === 3) void run('go.back');
    else if (event.button === 4) void run('go.forward');
    else return;
    event.preventDefault();
  });
  // links meant for a new tab open in the browser, the window only ever shows morrow
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      const href = link?.getAttribute('href') ?? '';
      if (!link || link.getAttribute('target') !== '_blank' || !/^(https?:|mailto:)/i.test(href)) return;
      event.preventDefault();
      void invoke('open_external', { url: href });
    },
    true,
  );
  const open = window.open.bind(window);
  window.open = (url?: string | URL, ...rest) => {
    const href = String(url ?? '');
    if (/^(https?:|mailto:)/i.test(href)) {
      void invoke('open_external', { url: href });
      return null;
    }
    return open(url, ...rest);
  };
  // a mac has its own buttons, and a phone has no window of its own to move or close
  if (platform === 'darwin' || mobile) return;
  const add = () => {
    if (document.querySelector('.window-controls')) return;
    const controls = document.createElement('div');
    controls.className = 'window-controls';
    const button = (label: string, path: string, action: () => void, extra = '') => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `window-control ${extra}`.trim();
      element.setAttribute('aria-label', label);
      element.title = label;
      element.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
      element.addEventListener('click', action);
      controls.appendChild(element);
    };
    button('Minimize', 'M0 5.5h10', () => void current.minimize());
    button('Maximize', 'M0.5 0.5h9v9h-9z', () => void current.toggleMaximize());
    button('Close', 'M0 0l10 10M10 0L0 10', () => void current.close(), 'is-close');
    document.body.appendChild(controls);
  };
  if (document.body) add();
  else document.addEventListener('DOMContentLoaded', add);
}
