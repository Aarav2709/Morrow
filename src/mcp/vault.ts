import { isMcpConfigEnabled } from './config';
// Standalone vault manager for Morrow MCP server.
// Directly interacts with the file system and uses Morrow's core pure logic without requiring Electron.

import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  displayTitle,
  emptyDoc,
} from '../core/model';
import type { PageId, PageMeta, WorkspaceState } from '../core/model';
import { applyCommand } from '../core/commands';
import type { Command } from '../core/commands';
import { searchWorkspace } from '../core/search';
import type { SearchResult } from '../core/search';
import { collectTags } from '../core/tags';
import type { TagSummary } from '../core/tags';
import { buildGraph, DEFAULT_GRAPH_OPTIONS } from '../core/graph';
import type { GraphOptions, GraphNode, GraphLink } from '../core/graph';
import { loadVault } from '../core/vault/load';
import type { ScannedFile, ScannedFolder, VaultScan, RegistryEntry } from '../core/vault/load';
import { linkTargets, placePages } from '../core/vault/layout';
import type { Placement } from '../core/vault/layout';
import { composeFrontmatter, managedFrontmatter, renderPageText } from '../core/vault/pageFile';
import type { PageSource } from '../core/vault/pageFile';
import {
  basename,
  dirname,
  isInTrash,
  isPageFile,
  MORROW_DIR,
  TRASH_DIR,
} from '../core/vault/paths';
import { childrenOf, livePages } from '../core/tree';
import { markdownToDoc } from '../core/markdown/parse';
import { docToMarkdown } from '../core/markdown/serialize';
import { dailyInsertIndex, dailyTitle, dateKey, findDailyNote, findJournal, JOURNAL_TITLE } from '../core/daily';

const MAX_DEPTH = 64;
const MAX_FILES = 200_000;
const MAX_TEXT_BYTES = 32 * 1024 * 1024;
const TEMP_PREFIX = '.morrow-tmp-';

export class McpVaultManager {
  private state: WorkspaceState = { pages: {}, docs: {} };
  private layout: Map<PageId, Placement> = new Map();
  private sources: Map<PageId, PageSource> = new Map();
  private texts: Map<PageId, string> = new Map();
  private folderOnly: Set<PageId> = new Set();
  private reserved: Set<string> = new Set();

  private constructor(public readonly vaultPath: string) {}

  public static async open(customPath?: string): Promise<McpVaultManager> {
    const resolvedPath = await resolveVaultPath(customPath);
    const manager = new McpVaultManager(resolvedPath);
    await manager.reload();
    return manager;
  }

  public async assertEnabled(): Promise<void> {
    const enabled = await isMcpConfigEnabled(this.vaultPath);
    if (!enabled) {
      throw new Error(
        'Morrow MCP is disabled in settings. Please enable the MCP switch in Morrow (Configuración > Asistente).'
      );
    }
  }

  public getState(): WorkspaceState {
    return this.state;
  }

  public getLayout(): ReadonlyMap<PageId, Placement> {
    return this.layout;
  }

  public async reload(): Promise<void> {
    const scan = await this.scanDisk();
    const loaded = loadVault(scan, () => randomUUID().slice(0, 8));
    this.state = {
      pages: Object.fromEntries(loaded.pages.map((p) => [p.id, p])),
      docs: loaded.docs,
    };
    this.folderOnly = loaded.folderOnly;
    this.sources = loaded.sources;
    this.texts = loaded.texts;
    this.reserved = loaded.reserved;
    this.layout = placePages(this.state, loaded.layout, this.folderOnly, this.reserved);

    if (loaded.registryChanged) {
      await this.saveRegistry();
    }
  }

  private async scanDisk(): Promise<VaultScan> {
    const files: ScannedFile[] = [];
    const folders: ScannedFolder[] = [];
    const others: string[] = [];
    let count = 0;

    const toRelative = (absolute: string) =>
      path.relative(this.vaultPath, absolute).split(path.sep).join('/');

    const isHidden = (rel: string) =>
      rel.split('/').some((part, idx) => part.startsWith('.') && !(idx === 0 && part === '.trash'));

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || count > MAX_FILES) return;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (++count > MAX_FILES) return;
        const absolute = path.join(dir, entry.name);
        const rel = toRelative(absolute);
        if (entry.name.startsWith(TEMP_PREFIX) || entry.isSymbolicLink() || isHidden(rel)) {
          continue;
        }

