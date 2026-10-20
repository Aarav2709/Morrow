import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpVaultManager } from './vault';
import { displayTitle } from '../core/model';
import { livePages } from '../core/tree';

export function registerMcpPrompts(server: McpServer, vault: McpVaultManager): void {
  // 1. daily-standup
  server.registerPrompt(
    'daily-standup',
    {
      title: 'Daily Standup Summary',
      description:
        "Synthesizes today's daily note and recent activities into a concise engineering standup report (Done, Doing, Blockers).",
    },
    async () => {
      let todayNoteContent = '(No daily note created yet today)';
      try {
        const today = await vault.todaysNote();
        todayNoteContent = today.markdown;
      } catch {
        // Ignored
      }

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please review my today's note from my Morrow vault and produce a concise 3-part engineering standup summary:
1. **Done**: Accomplished tasks or finished items.
2. **Doing**: Current priorities or in-progress work.
3. **Blockers**: Any open questions, blockers, or items needing attention.

Here is my today's daily note:
\`\`\`markdown
${todayNoteContent}
\`\`\``,
            },
          },
        ],
      };
    },
  );

  // 2. synthesize-topic
  server.registerPrompt(
    'synthesize-topic',
    {
      title: 'Synthesize Topic Across Vault',
      description:
        'Gathers notes matching a keyword or tag and generates a comprehensive, well-structured synthesis with cross-references.',
      argsSchema: {
        topic: z.string().describe('The topic, tag, or concept to research and synthesize.'),
      },
    },
    async ({ topic }) => {
      const results = vault.searchPages(topic, 10);
      const notesContext = results
        .map((r) => {
          try {
            const read = vault.readPage(r.page.id);
            return `### [[${displayTitle(r.page)}]] (ID: ${r.page.id})\n${read.markdown}\n`;
          } catch {
            return `### [[${displayTitle(r.page)}]]\n(Unable to read page content)\n`;
          }
        })
        .join('\n---\n');

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You are an expert research synthesizer. I want a comprehensive conceptual synthesis on the topic: "${topic}".

Below are the most relevant pages found in my Morrow vault:
${notesContext || '(No matching pages found in vault)'}

Please provide:
1. An Executive Summary of the topic based on my personal notes.
2. Key Insights and thematic grouping of concepts.
3. Identified Gaps, contradictions, or questions that need further exploration.
4. Suggested [[wiki links]] and action items to extend my personal knowledge base.`,
            },
          },
        ],
      };
    },
  );

  // 3. link-assistant
  server.registerPrompt(
    'link-assistant',
    {
      title: 'Link Assistant & Vault Graph Integrator',
      description:
        'Analyzes an existing note and recommends [[wiki links]] to other relevant pages currently in the vault.',
      argsSchema: {
        page: z.string().describe('ID or title of the page to analyze.'),
      },
    },
    async ({ page }) => {
      const read = vault.readPage(page);
      const allPages = livePages(vault.getState().pages)
        .filter((p) => p.id !== read.page.id)
        .map((p) => `- [[${displayTitle(p)}]]`)
        .slice(0, 200);

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Analyze the following note from my Morrow vault:
Title: "${displayTitle(read.page)}"
Content:
\`\`\`markdown
${read.markdown}
\`\`\`

Here is a list of other pages existing in my vault:
${allPages.join('\n')}

Please suggest relevant [[wiki links]] that should be added to this note to connect it more deeply with the rest of my vault graph. Explain why each connection makes conceptual sense.`,
            },
          },
        ],
      };
    },
  );

  // 4. format-note
  server.registerPrompt(
    'format-note',
    {
      title: 'Format Raw Notes into Morrow Markdown',
      description:
        'Transforms messy thoughts, meeting transcripts, or brainstorms into beautifully formatted Morrow Markdown with headers, tasks [ ], callouts [!note], and tags.',
      argsSchema: {
        rawText: z.string().describe('Unstructured notes, meeting notes, or rough transcript.'),
      },
    },
    async ({ rawText }) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Format the following raw text into clean, professional Morrow Markdown:

Guidelines:
- Use clear headings (#, ##, ###).
- Convert actionable items into checkbox tasks: \`- [ ] Task description\`.
- Use Morrow callouts for key insights or warnings: \`> [!note] Observation\` or \`> [!important] Takeaway\`.
- Keep existing frontmatter if present or add reasonable tags like \`#meeting\` or \`#notes\`.

Raw input:
\`\`\`
${rawText}
\`\`\``,
            },
          },
        ],
      };
    },
  );
}
