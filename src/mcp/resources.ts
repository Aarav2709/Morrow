import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import type { McpVaultManager } from './vault';
import { displayTitle } from '../core/model';
import { livePages } from '../core/tree';

export function registerMcpResources(server: McpServer, vault: McpVaultManager): void {
  // 1. Vault Overview
  server.registerResource(
    'Morrow Vault Overview',
    'morrow://vault',
    {
      description: 'Summary metadata of the currently opened Morrow vault',
      mimeType: 'application/json',
    },
    async (uri: URL) => {
      const state = vault.getState();
      const pages = livePages(state.pages);
      const tags = vault.listTags();
      const summary = {
        vaultPath: vault.vaultPath,
        totalPages: pages.length,
        totalTags: tags.length,
        kinds: {
          pages: pages.filter((p) => p.kind === 'page').length,
          journal: pages.filter((p) => p.kind === 'journal').length,
          databases: pages.filter((p) => p.kind === 'database').length,
          canvases: pages.filter((p) => p.kind === 'canvas').length,
        },
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  // 2. Note by ID Resource Template
  server.registerResource(
    'Morrow Page Content',
    new ResourceTemplate('morrow://pages/{id}', {
      list: async () => {
        const pages = livePages(vault.getState().pages);
        return {
          resources: pages.map((p) => ({
            uri: `morrow://pages/${p.id}`,
            name: displayTitle(p),
            description: `Morrow page: ${displayTitle(p)} (${p.kind})`,
            mimeType: 'text/markdown',
          })),
        };
      },
      complete: {
        id: async (value: string) => {
          const lower = value.toLowerCase();
          return livePages(vault.getState().pages)
            .filter(
              (p) =>
                p.id.toLowerCase().startsWith(lower) ||
                displayTitle(p).toLowerCase().startsWith(lower),
            )
            .map((p) => p.id);
        },
      },
    }),
    {
      description: 'Markdown content of a specific page in the Morrow vault',
      mimeType: 'text/markdown',
    },
    async (uri: URL, variables: Variables) => {
      const idRaw = variables.id;
      const pageId = Array.isArray(idRaw) ? idRaw[0] : idRaw;
      if (!pageId) {
        throw new Error('Page ID is required in URI.');
      }
      const read = vault.readPage(pageId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: read.markdown,
          },
        ],
      };
    },
  );

  // 3. Today's note
  server.registerResource(
    "Today's Daily Note",
    'morrow://daily/today',
    {
      description: "Direct access to today's journal note",
      mimeType: 'text/markdown',
    },
    async (uri: URL) => {
      const note = await vault.todaysNote();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: note.markdown,
          },
        ],
      };
    },
  );

  // 4. Tags summary
  server.registerResource(
    'Morrow Tags Summary',
    'morrow://tags',
    {
      description: 'List of all tags in the vault and their associated pages',
      mimeType: 'application/json',
    },
    async (uri: URL) => {
      const tags = vault.listTags();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(tags, null, 2),
          },
        ],
      };
    },
  );
}
