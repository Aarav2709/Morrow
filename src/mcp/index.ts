// Main entry point for Morrow MCP Server.
// Communicates via stdio using the Model Context Protocol.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpVaultManager } from './vault';
import { registerMcpTools } from './tools';
import { registerMcpResources } from './resources';
import { registerMcpPrompts } from './prompts';

const VERSION = '1.1.0';

function printHelp(): void {
  // Stdout is allowed before stdio transport starts, but writing to stderr is even safer
  process.stderr.write(`
Morrow MCP Server v${VERSION}
Model Context Protocol integration for Morrow vaults.

Usage:
  morrow-mcp [options]

Options:
  -v, --vault <path>    Path to the Morrow vault directory (defaults to current dir or auto-detected vault)
  -h, --help            Show this help message
  --version             Show version number

Environment variables:
  MORROW_VAULT          Fallback path to the Morrow vault directory
`);
}

function parseArgs(args: string[]): { vaultPath?: string } {
  let vaultPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--version') {
      process.stderr.write(`v${VERSION}\n`);
      process.exit(0);
    }
    if (arg === '--vault' || arg === '-v') {
      const next = args[i + 1];
      if (!next || next.startsWith('-')) {
        process.stderr.write('Error: --vault requires a directory path.\n');
        process.exit(1);
      }
      vaultPath = next;
      i++;
    }
  }

  return { vaultPath };
}

async function main(): Promise<void> {
  const { vaultPath } = parseArgs(process.argv.slice(2));

  let vault: McpVaultManager;
  try {
    vault = await McpVaultManager.open(vaultPath);
    process.stderr.write(`[Morrow MCP] Opened vault at: ${vault.vaultPath}\n`);
  } catch (error) {
    process.stderr.write(
      `[Morrow MCP] Failed to open vault: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  const server = new McpServer({
    name: 'morrow',
    version: VERSION,
  });

  registerMcpTools(server, vault);
  registerMcpResources(server, vault);
  registerMcpPrompts(server, vault);

  const transport = new StdioServerTransport();

  process.on('SIGINT', async () => {
    process.stderr.write('[Morrow MCP] Shutting down...\n');
    await server.close().catch(() => {});
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    process.stderr.write('[Morrow MCP] Shutting down...\n');
    await server.close().catch(() => {});
    process.exit(0);
  });

  await server.connect(transport);
  process.stderr.write('[Morrow MCP] Server running on stdio.\n');
}

main().catch((error) => {
  process.stderr.write(
    `[Morrow MCP] Fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
