/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { thirdPartyLicenses } from './scripts/licenses.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

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
  plugins: [
    react(),
    // the emoji images are copied as files rather than imported, so their package is named here
    thirdPartyLicenses(['@lobehub/fluent-emoji-3d']),
    emojiImages(),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // relative base so the build loads from the desktop app or any static path
  base: './',
  // tauri opens the window on this address while developing, and android reaches it over the network
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: process.env.TAURI_DEV_HOST || false,
    hmr: process.env.TAURI_DEV_HOST ? { protocol: 'ws', host: process.env.TAURI_DEV_HOST, port: 5174 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
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
