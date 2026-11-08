// plugins: javascript in the vault's .morrow/plugins folder, one folder each with a manifest.json and a
// main.js. they run inside morrow with the same reach into your notes it has, so they stay off on each
// computer until turned on there, and each one is turned on by name
import { Puzzle } from 'lucide-react';
import { markdownToDoc } from '../../core/markdown/parse';
import { docToMarkdown } from '../../core/markdown/serialize';
import { displayTitle } from '../../core/model';
import type { PageId } from '../../core/model';
import { focusedEditor } from '../editor/commits';
import { createPage } from '../operations';
import { desktop } from '../platform/desktop';
import { getPreferences } from '../platform/preferences';
import { activeRoute, openPage } from '../router';
import { toast } from '../ui';
import { getSession, getState, run } from '../workspace';
import { addPluginAction, addPluginBlock } from './registry';

export const PLUGINS_FOLDER = '.morrow/plugins';
const SETTINGS_FILE = '.morrow/plugins.json';
const ID = /^[a-z0-9][\w-]{0,63}$/i;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
}

export interface PluginInfo extends PluginManifest {
  enabled: boolean;
  loaded: boolean;
  error: string | null;
}

interface Running {
  cleanups: Array<() => void>;
}

const running = new Map<string, Running>();
const errors = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function subscribePluginList(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const vault = () => desktop?.vault ?? null;

async function readJson(path: string): Promise<unknown> {
  try {
    const text = await vault()?.readText(path);
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

async function writeText(path: string, text: string): Promise<void> {
  const result = (await vault()?.apply([{ op: 'write', path, text }])) as Array<{
    ok: boolean;
    message?: string;
  }>;
  const failed = result?.find((item) => !item.ok);
  if (failed) throw new Error(failed.message ?? 'Could not save.');
}

async function enabledIds(): Promise<string[]> {
  const raw = (await readJson(SETTINGS_FILE)) as { enabled?: unknown } | null;
  return Array.isArray(raw?.enabled) ? raw.enabled.filter((id): id is string => typeof id === 'string') : [];
}

async function readManifest(id: string): Promise<PluginManifest | null> {
  const raw = (await readJson(`${PLUGINS_FOLDER}/${id}/manifest.json`)) as Partial<PluginManifest> | null;
  if (!raw) return null;
  const text = (value: unknown, fallback = '') =>
    typeof value === 'string' ? value.slice(0, 300) : fallback;
  return {
    id,
    name: text(raw.name, id),
    version: text(raw.version),
    description: text(raw.description),
    author: text(raw.author),
  };
}

// every plugin in the vault's folder, turned on or not
export async function listPlugins(): Promise<PluginInfo[]> {
  const api = vault();
  if (!api || !(await api.exists(PLUGINS_FOLDER).catch(() => false))) return [];
  const files = await api.list(PLUGINS_FOLDER).catch(() => []);
  const ids = new Set<string>();
  for (const file of files) {
    const match = /^\.morrow\/plugins\/([^/]+)\/manifest\.json$/.exec(file.path);
    if (match && ID.test(match[1]!)) ids.add(match[1]!);
  }
  const enabled = await enabledIds();
  const plugins: PluginInfo[] = [];
  for (const id of [...ids].sort()) {
    const manifest = await readManifest(id);
    if (!manifest) continue;
    plugins.push({
      ...manifest,
      enabled: enabled.includes(id),
      loaded: running.has(id),
      error: errors.get(id) ?? null,
    });
  }
  return plugins;
}

// what a plugin is given to work with. everything it adds is taken away again when it is turned off
function pluginApi(id: string, state: Running) {
  const keep = (cleanup: () => void) => {
    state.cleanups.push(cleanup);
    return cleanup;
  };
  const pageInfo = (pageId: PageId) => {
    const page = getState().pages[pageId];
    if (!page) return null;
    return {
      id: page.id,
      title: displayTitle(page),
      path: getSession().pathOf(page.id),
      tags: [...page.tags],
      properties: { ...page.extra },
      parentId: page.parentId,
      kind: page.kind,
    };
  };
  return Object.freeze({
    version: desktop?.version ?? '',
    plugin: id,
    commands: {
      add(command: { id: string; name: string; shortcut?: string; run: () => void }) {
        if (typeof command?.id !== 'string' || typeof command.run !== 'function')
          throw new Error('A command needs an id and run.');
        return keep(
          addPluginAction(id, {
            id: `plugin:${id}:${command.id}`,
            label: String(command.name ?? command.id),
            group: 'General',
            icon: Puzzle,
            ...(typeof command.shortcut === 'string' ? { shortcut: command.shortcut } : {}),
            keywords: `plugin ${id}`,
            run: () => command.run(),
          }),
        );
      },
    },
    slash: {
      add(item: {
        id: string;
        title: string;
        description?: string;
        keywords?: string;
        markdown?: string;
        run?: () => void;
      }) {
        if (typeof item?.id !== 'string') throw new Error('A slash item needs an id.');
        return keep(
          addPluginBlock(id, {
            id: `plugin:${id}:${item.id}`,
            title: String(item.title ?? item.id),
            ...(item.description ? { description: String(item.description) } : {}),
            icon: Puzzle,
            keywords: `${item.keywords ?? ''} plugin ${id}`,
            run: (editor, range) => {
              editor.chain().focus().deleteRange(range).run();
              if (typeof item.markdown === 'string')
                editor
                  .chain()
                  .focus()
                  .insertContent(markdownToDoc(item.markdown).content ?? [])
                  .run();
              else item.run?.();
            },
          }),
        );
      },
    },
    pages: {
      list: () => Object.keys(getState().pages).map(pageInfo).filter(Boolean),
      get: (pageId: string) => pageInfo(pageId),
      read: (pageId: string) => {
        const doc = getState().docs[pageId];
        return doc ? docToMarkdown(doc) : null;
      },
      current: () => {
        const route = activeRoute();
        return route.name === 'page' ? pageInfo(route.id) : null;
      },
      open: (pageId: string) => openPage(pageId),
      create(options: { title?: string; markdown?: string; parentId?: string | null }) {
        const pageId = createPage({
          title: options?.title ?? 'Untitled',
          parentId: options?.parentId ?? null,
          open: false,
        });
        if (pageId && typeof options?.markdown === 'string')
          run({ type: 'page.setDoc', id: pageId, doc: markdownToDoc(options.markdown), now: Date.now() });
        return pageId;
      },
      write(pageId: string, markdown: string) {
        const result = run({
          type: 'page.setDoc',
          id: pageId,
          doc: markdownToDoc(String(markdown)),
          now: Date.now(),
        });
        if (!result.ok) throw new Error(result.error);
      },
    },
    editor: {
      insert(markdown: string) {
        const editor = focusedEditor();
        if (!editor || editor.isDestroyed) return false;
        return editor
          .chain()
          .focus()
          .insertContent(markdownToDoc(String(markdown)).content ?? [])
          .run();
      },
      selectedText() {
        const editor = focusedEditor();
        if (!editor || editor.isDestroyed) return '';
        const { from, to } = editor.state.selection;
        return editor.state.doc.textBetween(from, to, '\n');
      },
    },
    onChange(listener: () => void) {
      return keep(getSession().subscribe(listener));
    },
    notice: (message: string) => toast(String(message)),
    styles: {
      add(css: string) {
        const style = document.createElement('style');
        style.dataset.plugin = id;
        style.textContent = String(css);
        document.head.appendChild(style);
        return keep(() => style.remove());
      },
    },
    storage: {
      get: () => readJson(`${PLUGINS_FOLDER}/${id}/data.json`),
      set: (value: unknown) => writeText(`${PLUGINS_FOLDER}/${id}/data.json`, JSON.stringify(value, null, 2)),
    },
    register: (cleanup: () => void) => keep(cleanup),
  });
}

async function load(id: string): Promise<void> {
  if (running.has(id) || !ID.test(id)) return;
  errors.delete(id);
  const code = await vault()?.readText(`${PLUGINS_FOLDER}/${id}/main.js`);
  if (!code) {
    errors.set(id, 'main.js is missing.');
    return;
  }
  const state: Running = { cleanups: [] };
  running.set(id, state);
  const url = URL.createObjectURL(
    new Blob([`${code}\n//# sourceURL=morrow-plugin-${id}.js`], { type: 'text/javascript' }),
  );
  try {
    const module = (await import(/* @vite-ignore */ url)) as {
      default?: (api: unknown) => unknown;
      activate?: (api: unknown) => unknown;
    };
    const activate = module.default ?? module.activate;
    if (typeof activate !== 'function') throw new Error('main.js should export a function as its default.');
    const result = await activate(pluginApi(id, state));
    if (typeof result === 'function') state.cleanups.push(result as () => void);
  } catch (error) {
    unload(id);
    errors.set(id, error instanceof Error ? error.message : String(error));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function unload(id: string): void {
  const state = running.get(id);
  if (!state) return;
  running.delete(id);
  for (const cleanup of state.cleanups.reverse()) {
    try {
      cleanup();
    } catch {
      // a plugin that fails to tidy up is still turned off
    }
  }
}

// at start, and when plugins are allowed on this computer, the ones turned on in this vault load
export async function startPlugins(): Promise<void> {
  if (!getPreferences().plugins || !vault()) return;
  for (const id of await enabledIds()) await load(id);
  for (const id of errors.keys())
    toast(`The plugin “${id}” could not start: ${errors.get(id)}`, { tone: 'error' });
  notify();
}

export function stopPlugins(): void {
  for (const id of [...running.keys()]) unload(id);
  notify();
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const ids = new Set(await enabledIds());
  if (enabled) ids.add(id);
  else ids.delete(id);
  await writeText(SETTINGS_FILE, `${JSON.stringify({ enabled: [...ids].sort() }, null, 2)}\n`);
  if (enabled && getPreferences().plugins) await load(id);
  if (!enabled) unload(id);
  notify();
}

export async function reloadPlugin(id: string): Promise<void> {
  unload(id);
  await load(id);
  notify();
}

const README = `# Morrow plugins

Each plugin is a folder here, named after its id, holding two files:

- manifest.json: {"id": "word-count", "name": "Word count", "version": "1.0.0", "description": "...", "author": "..."}
- main.js: a JavaScript module whose default export is a function Morrow calls with its API

\`\`\`js
export default function (morrow) {
  morrow.commands.add({
    id: 'count',
    name: 'Count the words on this page',
    run: () => {
      const page = morrow.pages.current();
      const words = (morrow.pages.read(page.id) ?? '').split(/\\s+/).filter(Boolean).length;
      morrow.notice(\`\${words} words\`);
    },
  });
}
\`\`\`

Plugins run with the same access to your notes Morrow has. Only add ones you trust.
See PLUGINS.md in Morrow's repository for everything the API offers.
`;

// makes the folder, with a note on how to write a plugin, and shows it
export async function openPluginsFolder(): Promise<void> {
  const api = vault();
  if (!api) return;
  if (!(await api.exists(`${PLUGINS_FOLDER}/README.md`).catch(() => false)))
    await writeText(`${PLUGINS_FOLDER}/README.md`, README).catch(() => undefined);
  await api.reveal(`${PLUGINS_FOLDER}/README.md`);
}
