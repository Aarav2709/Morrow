import type { VaultScan } from '../../core/vault/load';
import { encodePathForUrl } from '../../core/vault/paths';
import type { VaultOp, VaultOpResult } from '../../core/vault/plan';
import type { VaultBridge, VaultChange } from '../../storage/vaultBridge';
import type { DesktopVaultApi } from './desktop';

// the vault as the desktop shell exposes it, every call goes through the shell's path checks
export function desktopVaultBridge(api: DesktopVaultApi, root: string): VaultBridge {
  return {
    root,
    scan: async () => (await api.scan()) as VaultScan,
    apply: async (ops: VaultOp[]) => (await api.apply(ops)) as VaultOpResult[],
    readText: (path) => api.readText(path),
    readBytes: async (path) => {
      const bytes = await api.readBytes(path);
      return bytes ? (bytes.slice().buffer as ArrayBuffer) : null;
    },
    createFile: (path, data) => api.createFile(path, data),
    exists: (path) => api.exists(path),
    listFiles: (dir) => api.list(dir),
    onChange: (listener) => api.onChanges((changes) => listener(changes as VaultChange[])),
    fileUrl: (path) => `morrow-file://vault/${encodePathForUrl(path)}`,
  };
}

export function vaultName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}
