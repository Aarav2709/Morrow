/// <reference types="vitest/config" />
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
      // the emoji images are copied as files rather than imported, so their package is named here
      packages.set(
        '@lobehub/fluent-emoji-3d',
        path.dirname(require.resolve('@lobehub/fluent-emoji-3d/package.json')),
      );
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

// microsoft's fluent 3d emoji, copied into the build as images so page icons look the same on every system
function emojiImages(): Plugin {
  const dir = path.join(path.dirname(require.resolve('@lobehub/fluent-emoji-3d/package.json')), 'assets');
  const names = readdirSync(dir).filter((name) => name.endsWith('.webp'));
  const virtual = 'virtual:morrow-emoji';
  return {
    name: 'morrow-emoji-images',
    resolveId: (id) => (id === virtual ? `\0${virtual}` : null),
    load: (id) =>
      id === `\0${virtual}`
        ? `export const EMOJI_FILES = new Set(${JSON.stringify(names.map((name) => name.slice(0, -5)))});`
        : null,
    configureServer(server) {
      server.middlewares.use('/emoji/', (request, response, next) => {
        const name = decodeURIComponent((request.url ?? '').replace(/^\//, '').split('?')[0]!);
        if (!/^[0-9a-f-]+\.webp$/.test(name) || !names.includes(name)) return next();
        response.setHeader('Content-Type', 'image/webp');
        response.end(readFileSync(path.join(dir, name)));
      });
    },
    generateBundle() {
      for (const name of names)
        this.emitFile({
          type: 'asset',
          fileName: `emoji/${name}`,
          source: readFileSync(path.join(dir, name)),
        });
    },
  };
}

export default defineConfig({
  plugins: [react(), desktopShell(), thirdPartyLicenses(), emojiImages()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // relative base so the build loads from the desktop shell or any static path
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    // the desktop app loads one local bundle from disk, so a large chunk costs nothing
    chunkSizeWarningLimit: 1800,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
});
