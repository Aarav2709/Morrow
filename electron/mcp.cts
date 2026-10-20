import { app } from 'electron';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
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
  return path.join(app.getAppPath(), 'dist-mcp', 'index.js');
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
    if (text.includes('EADDRINUSE') || text.includes('Error:')) {
      lastError = text.trim();
    }
  });

  // Allow server startup time
  await new Promise((resolve) => setTimeout(resolve, 600));

  return getMcpStatus();
}

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
