import { describe, expect, it } from 'vitest';
import { emptyWorkspace } from '../../core/model';
import type { DocNode, PageMeta, WorkspaceState } from '../../core/model';
import {
  buildAcpPromptParts,
  expandWikilinkPaths,
  extractInlineMentionIds,
  searchMentionCandidates,
} from './acpContext';
import { formatExportFilename } from './acpExport';
import { applySessionUpdate } from './acpStore';
import type { AcpSession } from './acpStore';
import { parseAgentBlockConfig } from './EmbeddedAgentBlock';
import { getPreferences } from '../platform/preferences';

function makePage(id: string, title: string, content: DocNode[], aliases?: string[]): [PageMeta, DocNode] {
  const now = 1_700_000_000_000;
  return [
    {
      id,
      parentId: null,
      title,
      icon: null,
      cover: null,
      kind: 'page',
      dailyDate: null,
      order: 0,
      createdAt: now,
      updatedAt: now,
      trashedAt: null,
      archivedAt: null,
      hideTasks: false,
      favorite: false,
      lastOpenedAt: null,
      tags: [],
      properties: {},
      extra: aliases ? { aliases } : {},
      database: null,
      encrypted: false,
    },
    { type: 'doc', content },
  ];
}

function makeWorkspace(): WorkspaceState {
  const [p1, d1] = makePage(
    'p1',
    'Project Alpha',
    [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'pageLink', attrs: { id: 'p2', label: 'Design Specs' } },
          { type: 'text', text: ' for details.' },
        ],
      },
    ],
    ['Alpha'],
  );
  const [p2, d2] = makePage('p2', 'Design Specs', [
    { type: 'paragraph', content: [{ type: 'text', text: 'Detailed design notes here.' }] },
  ]);
  return {
    ...emptyWorkspace(),
    pages: { [p1.id]: p1, [p2.id]: p2 },
    docs: { [p1.id]: d1, [p2.id]: d2 },
  };
}

describe('ACP context & mentions', () => {
  it('fuzzy searches pages by title, alias, and selection', () => {
    const ws = makeWorkspace();
    const sel = { pageId: 'p1', from: 0, to: 5, text: 'hello world', markdown: 'hello world' };
    const byAlias = searchMentionCandidates(ws, 'alpha', sel);
    expect(byAlias[0]?.id).toBe('p1');

    const bySel = searchMentionCandidates(ws, 'sel', sel);
    expect(bySel[0]?.kind).toBe('selection');
  });

  it('extracts inline @[[Title]] and @alias mentions', () => {
    const ws = makeWorkspace();
    expect(extractInlineMentionIds('Check @[[Design Specs]] and @Alpha', ws)).toEqual(['p2', 'p1']);
  });

  it('expands wikilink context paths and truncates long notes', () => {
    const ws = makeWorkspace();
    const layout = new Map([
      ['p1', { file: 'Project Alpha.md', folder: 'Project Alpha' }],
      ['p2', { file: 'Design Specs.md', folder: 'Design Specs' }],
    ]);
    expect(expandWikilinkPaths(ws, ['p1'], layout)).toEqual([
      { title: 'Design Specs', filePath: 'Design Specs.md' },
    ]);

    const prefs = {
      ...getPreferences(),
      acpMaxNoteLength: 10,
      acpInjectMarkdownRules: false,
      acpInjectTableSpacing: true,
      acpInjectLatexRules: false,
    };
    const { prompt, mentionedTitles } = buildAcpPromptParts({
      text: 'Summarize @[[Project Alpha]]',
      state: ws,
      explicitPageIds: [],
      activePageId: null,
      selection: null,
      attachments: [],
      prefs,
      isFirstTurn: true,
    });
    expect(mentionedTitles).toEqual(['Project Alpha']);
    expect(prompt[0]?.type).toBe('text');
    if (prompt[0]?.type === 'text') {
      expect(prompt[0].text).toContain('truncated at 10 characters');
      expect(prompt[0].text).toContain('[[Design Specs]] (Design Specs.md)');
      expect(prompt[0].text).toContain('Markdown table spacing');
    }
  });
});

describe('ACP session streaming reducer', () => {
  const baseSession: AcpSession = {
    id: 's1',
    agentId: 'claude-code-acp',
    agentName: 'Claude Code',
    agentSessionId: 'ag-1',
    connected: true,
    cwd: '/vault',
    title: 'Test',
    origin: 'panel',
    status: 'running',
    modes: [],
    currentModeId: null,
    models: [],
    currentModelId: null,
    availableCommands: [],
    items: [],
    debugLog: [],
    hasSentPrompt: false,
    createdAt: 1,
    updatedAt: 1,
  };

  it('merges message chunks, thoughts, plans, diffs, and commands', () => {
    let s = applySessionUpdate(baseSession, {
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'Thinking...' },
    });
    s = applySessionUpdate(s, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello ' },
    });
    s = applySessionUpdate(s, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'world!' },
    });
    s = applySessionUpdate(s, {
      sessionUpdate: 'plan',
      entries: [{ content: 'Read files', status: 'completed' }],
    });
    s = applySessionUpdate(s, {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Edit note',
      status: 'in_progress',
    });
    s = applySessionUpdate(s, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'completed',
      content: [{ type: 'diff', path: 'Note.md', oldText: 'a', newText: 'b' }],
    });
    s = applySessionUpdate(s, {
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'review', description: 'Review note' }],
    });

    expect(s.items).toHaveLength(4);
    expect(s.items[0]).toMatchObject({ kind: 'thought', text: 'Thinking...' });
    expect(s.items[1]).toMatchObject({ kind: 'assistant', text: 'Hello world!' });
    expect(s.items[2]).toMatchObject({
      kind: 'plan',
      entries: [{ content: 'Read files', status: 'completed' }],
    });
    expect(s.items[3]).toMatchObject({
      kind: 'tool',
      status: 'completed',
      diff: { path: 'Note.md', oldText: 'a', newText: 'b' },
    });
    expect(s.availableCommands).toEqual([{ name: 'review', description: 'Review note' }]);
  });
});

describe('ACP export & embedded config helpers', () => {
  it('formats export filenames with {date} and {time}', () => {
    const dt = new Date(2026, 10, 20, 9, 5, 3);
    expect(formatExportFilename('agent_client_{date}_{time}', dt)).toBe('agent_client_2026-11-20_09-05-03');
  });

  it('parses agent-client and agent-button codeblock configs', () => {
    const parsed = parseAgentBlockConfig('agent: claude-code-acp\nsession: my-chat\npersist: true');
    expect(parsed).toEqual({
      agent: 'claude-code-acp',
      session: 'my-chat',
      persist: 'true',
    });
  });
});

describe('agent blocks in a note', () => {
  it('only run in a folder inside the vault', async () => {
    const { vaultFolder } = await import('./EmbeddedAgentBlock');
    const vault = 'C:\\Users\\me\\Notes';
    expect(vaultFolder(undefined, vault)).toBe(vault);
    expect(vaultFolder('Projects/site', vault)).toBe('C:/Users/me/Notes/Projects/site');
    expect(vaultFolder('C:\\Users\\me\\Notes\\Inbox', vault)).toBe('C:/Users/me/Notes/Inbox');
    expect(vaultFolder('C:\\Windows\\System32', vault)).toBe(vault);
    expect(vaultFolder('../../secrets', vault)).toBe(vault);
    expect(vaultFolder('/home/me', null)).toBeUndefined();
  });
});
