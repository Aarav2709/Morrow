// Main entry point for Morrow MCP Server.
// Communicates via stdio or HTTP/SSE using the Model Context Protocol.

import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpVaultManager } from './vault';
import { registerMcpTools } from './tools';
import { registerMcpResources } from './resources';
import { registerMcpPrompts } from './prompts';

const VERSION = '1.1.0';

function printHelp(): void {
  process.stderr.write(`
Morrow MCP Server v${VERSION}
Model Context Protocol integration for Morrow vaults.

Usage:
  morrow-mcp [options]

Options:
  -v, --vault <path>    Path to the Morrow vault directory (defaults to current dir or auto-detected vault)
  -p, --port <port>     Start as an HTTP/SSE server on the specified port instead of stdio
  -h, --help            Show this help message
  --version             Show version number

Environment variables:
  MORROW_VAULT          Fallback path to the Morrow vault directory
  MORROW_MCP_PORT       Default port to run HTTP/SSE server on
`);
}

function parseArgs(args: string[]): { vaultPath?: string; port?: number } {
  let vaultPath: string | undefined;
  let port: number | undefined;

  if (process.env.MORROW_MCP_PORT) {
    const envPort = parseInt(process.env.MORROW_MCP_PORT, 10);
    if (!isNaN(envPort) && envPort > 0 && envPort <= 65535) {
      port = envPort;
    }
  }

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
    if (arg === '--port' || arg === '-p') {
      const next = args[i + 1];
      const parsedPort = next ? parseInt(next, 10) : NaN;
      if (isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        process.stderr.write('Error: --port requires a valid port number (1-65535).\n');
        process.exit(1);
      }
      port = parsedPort;
      i++;
    }
  }

  return { vaultPath, port };
}

function createServerInstance(vault: McpVaultManager): McpServer {
  const server = new McpServer({
    name: 'morrow',
    version: VERSION,
  });

  registerMcpTools(server, vault);
  registerMcpResources(server, vault);
  registerMcpPrompts(server, vault);

  return server;
}

async function main(): Promise<void> {
  const { vaultPath, port } = parseArgs(process.argv.slice(2));

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

  if (port !== undefined) {
    // Run as HTTP/SSE Server
    const transports = new Map<string, SSEServerTransport>();

    const httpServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const host = req.headers.host || `localhost:${port}`;
      const url = new URL(req.url || '/', `http://${host}`);

      if (url.pathname === '/health' || url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            name: 'morrow',
            version: VERSION,
            vault: vault.vaultPath,
            clients: transports.size,
          }),
        );
        return;
      }

      if (url.pathname === '/sse') {
        const server = createServerInstance(vault);
        const transport = new SSEServerTransport('/message', res);
        transports.set(transport.sessionId, transport);

        transport.onclose = () => {
          transports.delete(transport.sessionId);
          process.stderr.write(
            `[Morrow MCP] Client disconnected. Active sessions: ${transports.size}\n`,
          );
        };

        await server.connect(transport);
        process.stderr.write(
          `[Morrow MCP] Client connected via SSE. Active sessions: ${transports.size}\n`,
        );
        return;
      }

      if (url.pathname === '/message') {
        const sessionId = url.searchParams.get('sessionId');
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Session not found or expired.');
          return;
        }
        await transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          {
            name: 'Morrow MCP Server',
            version: VERSION,
            status: 'running',
            vault: vault.vaultPath,
            endpoints: {
              sse: `http://${host}/sse`,
              message: `http://${host}/message`,
              status: `http://${host}/status`,
            },
          },
          null,
          2,
        ),
      );
    });

    httpServer.listen(port, '127.0.0.1', () => {
      process.stderr.write(
        `[Morrow MCP] HTTP/SSE server running at http://127.0.0.1:${port}/sse\n`,
      );
    });

    const shutdown = async () => {
      process.stderr.write('[Morrow MCP] Stopping HTTP server...\n');
      httpServer.close(() => {
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    // Run as stdio server
    const server = createServerInstance(vault);
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
}

main().catch((error) => {
  process.stderr.write(
    `[Morrow MCP] Fatal error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
