import type { VaultScan } from '../../core/vault/load';
import { encodePathForUrl } from '../../core/vault/paths';
import type { VaultOp, VaultOpResult } from '../../core/vault/plan';
import type { VaultBridge, VaultChange } from '../../storage/vaultBridge';
import { useEffect, useState } from 'react';
import { desktop, nativeFileUrl } from './desktop';
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
    fileUrl: (path) => nativeFileUrl('vault', encodePathForUrl(path)),
  };
}

export function vaultName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

// sent when the open vault is given a new name, so the sidebar shows it straight away
export const VAULT_RENAMED = 'morrow:vault-renamed';

// the name a vault shows: the one it was given, kept in the vault, or else its folder's name
export function useVaultName(root: string | null): string {
  const [named, setNamed] = useState<string | null>(null);
  useEffect(() => {
    if (!root) return;
    let live = true;
    const load = () =>
      void desktop?.vault
        ?.state()
        .then((vaults) => live && setNamed(vaults.recent.find((item) => item.path === root)?.name ?? null))
        .catch(() => undefined);
    load();
    window.addEventListener(VAULT_RENAMED, load);
    return () => {
      live = false;
      window.removeEventListener(VAULT_RENAMED, load);
    };
  }, [root]);
  return named ?? (root ? vaultName(root) : '');
}
