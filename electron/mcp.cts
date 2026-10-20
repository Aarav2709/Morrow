import { app } from 'electron';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { currentVault } from './vault.cjs';

export interface McpStatus {
  running: boolean;
  port: number;
  error?: string | null;
  vaultPath?: string | null;
}

let mcpChild: ChildProcess | null = null;
let currentPort = 3030;
let lastError: string | null = null;

function resolveMcpScript(): string {
  const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : process.cwd();
  const direct = path.join(appPath, 'dist-mcp', 'index.js');
  if (existsSync(direct)) return direct;
  const fromCwd = path.join(process.cwd(), 'dist-mcp', 'index.js');
  if (existsSync(fromCwd)) return fromCwd;
  return direct;
}

export function getMcpStatus(): McpStatus {
  return {
    running: mcpChild !== null && !mcpChild.killed,
    port: currentPort,
    error: lastError,
    vaultPath: currentVault(),
  };
}

export async function stopMcpServer(): Promise<McpStatus> {
  if (mcpChild) {
    try {
      mcpChild.kill('SIGTERM');
    } catch {
      // Ignored
    }
    mcpChild = null;
  }
  lastError = null;
  return getMcpStatus();
}

export async function startMcpServer(port = 3030): Promise<McpStatus> {
  if (mcpChild && !mcpChild.killed && currentPort === port) {
    return getMcpStatus();
  }

  await stopMcpServer();

  currentPort = port;
  lastError = null;

  const scriptPath = resolveMcpScript();
  if (!existsSync(scriptPath)) {
    lastError = `MCP script not found at ${scriptPath}. Please run npm run build:mcp.`;
    return getMcpStatus();
  }

  const vault = currentVault() || process.cwd();

  const child = spawn(
    process.execPath,
    [scriptPath, '--port', String(port), '--vault', vault],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  mcpChild = child;

  child.on('error', (err) => {
    lastError = err.message;
    mcpChild = null;
  });

  child.on('exit', (code) => {
    if (mcpChild === child) {
      mcpChild = null;
      if (code !== 0 && !lastError) {
        lastError = `Server exited with code ${code}`;
      }
    }
  });

  child.stderr?.on('data', (data) => {
    const text = data.toString('utf8');
    if (text.includes('EADDRINUSE') || text.includes('Error:') || text.includes('Fatal error:')) {
      lastError = text.trim();
    }
  });

  // Allow server startup time
  await new Promise((resolve) => setTimeout(resolve, 600));

  return getMcpStatus();
}

if (typeof app?.on === 'function') {
  app.on('will-quit', () => {
    if (mcpChild) {
      try {
        mcpChild.kill();
      } catch {
        // Ignored
      }
      mcpChild = null;
    }
  });
}