        if (entry.isDirectory()) {
          const info = await stat(absolute).catch(() => null);
          const children = await readdir(absolute).catch(() => ['?']);
          folders.push({
            path: rel,
            mtime: info?.mtimeMs ?? 0,
            empty: children.length === 0,
          });
          await walk(absolute, depth + 1);
        } else if (entry.isFile()) {
          if (isPageFile(rel)) {
            const info = await stat(absolute).catch(() => null);
            if (!info || info.size > MAX_TEXT_BYTES) {
              others.push(rel);
              continue;
            }
            const text = await readFile(absolute, 'utf8').catch(() => null);
            if (text === null) continue;
            files.push({
              path: rel,
              text,
              mtime: info.mtimeMs,
              birthtime: info.birthtimeMs || info.ctimeMs,
            });
          } else {
            others.push(rel);
          }
        }
      }
    };

    await walk(this.vaultPath, 0);

    const readJson = async (rel: string): Promise<unknown> => {
      try {
        const text = await readFile(path.join(this.vaultPath, rel), 'utf8');
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    return {
      files,
      folders,
      others,
      registry: await readJson(`${MORROW_DIR}/workspace.json`),
      recent: await readJson(`${MORROW_DIR}/recent.json`),
    };
  }

  public resolvePage(identifier: string): PageMeta | null {
    const trimmed = identifier.trim();
    if (!trimmed) return null;
    if (this.state.pages[trimmed]) {
      return this.state.pages[trimmed]!;
    }
    const lower = trimmed.toLowerCase();
    for (const page of livePages(this.state.pages)) {
      if (page.id.toLowerCase() === lower || displayTitle(page).toLowerCase() === lower) {
        return page;
      }
    }
    return null;
  }

  public listPages(parentId?: string | null): PageMeta[] {
    const targetParent = parentId ? this.resolvePage(parentId)?.id ?? null : null;
    return childrenOf(this.state.pages, targetParent);
  }

  public readPage(identifier: string): { page: PageMeta; markdown: string; path: string } {
    const page = this.resolvePage(identifier);
    if (!page) {
      throw new Error(`Page "${identifier}" not found in vault.`);
    }

    const doc = this.state.docs[page.id] ?? emptyDoc();
    const source = this.sources.get(page.id);
    const placement = this.layout.get(page.id);
    const filePath = placement?.file ?? '';

    const markdown =
      source && source.body !== null
        ? source.body
        : docToMarkdown(doc, {
            linkTarget: (id) => linkTargets(this.layout).get(id) ?? null,
            titleOf: (id) => (this.state.pages[id] ? displayTitle(this.state.pages[id]!) : null),
          });

    return { page, markdown, path: filePath };
  }

  public searchPages(query: string, limit = 20): SearchResult[] {
    return searchWorkspace(this.state, query, limit);
  }

  public listTags(): TagSummary[] {
    return collectTags(this.state);
  }

  public getGraph(options?: Partial<GraphOptions>): { nodes: GraphNode[]; links: GraphLink[] } {
    return buildGraph(this.state, { ...DEFAULT_GRAPH_OPTIONS, ...options });
  }

  public async createPage(params: {
    title: string;
    content?: string;
    parent?: string | null;
    tags?: string[];
  }): Promise<{ page: PageMeta; path: string }> {
    const title = params.title.trim();
    if (!title) throw new Error('Page title cannot be empty.');

    let parentId: PageId | null = null;
    if (params.parent) {
      const parentPage = this.resolvePage(params.parent);
      if (!parentPage) {
        throw new Error(`Parent page "${params.parent}" not found.`);
      }
      parentId = parentPage.id;
    }

    const id = randomUUID().slice(0, 8);
    const now = Date.now();
    const doc = params.content ? markdownToDoc(params.content) : emptyDoc();

    const command: Command = {
      type: 'page.create',
      id,
      parentId,
      title,
      now,
      doc,
      tags: params.tags ?? [],
    };

    const applied = applyCommand(this.state, command);
    if (!applied.ok) {
      throw new Error(`Failed to create page: ${applied.error}`);
    }

    this.state = applied.value.state;
    this.layout = placePages(this.state, this.layout, this.folderOnly, this.reserved);

    const page = this.state.pages[id]!;
    const placement = this.layout.get(id);
    if (!placement?.file) {
      throw new Error(`Failed to calculate file placement for new page ${id}.`);
    }

    await this.writePageFile(id, params.content ?? '');
    await this.saveRegistry();

    return { page, path: placement.file };
  }

  public async editPage(params: {
    page: string;
    content: string;
  }): Promise<{ page: PageMeta; path: string }> {
    const page = this.resolvePage(params.page);
    if (!page) {
      throw new Error(`Page "${params.page}" not found.`);
    }

    const now = Date.now();
    const doc = markdownToDoc(params.content);

    const command: Command = {
      type: 'page.setDoc',
      id: page.id,
      doc,
      now,
    };

    const applied = applyCommand(this.state, command);
    if (!applied.ok) {
      throw new Error(`Failed to update page: ${applied.error}`);
    }

    this.state = applied.value.state;
    const placement = this.layout.get(page.id);
    if (!placement?.file) {
      throw new Error(`Page ${page.id} has no file placement.`);
    }

    // Invalidate cached source body to ensure fresh render
    const source = this.sources.get(page.id);
    if (source) {
      this.sources.set(page.id, { ...source, body: null });
    }

    await this.writePageFile(page.id, params.content);
    return { page: this.state.pages[page.id]!, path: placement.file };
  }

  public async appendToPage(params: {
    page: string;
    content: string;
  }): Promise<{ page: PageMeta; path: string }> {
    const existing = this.readPage(params.page);
    const newContent = existing.markdown.trim()
      ? `${existing.markdown.trimEnd()}\n\n${params.content.trimStart()}`
      : params.content;

    return this.editPage({ page: params.page, content: newContent });
  }

  public async trashPage(identifier: string): Promise<PageMeta> {
    const page = this.resolvePage(identifier);
    if (!page) {
      throw new Error(`Page "${identifier}" not found.`);
    }

    const previousPlacement = this.layout.get(page.id);
    const now = Date.now();
    const command: Command = {
      type: 'page.trash',
      id: page.id,
      now,
    };

    const applied = applyCommand(this.state, command);
    if (!applied.ok) {
      throw new Error(`Failed to trash page: ${applied.error}`);
    }

    this.state = applied.value.state;
    this.layout = placePages(this.state, this.layout, this.folderOnly, this.reserved);

    // Move file to .trash directory
    const newPlacement = this.layout.get(page.id);
    if (previousPlacement?.file && newPlacement?.file && previousPlacement.file !== newPlacement.file) {
      const fromPath = path.join(this.vaultPath, previousPlacement.file);
      const toPath = path.join(this.vaultPath, newPlacement.file);
      await mkdir(path.dirname(toPath), { recursive: true });
      await rename(fromPath, toPath).catch(() => null);
    }

    await this.saveRegistry();
    return this.state.pages[page.id]!;
  }

  public async todaysNote(): Promise<{ page: PageMeta; markdown: string; path: string }> {
    const today = new Date();
    const key = dateKey(today);
    const existing = findDailyNote(this.state, key);
    if (existing) {
      return this.readPage(existing.id);
    }

    let journal = findJournal(this.state);
    const now = Date.now();

    if (!journal) {
      const journalId = randomUUID().slice(0, 8);
      const createJournal: Command = {
        type: 'page.create',
        id: journalId,
        parentId: null,
        now,
        title: JOURNAL_TITLE,
        kind: 'journal',
      };
      const applied = applyCommand(this.state, createJournal);
      if (!applied.ok) {
        throw new Error(`Failed to create Journal: ${applied.error}`);
      }
      this.state = applied.value.state;
      this.layout = placePages(this.state, this.layout, this.folderOnly, this.reserved);
      journal = this.state.pages[journalId]!;
      await this.writePageFile(journalId, '');
    }

    const id = randomUUID().slice(0, 8);
    const siblings = childrenOf(this.state.pages, journal.id);
    const title = dailyTitle(today);

    const command: Command = {
      type: 'page.create',
      id,
      parentId: journal.id,
      now,
      title,
      dailyDate: key,
      index: dailyInsertIndex(siblings, key),
    };

    const applied = applyCommand(this.state, command);
    if (!applied.ok) {
      throw new Error(`Failed to create today's note: ${applied.error}`);
    }

    this.state = applied.value.state;
    this.layout = placePages(this.state, this.layout, this.folderOnly, this.reserved);

    const placement = this.layout.get(id);
    if (!placement?.file) {
      throw new Error('Failed to locate placement for daily note.');
    }

    const initialContent = `# ${title}\n\n`;
    await this.writePageFile(id, initialContent);
    await this.saveRegistry();

    return {
      page: this.state.pages[id]!,
      markdown: initialContent,
      path: placement.file,
    };
  }

  private async writePageFile(pageId: PageId, bodyText: string): Promise<void> {
    const page = this.state.pages[pageId];
    const placement = this.layout.get(pageId);
    if (!page || !placement?.file) return;

    const parent = page.parentId ? this.state.pages[page.parentId] : undefined;
    const parentDatabase = parent?.kind === 'database' ? parent.database : null;

    const managed = managedFrontmatter(page, basename(placement.folder), parentDatabase);
    const source = this.sources.get(pageId) ?? null;
    const frontmatter = composeFrontmatter(managed, page.extra, source);

    const fullText = renderPageText(frontmatter, source, bodyText);
    const absolutePath = path.join(this.vaultPath, placement.file);

    await this.writeAtomic(absolutePath, fullText);
    this.texts.set(pageId, fullText);
  }

  private async writeAtomic(absolutePath: string, text: string): Promise<void> {
    const dir = path.dirname(absolutePath);
    await mkdir(dir, { recursive: true });
    const tempFile = path.join(dir, `${TEMP_PREFIX}${randomUUID().slice(0, 8)}.tmp`);
    await writeFile(tempFile, text, 'utf8');
    await rename(tempFile, absolutePath);
  }

  private async saveRegistry(): Promise<void> {
    const pages: Record<string, RegistryEntry> = {};
    for (const [id, placement] of [...this.layout].sort(([, a], [, b]) =>
      (a.file ?? a.folder).localeCompare(b.file ?? b.folder),
    )) {
      const page = this.state.pages[id];
      if (!page) continue;
      const entry: RegistryEntry = { id, created: page.createdAt, order: page.order };
      if (page.favorite) entry.favorite = true;
      if (page.trashedAt !== null && isInTrash(placement.folder) && dirname(placement.folder) === TRASH_DIR) {
        entry.trashed = page.trashedAt;
        if (page.parentId) entry.parent = page.parentId;
      }
      if (page.icon && (page.kind === 'canvas' || placement.file === null)) entry.icon = page.icon;
      pages[placement.file ?? placement.folder] = entry;
    }

    const registryPath = path.join(this.vaultPath, MORROW_DIR, 'workspace.json');
    const content = `${JSON.stringify({ version: 1, pages }, null, 2)}\n`;
    await this.writeAtomic(registryPath, content);
  }
}

