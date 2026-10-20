// shared by the vite builds: the licences of the npm packages a build carries, written beside it
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);

// writes the licence of every bundled package into the build, as their licences require
export function thirdPartyLicenses(extra: string[] = []): Plugin {
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
      for (const name of extra) packages.set(name, path.dirname(require.resolve(`${name}/package.json`)));
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
