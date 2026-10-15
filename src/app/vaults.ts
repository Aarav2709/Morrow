import { commitEditors } from './editor/commits';
import { COPY_LEGACY_KEY } from './legacy';
import { desktop } from './platform/desktop';
import { toast } from './ui';
import { getSession } from './workspace';

// opens another folder: pending edits are saved, then the window starts over with the new vault
export async function switchVault(dir: string, options: { copyLegacy?: boolean } = {}): Promise<boolean> {
  const vault = desktop?.vault;
  if (!vault) return false;
  try {
    commitEditors();
    await getSession().flush();
  } catch {
    // no workspace is open yet when choosing the first vault
  }
  const result = await vault.select(dir);
  if (!result.ok) {
    toast(result.error ?? 'That folder could not be opened.', { tone: 'error' });
    return false;
  }
  if (options.copyLegacy) sessionStorage.setItem(COPY_LEGACY_KEY, '1');
  window.location.reload();
  return true;
}

export async function chooseVaultFolder(options: { copyLegacy?: boolean } = {}): Promise<void> {
  const dir = await desktop?.vault?.choose();
  if (dir) await switchVault(dir, options);
}

export async function createVault(options: { copyLegacy?: boolean } = {}): Promise<void> {
  const vault = desktop?.vault;
  if (!vault) return;
  try {
    await switchVault(await vault.createDefault(), options);
  } catch (error) {
    toast(`The folder could not be created: ${error instanceof Error ? error.message : String(error)}`, { tone: 'error' });
  }
}
