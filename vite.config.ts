import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// `vite --mode desktop` compiles the electron shell and opens it against the dev server
function desktopShell(): Plugin {
  return {
    name: 'morrow-desktop-shell',
    apply: 'serve',
    configureServer(server) {
      if (server.config.mode !== 'desktop') return;
      server.httpServer?.once('listening', () => {
        const tsc = spawnSync(
          process.execPath,
          [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.electron.json'],
          {
            stdio: 'inherit',
          },
        );
        if (tsc.status !== 0) process.exit(tsc.status ?? 1);
        const address = server.httpServer?.address();
        const port = typeof address === 'object' && address ? address.port : 5173;
        const electron = require('electron') as string;
        const shell = spawn(electron, ['.'], {
          stdio: 'inherit',
          env: { ...process.env, MORROW_DEV_URL: `http://localhost:${port}/` },
        });
        shell.on('exit', () => void server.close().then(() => process.exit(0)));
      });
    },
  };
}

// writes the licence of every bundled package into the build, as their licences require
function thirdPartyLicenses(): Plugin {
  return {
    name: 'morrow-third-party-licenses',
    apply: 'build',
    generateBundle() {
      const packages = new Map<string, string>();
      for (const id of this.getModuleIds()) {
        const match = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id);
        if (match)
          packages.set(
            match[1]!.replace(/\\/g, '/'),
            path.join(id.slice(0, match.index), 'node_modules', match[1]!),
          );
      }
      const sections = [...packages.entries()].sort().map(([name, dir]) => {
        const info = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
          version: string;
          license?: string;
        };
        const file = existsSync(dir)
          ? readdirSync(dir).find((entry) => /^(licen[cs]e|copying)/i.test(entry))
          : undefined;
        const text = file
          ? readFileSync(path.join(dir, file), 'utf8').trim()
          : `Licence: ${info.license ?? 'unknown'}`;
        return `${name} ${info.version}\n\n${text}`;
      });
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES.txt',
        source: `Morrow bundles the following open source software.\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), desktopShell(), thirdPartyLicenses()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // relative base so the build loads from the desktop shell or any static path
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    // the desktop app loads one local bundle from disk, so a large chunk costs nothing
    chunkSizeWarningLimit: 1500,
  },
});
