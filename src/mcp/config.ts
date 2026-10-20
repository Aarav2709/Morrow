// Configuration and feature-gate helper for Morrow MCP.
// Reads persistent MCP state from Morrow's app data or environment variables.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function isMcpConfigEnabled(customVaultPath?: string): Promise<boolean> {
  // Explicit environment variable override takes top priority
  if (process.env.MORROW_MCP_ENABLED !== undefined) {
    return process.env.MORROW_MCP_ENABLED === '1' || process.env.MORROW_MCP_ENABLED === 'true';
  }

  // Default to enabled during automated unit test suites when not explicitly overridden
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return true;
  }

  // Check Morrow's global app data (UserData / mcp.json)
  const appData =
    process.env.APPDATA ||
    (process.platform === 'darwin'
      ? path.join(process.env.HOME ?? '', 'Library', 'Application Support')
      : path.join(process.env.HOME ?? '', '.config'));

  if (appData) {
    const configPath = path.join(appData, 'Morrow', 'mcp.json');
    try {
      const raw = await readFile(configPath, 'utf8');
      const parsed = JSON.parse(raw) as { enabled?: boolean };
      if (typeof parsed.enabled === 'boolean') {
        return parsed.enabled;
      }
    } catch {
      // not found or not created yet
    }
  }

  // Optional vault-level override: <vault>/.morrow/mcp.json
  if (customVaultPath) {
    try {
      const vaultConfig = path.join(customVaultPath, '.morrow', 'mcp.json');
      const raw = await readFile(vaultConfig, 'utf8');
      const parsed = JSON.parse(raw) as { enabled?: boolean };
      if (typeof parsed.enabled === 'boolean') {
        return parsed.enabled;
      }
    } catch {
      // not found
    }
  }

  return false;
}
