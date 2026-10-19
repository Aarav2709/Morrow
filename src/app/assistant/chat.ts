// the conversation with the assistant: one at a time, kept while morrow is open, never written to disk
import { useSyncExternalStore } from 'react';
import { displayTitle } from '../../core/model';
import { commitEditors } from '../editor/commits';
import { desktop } from '../platform/desktop';
import { getPreferences } from '../platform/preferences';
import { activeRoute } from '../router';
import { getState } from '../workspace';
import { assistantRules } from './rules';
import { runTool, TOOL_SPECS } from './tools';
import type { AppliedChange, Proposal, ToolCall } from './tools';

// how many rounds of tools one message may take before the assistant has to stop and answer
const MAX_STEPS = 16;

export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'note'; id: string; text: string; tone: 'info' | 'error' }
  | {
      kind: 'tool';
      id: string;
      name: string;
      label: string;
      status: 'running' | 'done' | 'failed' | 'waiting' | 'declined' | 'undone';
      proposal?: Proposal;
      applied?: AppliedChange;
    };

interface ChatState {
  items: ChatItem[];
  busy: boolean;
}

type ToolResult = { id: string; content: string; isError: boolean };
type TurnInput = { kind: 'user'; text: string } | { kind: 'tools'; results: ToolResult[]; text?: string };

let state: ChatState = { items: [], busy: false };
// the conversation as the provider keeps it, sent back unchanged each turn
let history: unknown[] = [];
// results owed for tool calls when a turn was stopped, sent before the next message
let owed: ToolResult[] = [];
let provider: string | null = null;
let currentTurn: string | null = null;
let stopped = false;
const approvals = new Map<string, (approved: boolean) => void>();
const listeners = new Set<() => void>();
let counter = 0;
const nextId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

function set(next: Partial<ChatState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

const push = (item: ChatItem) => set({ items: [...state.items, item] });
const update = (id: string, patch: Partial<ChatItem>) =>
  set({ items: state.items.map((item) => (item.id === id ? ({ ...item, ...patch } as ChatItem) : item)) });

export function useChat(): ChatState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function newChat(): void {
  stopTurn();
  history = [];
  owed = [];
  provider = null;
  set({ items: [], busy: false });
}

export function stopTurn(): void {
  if (!state.busy) return;
  stopped = true;
  if (currentTurn) void desktop?.assistant?.cancel(currentTurn);
  for (const resolve of approvals.values()) resolve(false);
  approvals.clear();
}

export function answerProposal(itemId: string, approved: boolean): void {
  approvals.get(itemId)?.(approved);
  approvals.delete(itemId);
}

export function undoChange(itemId: string): void {
  const item = state.items.find((entry) => entry.id === itemId);
  if (item?.kind !== 'tool' || !item.applied) return;
  commitEditors();
  item.applied.undo();
  update(itemId, { status: 'undone' });
}

const LABELS: Record<string, string> = {
  search_pages: 'Searched pages',
  list_pages: 'Looked through pages',
  read_page: 'Read',
  current_page: 'Checked the open page',
  todays_note: "Found today's note",
  open_page: 'Opened',
};

function labelOf(call: ToolCall): string {
  const label = LABELS[call.name] ?? call.name;
  const subject = call.input.query ?? call.input.page ?? call.input.parent;
  return typeof subject === 'string' && subject ? `${label} “${titleFor(subject)}”` : label;
}

const titleFor = (reference: string) => {
  const found = getState().pages[reference];
  return found ? displayTitle(found) : reference;
};

// a line telling the assistant which page you are looking at, so "this page" means something
function withContext(text: string): string {
  const route = activeRoute();
  const open = route.name === 'page' ? getState().pages[route.id] : undefined;
  return open && !open.encrypted
    ? `${text}\n\n(The page open in Morrow right now is "${displayTitle(open)}", id ${open.id}.)`
    : text;
}

async function handleCall(call: ToolCall): Promise<ToolResult> {
  const itemId = nextId();
  const outcome = runTool(call);
  if (outcome.kind === 'result') {
    push({
      kind: 'tool',
      id: itemId,
      name: call.name,
      label: labelOf(call),
      status: outcome.isError ? 'failed' : 'done',
    });
    return { id: call.id, content: outcome.content, isError: outcome.isError ?? false };
  }
  const { proposal } = outcome;
  const ask = getPreferences().assistantAsk;
  push({
    kind: 'tool',
    id: itemId,
    name: call.name,
    label: proposal.title,
    status: ask ? 'waiting' : 'running',
    proposal,
  });
  const approved = ask ? await new Promise<boolean>((resolve) => approvals.set(itemId, resolve)) : true;
  if (!approved) {
    update(itemId, { status: 'declined' });
    return {
      id: call.id,
      content: stopped ? 'Stopped by the user.' : 'The user declined this change.',
      isError: true,
    };
  }
  try {
    commitEditors();
    const applied = await proposal.apply();
    update(itemId, { status: 'done', applied });
    return { id: call.id, content: applied.message, isError: false };
  } catch (error) {
    update(itemId, { status: 'failed' });
    return { id: call.id, content: error instanceof Error ? error.message : String(error), isError: true };
  }
}

export async function sendMessage(text: string): Promise<void> {
  const assistant = desktop?.assistant;
  const message = text.trim();
  if (!assistant || !message || state.busy) return;
  const settings = await assistant.settings();
  // each provider keeps a conversation its own way, so a new one starts after switching
  if (provider && provider !== settings.provider) {
    history = [];
    owed = [];
    push({
      kind: 'note',
      id: nextId(),
      text: `Switched to ${settings.provider}, starting a fresh conversation.`,
      tone: 'info',
    });
  }
  provider = settings.provider;
  stopped = false;
  commitEditors();
  push({ kind: 'user', id: nextId(), text: message });
  set({ busy: true });
  const system = assistantRules(new Date());
  let add: TurnInput = owed.length
    ? { kind: 'tools', results: owed, text: withContext(message) }
    : { kind: 'user', text: withContext(message) };
  owed = [];
  try {
    for (let step = 0; ; step++) {
      currentTurn = nextId();
      const result = await assistant.turn({ id: currentTurn, history, add, system, tools: TOOL_SPECS });
      currentTurn = null;
      if (!result.ok) {
        push({ kind: 'note', id: nextId(), text: result.error, tone: stopped ? 'info' : 'error' });
        return;
      }
      history = result.history;
      if (result.text.trim()) push({ kind: 'assistant', id: nextId(), text: result.text.trim() });
      if (result.stop === 'refusal') {
        push({ kind: 'note', id: nextId(), text: 'The model declined to help with this.', tone: 'info' });
        return;
      }
      if (result.toolCalls.length === 0) {
        if (result.stop === 'length')
          push({
            kind: 'note',
            id: nextId(),
            text: 'The reply was cut short because it got too long.',
            tone: 'info',
          });
        return;
      }
      const results: ToolResult[] = [];
      for (const call of result.toolCalls) {
        results.push(
          stopped ? { id: call.id, content: 'Stopped by the user.', isError: true } : await handleCall(call),
        );
      }
      if (stopped || step + 1 >= MAX_STEPS) {
        // every tool call needs its result, they go out with the next message
        owed = results;
        push({
          kind: 'note',
          id: nextId(),
          text: stopped ? 'Stopped.' : 'Stopped after many steps. Send a message to carry on.',
          tone: 'info',
        });
        return;
      }
      add = { kind: 'tools', results };
    }
  } finally {
    currentTurn = null;
    set({ busy: false });
  }
}
