import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpVaultManager } from './vault';
import { displayTitle } from '../core/model';
import { childrenOf } from '../core/tree';

export function registerMcpTools(server: McpServer, vault: McpVaultManager): void {
  // 1. list_pages
  server.registerTool(
    'list_pages',
    {
      title: 'List Pages',
      description:
        'List the pages inside a page, or the top level of the vault when no parent is given, with IDs, titles, kinds, and subpage counts.',
      inputSchema: {
        parent: z
          .string()
          .optional()
          .describe('ID or title of the parent page. Leave empty for the root level.'),
      },
    },
    async ({ parent }) => {
      try {
        const pages = vault.listPages(parent);
        const state = vault.getState();
        const results = pages.map((p) => ({
          id: p.id,
          title: displayTitle(p),
          kind: p.kind,
          favorite: p.favorite,
          tags: p.tags,
          subpagesCount: childrenOf(state.pages, p.id).length,
          dailyDate: p.dailyDate ?? undefined,
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error listing pages: ${toMessage(error)}` }],
        };
      }
    },
  );

  // 2. read_page
  server.registerTool(
    'read_page',
    {
      title: 'Read Page',
      description:
        'Read a page: its title, vault file path, tags, properties, and full content as Markdown.',
      inputSchema: {
        page: z.string().describe('ID or title of the page to read.'),
      },
    },
    async ({ page }) => {
      try {
        const { page: meta, markdown, path: filePath } = vault.readPage(page);
        const result = {
          id: meta.id,
          title: displayTitle(meta),
          kind: meta.kind,
          path: filePath,
          tags: meta.tags,
          properties: meta.properties,
          extra: meta.extra,
          dailyDate: meta.dailyDate,
          content: markdown,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error reading page: ${toMessage(error)}` }],
        };
      }
    },
  );

  // 3. search_pages
  server.registerTool(
    'search_pages',
    {
      title: 'Search Pages',
      description:
        'Search the text and titles of every page. Supports "exact phrases", -word to exclude, and #tag to filter by tag. Returns matching pages with snippet previews.',
      inputSchema: {
        query: z.string().describe('Search query text or terms.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Maximum number of results to return (default: 20).'),
      },
    },
    async ({ query, limit }) => {
      try {
        const results = vault.searchPages(query, limit ?? 20);
        const mapped = results.map((r) => ({
          id: r.page.id,
          title: displayTitle(r.page),
          score: r.score,
          titleMatch: r.titleMatch,
          path: r.path,
          snippets: r.snippets.map((s) => `${s.before}[${s.match}]${s.after}`),
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error searching pages: ${toMessage(error)}` }],
        };
      }
    },
  );

  // 4. create_page
  server.registerTool(
    'create_page',
    {
      title: 'Create Page',
      description:
        'Create a new page in the vault with a title, optional Markdown content, optional parent page, and optional tags.',
      inputSchema: {
        title: z.string().describe('Title of the new page.'),
        content: z.string().optional().describe('Initial Markdown content of the page.'),
        parent: z
          .string()
          .optional()
          .describe('ID or title of the parent page. If omitted, created at vault root.'),
        tags: z.array(z.string()).optional().describe('List of tags to assign to the page.'),
      },
    },
    async ({ title, content, parent, tags }) => {
      try {
        const created = await vault.createPage({ title, content, parent, tags });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `Page "${displayTitle(created.page)}" created successfully.`,
                  id: created.page.id,
                  title: displayTitle(created.page),
                  path: created.path,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error creating page: ${toMessage(error)}` }],
        };
      }
    },
  );

  // 5. edit_page
  server.registerTool(
    'edit_page',
    {
      title: 'Edit Page',
      description: 'Replace the full Markdown content of an existing page in the vault.',
      inputSchema: {
        page: z.string().describe('ID or title of the page to edit.'),
        content: z.string().describe('New Markdown content to set.'),
      },
    },
    async ({ page, content }) => {
      try {
        const edited = await vault.editPage({ page, content });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `Page "${displayTitle(edited.page)}" updated successfully.`,
                  id: edited.page.id,
                  title: displayTitle(edited.page),
                  path: edited.path,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error editing page: ${toMessage(error)}` }],
        };
      }
    },
  );

  // 6. append_to_page
  server.registerTool(
    'append_to_page',
    {
      title: 'Append to Page',
      description: 'Append Markdown content to the end of an existing page in the vault.',
      inputSchema: {
        page: z.string().describe('ID or title of the page to append to.'),
        content: z.string().describe('Markdown content to append.'),
      },
    },
    async ({ page, content }) => {
      try {
        const updated = await vault.appendToPage({ page, content });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `Content appended to "${displayTitle(updated.page)}" successfully.`,
                  id: updated.page.id,
                  title: displayTitle(updated.page),
                  path: updated.path,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error appending to page: ${toMessage(error)}` }],
        };
      }
    },
  );

  // 7. trash_page
  server.registerTool(
    'trash_page',
    {
      title: 'Trash Page',
      description: 'Move a page (and its subpages) to the vault trash (.trash folder).',
      inputSchema: {
        page: z.string().describe('ID or title of the page to move to trash.'),
      },
    },
    async ({ page }) => {
      try {
        const trashed = await vault.trashPage(page);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `Page "${displayTitle(trashed)}" moved to trash.`,
                  id: trashed.id,
                  title: displayTitle(trashed),
                  trashedAt: trashed.trashedAt,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error trashing page: ${toMessage(error)}` }],
        };
      }
    },
  );

  // 8. todays_note
  server.registerTool(
    'todays_note',
    {
      title: "Today's Note",
      description:
        "Get or create today's daily journal note. Creates Journal folder and daily note if they do not exist yet.",
      inputSchema: {},
    },
    async () => {
      try {
        const note = await vault.todaysNote();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: note.page.id,
                  title: displayTitle(note.page),
                  dailyDate: note.page.dailyDate,
                  path: note.path,
                  content: note.markdown,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error accessing today's note: ${toMessage(error)}` }],
        };
      }
    },
  );

  // 9. list_tags
  server.registerTool(
    'list_tags',
    {
      title: 'List Tags',
      description:
        'List all tags used across the vault with the count and IDs of pages tagged with each.',
      inputSchema: {},
    },
    async () => {
      try {
        const tags = vault.listTags();
        const mapped = tags.map((t) => ({
          tag: t.tag,
          count: t.pages.length,
          pages: t.pages,
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error listing tags: ${toMessage(error)}` }],
        };
      }
    },
  );

  // 10. get_graph
  server.registerTool(
    'get_graph',
    {
      title: 'Get Graph Topology',
      description:
        'Retrieve the note graph topology showing nodes (pages/tags) and links between notes.',
      inputSchema: {
        tags: z.boolean().optional().describe('Include tag nodes in the graph (default: false).'),
        hierarchy: z
          .boolean()
          .optional()
          .describe('Include parent-child folder hierarchy links (default: false).'),
        orphans: z
          .boolean()
          .optional()
          .describe('Include orphan pages with no links (default: true).'),
        depth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe('Graph traversal depth (default: 1).'),
      },
    },
    async ({ tags, hierarchy, orphans, depth }) => {
      try {
        const graph = vault.getGraph({
          tags: tags ?? false,
          hierarchy: hierarchy ?? false,
          orphans: orphans ?? true,
          depth: depth ?? 1,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error building graph: ${toMessage(error)}` }],
        };
      }
    },
  );
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
