// the desktop shell's main process and preload, each bundled into one file with what they use from npm,
// so the packaged app carries no node_modules folder
import { defineConfig } from 'vite';
import { thirdPartyLicenses } from './scripts/licenses';

export default defineConfig({
  publicDir: false,
  plugins: [thirdPartyLicenses()],
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    outDir: 'dist-electron',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: false,
    minify: false,
    rollupOptions: {
      input: { main: 'electron/main.cts', preload: 'electron/preload.cts' },
      external: ['electron'],
      // parts of the assistant's sdk that load only when used stay in files of their own
      output: { format: 'cjs', entryFileNames: '[name].cjs', chunkFileNames: 'chunks/[name]-[hash].cjs' },
    },
  },
});
