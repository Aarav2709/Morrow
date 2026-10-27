// the conversation with the assistant: one at a time, kept in this computer's app data between restarts,
// one for each vault, never in the vault itself
import { useSyncExternalStore } from 'react';
import { displayTitle } from '../../core/model';
import { commitEditors } from '../editor/commits';
import { desktop } from '../platform/desktop';
import { getPreferences } from '../platform/preferences';
import { activeRoute } from '../router';
import { getSession, getState } from '../workspace';
import { assistantRules } from './rules';
import { runTool, TOOL_SPECS } from './tools';
import type { AppliedChange, Proposal, ToolCall } from './tools';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';

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

const SAVE_KEY = 'morrow.assistantChat';
// past this the provider's side of the conversation is let go, the messages still show
const MAX_SAVED = 2_000_000;
// what a tool call that never finished answers, when morrow closed while it ran or waited
const CLOSED_RESULT = 'Morrow was closed before this finished, so it did not happen.';

interface Saved {
  items: ChatItem[];
  history: unknown[];
  owed: ToolResult[];
  provider: string | null;
}

// one saved conversation for each vault, pages and their ids belong to it
function saveKey(): string | null {
  try {
    const location = getSession().location;
    return location ? `${SAVE_KEY}:${location}` : SAVE_KEY;
  } catch {
    return null;
  }
}

function restore(): Saved {
  const empty: Saved = { items: [], history: [], owed: [], provider: null };
  const key = saveKey();
  if (!key) return empty;
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Saved> | null;
    if (!raw || !Array.isArray(raw.items)) return empty;
    const items = raw.items
      .filter((item): item is ChatItem => typeof item?.id === 'string' && typeof item.kind === 'string')
      .map((item): ChatItem => {
        if (item.kind !== 'tool') return item;
        // a change can only be applied or undone in the session that proposed it
        const { applied: _applied, ...rest } = item;
        const status = rest.status === 'waiting' || rest.status === 'running' ? 'declined' : rest.status;
        const proposal = rest.proposal
          ? {
              ...rest.proposal,
              apply: () => Promise.reject(new Error(CLOSED_RESULT)),
            }
          : undefined;
        return { ...rest, status, ...(proposal ? { proposal } : {}) };
      });
    return {
      items,
      history: Array.isArray(raw.history) ? raw.history : [],
      owed: Array.isArray(raw.owed) ? raw.owed : [],
      provider: typeof raw.provider === 'string' ? raw.provider : null,
    };
  } catch {
    return empty;
  }
}

function save(): void {
  const key = saveKey();
  if (!key) return;
  try {
    if (state.items.length === 0 && history.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    // functions, like a proposal's apply, are left out by json
    let saved = JSON.stringify({ items: state.items, history, owed, provider } satisfies Saved);
    if (saved.length > MAX_SAVED)
      saved = JSON.stringify({ items: state.items, history: [], owed: [], provider: null } satisfies Saved);
    localStorage.setItem(key, saved);
  } catch {
    // a conversation that is not kept only means starting a new one next time
  }
}

const saved = restore();
let state: ChatState = { items: saved.items, busy: false };
// the conversation as the provider keeps it, sent back unchanged each turn
let history: unknown[] = saved.history;
// results owed for tool calls that have not reached the provider yet, because the turn was stopped,
// failed or morrow closed. they go out before the next message
let owed: ToolResult[] = saved.owed;
let provider: string | null = saved.provider;
let currentTurn: string | null = null;
let stopped = false;
const approvals = new Map<string, (approved: boolean) => void>();
const listeners = new Set<() => void>();
let counter = 0;
const nextId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

function set(next: Partial<ChatState>): void {
  state = { ...state, ...next };
  save();
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

const LABELS: Record<string, TranslationKey> = {
  search_pages: 'assistant.searchedPages',
  list_pages: 'assistant.lookedThroughPages',
  read_page: 'assistant.read',
  current_page: 'assistant.checkedOpenPage',
  todays_note: 'assistant.foundToday',
  open_page: 'assistant.opened',
};

function labelOf(call: ToolCall): string {
  const key = LABELS[call.name];
  const label = key ? t(key) : call.name;
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
      owed = [];
      save();
      if (result.text.trim()) push({ kind: 'assistant', id: nextId(), text: result.text.trim() });
      if (result.stop === 'refusal') {
        push({ kind: 'note', id: nextId(), text: t('assistant.refused'), tone: 'info' });
        return;
      }
      if (result.toolCalls.length === 0) {
        if (result.stop === 'length')
          push({
            kind: 'note',
            id: nextId(),
            text: t('assistant.cutShort'),
            tone: 'info',
          });
        return;
      }
      // every tool call needs its result. until they reach the provider they are owed, so a stop, a
      // failure or closing morrow still sends them with the next message
      owed = result.toolCalls.map((call) => ({ id: call.id, content: CLOSED_RESULT, isError: true }));
      save();
      for (const call of result.toolCalls) {
        const done = stopped
          ? { id: call.id, content: 'Stopped by the user.', isError: true }
          : await handleCall(call);
        owed = owed.map((entry) => (entry.id === call.id ? done : entry));
        save();
      }
      if (stopped || step + 1 >= MAX_STEPS) {
        push({
          kind: 'note',
          id: nextId(),
          text: stopped ? t('assistant.stopped') : t('assistant.tooManySteps'),
          tone: 'info',
        });
        return;
      }
      add = { kind: 'tools', results: owed };
    }
  } finally {
    currentTurn = null;
    set({ busy: false });
  }
}
