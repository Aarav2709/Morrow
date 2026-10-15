// an in memory vault with the same rules as the desktop shell, used by tests
import type { VaultScan } from '../core/vault/load';
import { dirname, isHiddenPath, isPageFile, MORROW_DIR } from '../core/vault/paths';
import type { VaultOp, VaultOpResult } from '../core/vault/plan';
import type { VaultBridge, VaultChange, VaultFileInfo } from './vaultBridge';

export class MemoryVault implements VaultBridge {
  readonly root = '/vault';
  readonly files = new Map<string, string | ArrayBuffer>();
  readonly dirs = new Set<string>();
  readonly trashed: string[] = [];
  private listeners = new Set<(changes: VaultChange[]) => void>();
  private clock = 1_000_000;

  constructor(initial: Record<string, string> = {}) {
    for (const [path, text] of Object.entries(initial)) this.put(path, text);
  }

  private put(path: string, data: string | ArrayBuffer): void {
    this.files.set(path, data);
    for (let dir = dirname(path); dir; dir = dirname(dir)) this.dirs.add(dir);
  }

  text(path: string): string | undefined {
    const value = this.files.get(path);
    return typeof value === 'string' ? value : undefined;
  }

  paths(): string[] {
    return [...this.files.keys()].filter((path) => !path.startsWith(`${MORROW_DIR}/`)).sort();
  }

  async scan(): Promise<VaultScan> {
    const files = [];
    const others = [];
    for (const [path, data] of this.files) {
      if (typeof data === 'string' && isPageFile(path) && !isHiddenPath(path)) {
        files.push({ path, text: data, mtime: this.clock, birthtime: this.clock });
      } else if (!isHiddenPath(path)) others.push(path);
    }
    const folders = [...this.dirs]
      .filter((dir) => !isHiddenPath(dir) || dir === '.trash')
      .map((path) => ({
        path,
        mtime: this.clock,
        empty: ![...this.files.keys(), ...this.dirs].some((other) => other.startsWith(`${path}/`)),
      }));
    const json = (path: string) => {
      const text = this.text(path);
      return text ? (JSON.parse(text) as unknown) : null;
    };
    return { files, folders, others, registry: json(`${MORROW_DIR}/workspace.json`), recent: json(`${MORROW_DIR}/recent.json`) };
  }

  async apply(ops: VaultOp[]): Promise<VaultOpResult[]> {
    const results: VaultOpResult[] = [];
    for (const op of ops) {
      const result = this.applyOne(op);
      results.push(result);
      if (!result.ok) break;
    }
    return results;
  }

  private applyOne(op: VaultOp): VaultOpResult {
    switch (op.op) {
      case 'write': {
        if (op.expect !== undefined) {
          const current = this.text(op.path) ?? null;
          if (current !== op.expect) return { ok: false, code: 'conflict', message: 'changed on disk', current };
        }
        this.put(op.path, op.text);
        return { ok: true };
      }
      case 'rename': {
        const isFile = this.files.has(op.from);
        const isDir = this.dirs.has(op.from);
        if (!isFile && !isDir) return op.optional ? { ok: true } : { ok: false, code: 'error', message: `${op.from} is missing` };
        const caseOnly = op.from.toLowerCase() === op.to.toLowerCase();
        if (!caseOnly && (this.files.has(op.to) || this.dirs.has(op.to))) return { ok: false, code: 'exists', message: `${op.to} exists` };
        if (isFile) {
          const data = this.files.get(op.from)!;
          this.files.delete(op.from);
          this.put(op.to, data);
        } else {
          for (const [path, data] of [...this.files]) {
            if (!path.startsWith(`${op.from}/`)) continue;
            this.files.delete(path);
            this.put(op.to + path.slice(op.from.length), data);
          }
          for (const dir of [...this.dirs]) {
            if (dir === op.from || dir.startsWith(`${op.from}/`)) {
              this.dirs.delete(dir);
              this.dirs.add(op.to + dir.slice(op.from.length));
            }
          }
          for (let dir = dirname(op.to); dir; dir = dirname(dir)) this.dirs.add(dir);
        }
        return { ok: true };
      }
      case 'remove':
        if (this.files.delete(op.path)) this.trashed.push(op.path);
        return { ok: true };
      case 'rmdir': {
        const busy = [...this.files.keys(), ...this.dirs].some((path) => path.startsWith(`${op.path}/`));
        if (!busy) this.dirs.delete(op.path);
        return { ok: true };
      }
    }
  }

  async readText(path: string): Promise<string | null> {
    return this.text(path) ?? null;
  }

  async readBytes(path: string): Promise<ArrayBuffer | null> {
    const value = this.files.get(path);
    if (value === undefined) return null;
    return typeof value === 'string' ? (new TextEncoder().encode(value).buffer as ArrayBuffer) : value;
  }

  async createFile(path: string, data: ArrayBuffer): Promise<void> {
    if (this.files.has(path)) throw new Error(`${path} exists`);
    this.put(path, data);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }

  async listFiles(dir: string): Promise<VaultFileInfo[]> {
    return [...this.files]
      .filter(([path]) => path.startsWith(`${dir}/`))
      .map(([path, data]) => ({ path, size: typeof data === 'string' ? data.length : data.byteLength, mtime: this.clock }));
  }

  onChange(listener: (changes: VaultChange[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  fileUrl(path: string): string {
    return `memory://${path}`;
  }

  // an edit made by another app, reported the way the file watcher reports it
  external(changes: Record<string, string | null>): void {
    this.clock += 1000;
    const reported: VaultChange[] = [];
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) this.files.delete(path);
      else this.put(path, text);
      reported.push({ path, text, mtime: this.clock, birthtime: this.clock });
    }
    for (const listener of this.listeners) listener(reported);
  }
}