async function resolveVaultPath(customPath?: string): Promise<string> {
  if (customPath) {
    const resolved = path.resolve(customPath);
    const exists = await stat(resolved)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (!exists) {
      throw new Error(`Specified vault path does not exist or is not a directory: ${resolved}`);
    }
    return resolved;
  }

  if (process.env.MORROW_VAULT) {
    const resolved = path.resolve(process.env.MORROW_VAULT);
    const exists = await stat(resolved)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (exists) return resolved;
  }

  // Look for .morrow in current working directory or ancestors
  let currentDir = process.cwd();
  while (true) {
    const morrowDir = path.join(currentDir, MORROW_DIR);
    const hasMorrow = await stat(morrowDir)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (hasMorrow) return currentDir;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  // Try to read Morrow desktop vault list
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME ?? '', 'Library', 'Application Support')
      : path.join(process.env.HOME ?? '', '.config'));

  if (appData) {
    const vaultsJson = path.join(appData, 'Morrow', 'vaults.json');
    try {
      const data = JSON.parse(await readFile(vaultsJson, 'utf8')) as {
        current?: string;
        recent?: Array<{ path: string }>;
      };
      if (data.current) {
        const exists = await stat(data.current)
          .then((s) => s.isDirectory())
          .catch(() => false);
        if (exists) return data.current;
      }
      if (Array.isArray(data.recent) && data.recent[0]?.path) {
        const exists = await stat(data.recent[0].path)
          .then((s) => s.isDirectory())
          .catch(() => false);
        if (exists) return data.recent[0].path;
      }
    } catch {
      // Ignored
    }
  }

  // Fallback to process.cwd()
  return process.cwd();
}
