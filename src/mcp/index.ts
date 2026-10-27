import { isMcpConfigEnabled } from './config';
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

const VERSION = '1.2.1';

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

  const enabled = await isMcpConfigEnabled(vaultPath);
  if (!enabled) {
    process.stderr.write(
      '[Morrow MCP] MCP is disabled in Morrow settings (Settings > Assistant). Please enable the MCP switch in Morrow to connect.\n',
    );
    process.exit(1);
  }

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
      // only apps on this computer may connect. a web page can't reach the vault through the browser: there
      // are no cors headers, a page from elsewhere is refused, and so is a request whose host isn't this
      // machine, as dns rebinding sends
      const host = req.headers.host || `127.0.0.1:${port}`;
      const local = (name: string) =>
        ['127.0.0.1', 'localhost', '::1'].includes(name.replace(/^\[|\]$/g, ''));
      const origin = req.headers.origin;
      // an origin that isn't this machine, or can't be read, is a web page
      const fromPage = (() => {
        if (origin === undefined) return false;
        try {
          return !local(new URL(origin).hostname);
        } catch {
          return true;
        }
      })();
      if (!local(host.replace(/:\d+$/, '')) || fromPage) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

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

      if (url.pathname === '/sse' || url.pathname === '/mcp') {
        const server = createServerInstance(vault);
        const transport = new SSEServerTransport('/message', res);
        transports.set(transport.sessionId, transport);

        transport.onclose = () => {
          transports.delete(transport.sessionId);
          process.stderr.write(`[Morrow MCP] Client disconnected. Active sessions: ${transports.size}\n`);
        };

        await server.connect(transport);
        process.stderr.write(`[Morrow MCP] Client connected via SSE. Active sessions: ${transports.size}\n`);
        return;
      }

      if (url.pathname === '/message' || url.pathname === '/messages') {
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

    // on this computer only, never the local network
    httpServer.listen(port, '127.0.0.1', () => {
      process.stderr.write(
        `[Morrow MCP] HTTP/SSE server running on port ${port} (endpoints: /sse, /message)\n`,
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
    `[Morrow MCP] Fatal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
