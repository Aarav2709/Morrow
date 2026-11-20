import { useSyncExternalStore } from 'react';
import { displayTitle } from '../../core/model';
import type { PageId } from '../../core/model';
import { commitEditors } from '../editor/commits';
import { desktop } from '../platform/desktop';
import type {
  AcpEvent,
  AcpPermissionOption,
  AcpSessionMode,
  AcpSessionModel,
  AcpSettings,
  AcpSlashCommand,
} from '../platform/desktop';
import { getPreferences } from '../platform/preferences';
import { activeRoute } from '../router';
import { getSession, getState } from '../workspace';
import { buildAcpPromptParts } from './acpContext';
import type { AcpAttachment } from './acpContext';
import { exportSessionToNote } from './acpExport';
import type { ExportableItem } from './acpExport';
import { getAttachedSelection } from './selection';

export type SessionOrigin = 'panel' | 'tab' | 'floating' | 'embedded';
export type SessionStatus = 'idle' | 'starting' | 'running' | 'waiting-permission' | 'error';

export interface AcpDiffBlock {
  path: string;
  oldText: string;
  newText: string;
}

export type AcpChatItem =
  | {
      kind: 'user';
      id: string;
      text: string;
      attachments?: AcpAttachment[];
      mentions?: string[];
    }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string }
  | {
      kind: 'plan';
      id: string;
      entries: Array<{ content: string; status: string; priority?: string }>;
    }
  | {
      kind: 'tool';
      id: string;
      toolCallId: string;
      title: string;
      toolKind?: string;
      status: string;
      output?: string;
      diff?: AcpDiffBlock;
      terminalId?: string;
      terminalOutput?: string;
      exitCode?: number | null;
      locations?: string[];
    }
  | {
      kind: 'permission';
      id: string;
      requestId: string;
      title: string;
      detail?: string;
      options: AcpPermissionOption[];
      status: 'waiting' | 'approved' | 'rejected';
      chosenOptionName?: string;
    }
  | { kind: 'note'; id: string; text: string; tone: 'info' | 'error' };

export interface AcpDebugEntry {
  id: string;
  at: number;
  direction: 'in' | 'out' | 'stderr';
  line: string;
}

export interface AcpSession {
  id: string;
  agentId: string;
  agentName: string;
  agentSessionId: string | null;
  connected: boolean;
  cwd: string;
  title: string;
  origin: SessionOrigin;
  embeddedKey?: string;
  status: SessionStatus;
  modes: AcpSessionMode[];
  currentModeId: string | null;
  models: AcpSessionModel[];
  currentModelId: string | null;
  availableCommands: AcpSlashCommand[];
  items: AcpChatItem[];
  debugLog: AcpDebugEntry[];
  hasSentPrompt: boolean;
  createdAt: number;
  updatedAt: number;
}

interface PersistedSession {
  id: string;
  agentId: string;
  agentName: string;
  agentSessionId: string | null;
  cwd: string;
  title: string;
  origin: SessionOrigin;
  embeddedKey?: string;
  currentModeId: string | null;
  currentModelId: string | null;
  items: AcpChatItem[];
  createdAt: number;
  updatedAt: number;
}

interface AcpStoreState {
  sessions: AcpSession[];
  activePanelSessionId: string | null;
  activeFloatingSessionId: string | null;
  settings: AcpSettings | null;
}

const STORAGE_PREFIX = 'morrow.acpSessions';
const MAX_SAVED_SESSIONS = 40;
const MAX_DEBUG_LINES = 300;
let seq = 0;
const nextId = (prefix = 'acp') => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function storageKey(): string | null {
  try {
    const loc = getSession().location;
    return loc ? `${STORAGE_PREFIX}:${loc}` : STORAGE_PREFIX;
  } catch {
    return null;
  }
}

function serializeSessions(sessions: AcpSession[]): PersistedSession[] {
  return sessions
    .filter((s) => s.items.length > 0 || s.origin === 'embedded')
    .slice(0, MAX_SAVED_SESSIONS)
    .map((s) => ({
      id: s.id,
      agentId: s.agentId,
      agentName: s.agentName,
      agentSessionId: s.agentSessionId,
      cwd: s.cwd,
      title: s.title,
      origin: s.origin,
      ...(s.embeddedKey ? { embeddedKey: s.embeddedKey } : {}),
      currentModeId: s.currentModeId,
      currentModelId: s.currentModelId,
      items: s.items.map((item) => {
        if (item.kind === 'permission' && item.status === 'waiting') {
          return { ...item, status: 'rejected' as const };
        }
        return item;
      }),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
}

function restoreSessions(): AcpSession[] {
  const key = storageKey();
  if (!key) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((s): s is PersistedSession => typeof s?.id === 'string' && typeof s?.agentId === 'string')
      .map((s) => ({
        id: s.id,
        agentId: s.agentId,
        agentName: s.agentName || s.agentId,
        agentSessionId: s.agentSessionId ?? null,
        connected: false,
        cwd: s.cwd || '',
        title: s.title || 'New chat',
        origin: s.origin || 'panel',
        ...(s.embeddedKey ? { embeddedKey: s.embeddedKey } : {}),
        status: 'idle' as SessionStatus,
        modes: [],
        currentModeId: s.currentModeId ?? null,
        models: [],
        currentModelId: s.currentModelId ?? null,
        availableCommands: [],
        items: Array.isArray(s.items) ? s.items : [],
        debugLog: [],
        hasSentPrompt: Array.isArray(s.items) && s.items.some((i) => i.kind === 'user'),
        createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

function persist(sessions: AcpSession[]): void {
  const key = storageKey();
  if (!key) return;
  try {
    const payload = serializeSessions(sessions);
    if (payload.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

const initialSessions = restoreSessions();
let storeState: AcpStoreState = {
  sessions: initialSessions,
  activePanelSessionId: initialSessions.find((s) => s.origin === 'panel')?.id ?? null,
  activeFloatingSessionId: initialSessions.find((s) => s.origin === 'floating')?.id ?? null,
  settings: null,
};

const listeners = new Set<() => void>();
let eventUnsub: (() => void) | null = null;

function notify(): void {
  persist(storeState.sessions);
  for (const l of listeners) l();
}

function updateSession(id: string, fn: (session: AcpSession) => AcpSession): void {
  let changed = false;
  const next = storeState.sessions.map((s) => {
    if (s.id !== id) return s;
    changed = true;
    return fn(s);
  });
  if (!changed) return;
  storeState = { ...storeState, sessions: next };
  notify();
}

export function useAcpStore(): AcpStoreState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      ensureInitialized();
      return () => listeners.delete(listener);
    },
    () => storeState,
  );
}

export function getAcpState(): AcpStoreState {
  return storeState;
}

export function getAcpSession(id: string | null | undefined): AcpSession | null {
  if (!id) return null;
  return storeState.sessions.find((s) => s.id === id) ?? null;
}

export async function refreshAcpSettings(): Promise<AcpSettings | null> {
  if (!desktop?.acp) return null;
  const settings = await desktop.acp.settings();
  storeState = { ...storeState, settings };
  notify();
  return settings;
}

function agentDisplayName(agentId: string, settings: AcpSettings | null): string {
  const preset = settings?.presets.find((p) => p.id === agentId);
  if (preset) return preset.displayName;
  const custom = settings?.customAgents.find((c) => c.id === agentId);
  if (custom) return custom.displayName;
  return agentId;
}

function extractTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (block.type === 'content' && block.content && typeof block.content === 'object') {
      const inner = block.content as Record<string, unknown>;
      if (inner.type === 'text' && typeof inner.text === 'string') parts.push(inner.text);
    } else if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function extractDiffFromContent(content: unknown): AcpDiffBlock | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (block.type === 'diff' && typeof block.path === 'string') {
      return {
        path: block.path,
        oldText: typeof block.oldText === 'string' ? block.oldText : '',
        newText: typeof block.newText === 'string' ? block.newText : '',
      };
    }
  }
  return undefined;
}

function extractTerminalId(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if (block.type === 'terminal' && typeof block.terminalId === 'string') {
      return block.terminalId;
    }
  }
  return undefined;
}

export function applySessionUpdate(session: AcpSession, update: Record<string, unknown>): AcpSession {
  const kind = String(update.sessionUpdate ?? '');
  const now = Date.now();

  if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
    const content = update.content as Record<string, unknown> | undefined;
    const chunkText = content?.type === 'text' && typeof content.text === 'string' ? content.text : '';
    if (!chunkText) return session;
    const itemKind = kind === 'agent_thought_chunk' ? 'thought' : 'assistant';
    const last = session.items[session.items.length - 1];
    if (last && last.kind === itemKind) {
      const items = [...session.items];
      items[items.length - 1] = { ...last, text: last.text + chunkText };
      return { ...session, items, updatedAt: now };
    }
    return {
      ...session,
      items: [...session.items, { kind: itemKind, id: nextId(itemKind), text: chunkText }],
      updatedAt: now,
    };
  }

  if (kind === 'plan') {
    const rawEntries = Array.isArray(update.entries) ? update.entries : [];
    const entries = rawEntries.map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        content: String(e.content ?? ''),
        status: String(e.status ?? 'pending'),
        ...(typeof e.priority === 'string' ? { priority: e.priority } : {}),
      };
    });
    const existingIndex = [...session.items].reverse().findIndex((i) => i.kind === 'plan');
    if (existingIndex !== -1) {
      const idx = session.items.length - 1 - existingIndex;
      const items = [...session.items];
      const target = items[idx] as Extract<AcpChatItem, { kind: 'plan' }>;
      items[idx] = { ...target, entries };
      return { ...session, items, updatedAt: now };
    }
    return {
      ...session,
      items: [...session.items, { kind: 'plan', id: nextId('plan'), entries }],
      updatedAt: now,
    };
  }

  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const toolCallId = String(update.toolCallId ?? '');
    if (!toolCallId) return session;
    const title = typeof update.title === 'string' ? update.title : undefined;
    const toolKind = typeof update.kind === 'string' ? update.kind : undefined;
    const status = typeof update.status === 'string' ? update.status : undefined;
    const outputText = extractTextFromContent(update.content);
    const diff = extractDiffFromContent(update.content);
    const terminalId = extractTerminalId(update.content);
    const locations = Array.isArray(update.locations)
      ? update.locations
          .map((l) => (l && typeof l === 'object' ? String((l as Record<string, unknown>).path ?? '') : ''))
          .filter(Boolean)
      : undefined;

    const idx = session.items.findIndex((i) => i.kind === 'tool' && i.toolCallId === toolCallId);
    if (idx !== -1) {
      const items = [...session.items];
      const existing = items[idx] as Extract<AcpChatItem, { kind: 'tool' }>;
      items[idx] = {
        ...existing,
        ...(title ? { title } : {}),
        ...(toolKind ? { toolKind } : {}),
        ...(status ? { status } : {}),
        ...(outputText ? { output: existing.output ? `${existing.output}\n${outputText}` : outputText } : {}),
        ...(diff ? { diff } : {}),
        ...(terminalId ? { terminalId } : {}),
        ...(locations && locations.length > 0 ? { locations } : {}),
      };
      return { ...session, items, updatedAt: now };
    }

    return {
      ...session,
      items: [
        ...session.items,
        {
          kind: 'tool',
          id: nextId('tool'),
          toolCallId,
          title: title || toolCallId,
          ...(toolKind ? { toolKind } : {}),
          status: status || 'pending',
          ...(outputText ? { output: outputText } : {}),
          ...(diff ? { diff } : {}),
          ...(terminalId ? { terminalId } : {}),
          ...(locations && locations.length > 0 ? { locations } : {}),
        },
      ],
      updatedAt: now,
    };
  }

  if (kind === 'available_commands_update') {
    const cmds = Array.isArray(update.availableCommands)
      ? (update.availableCommands as AcpSlashCommand[])
      : [];
    return { ...session, availableCommands: cmds, updatedAt: now };
  }

  if (kind === 'current_mode_update') {
    const modeId = typeof update.currentModeId === 'string' ? update.currentModeId : session.currentModeId;
    return { ...session, currentModeId: modeId, updatedAt: now };
  }

  return session;
}

function handleAcpEvent(event: AcpEvent): void {
  if (event.kind === 'sessionUpdate') {
    updateSession(event.clientSessionId, (s) => applySessionUpdate(s, event.update));
    return;
  }

  if (event.kind === 'terminalOutput') {
    updateSession(event.clientSessionId, (s) => ({
      ...s,
      items: s.items.map((item) => {
        if (item.kind !== 'tool' || item.terminalId !== event.terminalId) return item;
        return {
          ...item,
          terminalOutput: event.output,
          ...(event.exited ? { exitCode: event.exitCode ?? null } : {}),
        };
      }),
    }));
    return;
  }

  if (event.kind === 'permissionRequest') {
    const title = String(event.toolCall?.title ?? 'Agent requests permission');
    const detail =
      typeof event.toolCall?.rawInput === 'object' && event.toolCall.rawInput
        ? JSON.stringify(event.toolCall.rawInput, null, 2)
        : undefined;
    updateSession(event.clientSessionId, (s) => ({
      ...s,
      status: 'waiting-permission',
      items: [
        ...s.items,
        {
          kind: 'permission',
          id: nextId('perm'),
          requestId: event.requestId,
          title,
          ...(detail ? { detail } : {}),
          options: event.options,
          status: 'waiting',
        },
      ],
      updatedAt: Date.now(),
    }));
    return;
  }

  if (event.kind === 'debug') {
    if (!getPreferences().acpDebugMode) return;
    updateSession(event.clientSessionId, (s) => ({
      ...s,
      debugLog: [
        ...s.debugLog.slice(-(MAX_DEBUG_LINES - 1)),
        { id: nextId('dbg'), at: Date.now(), direction: event.direction, line: event.line },
      ],
    }));
    return;
  }

  if (event.kind === 'exit') {
    updateSession(event.clientSessionId, (s) => ({
      ...s,
      connected: false,
      status: s.status === 'running' || s.status === 'waiting-permission' ? 'idle' : s.status,
    }));
  }
}

function ensureInitialized(): void {
  if (eventUnsub || !desktop?.acp) return;
  eventUnsub = desktop.acp.onEvent(handleAcpEvent);
  void refreshAcpSettings();
}

export async function createAcpSession(
  options: {
    agentId?: string;
    cwd?: string;
    origin?: SessionOrigin;
    title?: string;
    embeddedKey?: string;
    connectNow?: boolean;
  } = {},
): Promise<AcpSession> {
  ensureInitialized();
  const settings = storeState.settings ?? (await refreshAcpSettings());
  const agentId = options.agentId || settings?.defaultAgentId || 'claude-code-acp';
  const cwd = options.cwd || settings?.currentVaultPath || '';
  const id = nextId('sess');
  const origin = options.origin ?? 'panel';

  const session: AcpSession = {
    id,
    agentId,
    agentName: agentDisplayName(agentId, settings),
    agentSessionId: null,
    connected: false,
    cwd,
    title: options.title || 'New chat',
    origin,
    ...(options.embeddedKey ? { embeddedKey: options.embeddedKey } : {}),
    status: 'idle',
    modes: [],
    currentModeId: null,
    models: [],
    currentModelId: null,
    availableCommands: [],
    items: [],
    debugLog: [],
    hasSentPrompt: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  storeState = {
    ...storeState,
    sessions: [session, ...storeState.sessions],
    ...(origin === 'panel' ? { activePanelSessionId: id } : {}),
    ...(origin === 'floating' ? { activeFloatingSessionId: id } : {}),
  };
  notify();

  if (options.connectNow) {
    await connectAcpSession(id);
  }
  return getAcpSession(id) ?? session;
}

export async function connectAcpSession(sessionId: string): Promise<boolean> {
  const api = desktop?.acp;
  const session = getAcpSession(sessionId);
  if (!api || !session) return false;
  if (session.connected && session.agentSessionId) return true;

  updateSession(sessionId, (s) => ({ ...s, status: 'starting' }));
  const prefs = getPreferences();
  const res = session.agentSessionId
    ? await api.loadSession({
        clientSessionId: session.id,
        agentId: session.agentId,
        agentSessionId: session.agentSessionId,
        cwd: session.cwd || null,
        mcpEnabled: prefs.mcpEnabled,
        autoAllowPermissions: prefs.acpAutoAllowPermissions,
        systemNotifications: prefs.acpSystemNotifications,
      })
    : await api.startSession({
        clientSessionId: session.id,
        agentId: session.agentId,
        cwd: session.cwd || null,
        mcpEnabled: prefs.mcpEnabled,
        autoAllowPermissions: prefs.acpAutoAllowPermissions,
        systemNotifications: prefs.acpSystemNotifications,
      });

  if (!res.ok) {
    updateSession(sessionId, (s) => ({
      ...s,
      connected: false,
      status: 'error',
      items: [...s.items, { kind: 'note', id: nextId('err'), text: res.error, tone: 'error' }],
    }));
    return false;
  }

  updateSession(sessionId, (s) => ({
    ...s,
    connected: true,
    status: 'idle',
    agentSessionId: res.agentSessionId,
    cwd: res.cwd,
    modes: res.modes,
    currentModeId: res.currentModeId,
    models: res.models,
    currentModelId: res.currentModelId,
    agentName: res.agentName || s.agentName,
  }));
  return true;
}

export function setActivePanelSession(sessionId: string): void {
  storeState = { ...storeState, activePanelSessionId: sessionId };
  notify();
}

export function setActiveFloatingSession(sessionId: string): void {
  storeState = { ...storeState, activeFloatingSessionId: sessionId };
  notify();
}

export async function switchSessionAgent(sessionId: string, agentId: string): Promise<void> {
  const session = getAcpSession(sessionId);
  if (!session || session.agentId === agentId) return;
  if (session.connected) await desktop?.acp?.closeSession(sessionId);
  const settings = storeState.settings;
  updateSession(sessionId, (s) => ({
    ...s,
    agentId,
    agentName: agentDisplayName(agentId, settings),
    agentSessionId: null,
    connected: false,
    modes: [],
    currentModeId: null,
    models: [],
    currentModelId: null,
    availableCommands: [],
    hasSentPrompt: false,
  }));
}

export async function switchSessionDirectory(sessionId: string, cwd: string): Promise<void> {
  const session = getAcpSession(sessionId);
  if (!session || session.cwd === cwd) return;
  if (session.connected) await desktop?.acp?.closeSession(sessionId);
  updateSession(sessionId, (s) => ({
    ...s,
    cwd,
    agentSessionId: null,
    connected: false,
    hasSentPrompt: false,
    items: [
      ...s.items,
      { kind: 'note', id: nextId('note'), text: `Working directory set to ${cwd}`, tone: 'info' },
    ],
  }));
}

export async function clearOrResetSession(sessionId: string): Promise<void> {
  const session = getAcpSession(sessionId);
  if (!session) return;
  const prefs = getPreferences();
  if (prefs.acpAutoExportOnNew && session.items.length > 0) {
    await exportAcpSession(sessionId, { open: false });
  }
  if (session.connected) await desktop?.acp?.closeSession(sessionId);
  updateSession(sessionId, (s) => ({
    ...s,
    agentSessionId: null,
    connected: false,
    status: 'idle',
    title: 'New chat',
    items: [],
    debugLog: [],
    hasSentPrompt: false,
    updatedAt: Date.now(),
  }));
}

export async function closeAcpSession(sessionId: string): Promise<void> {
  const session = getAcpSession(sessionId);
  if (!session) return;
  const prefs = getPreferences();
  if (prefs.acpAutoExportOnClose && session.items.length > 0) {
    await exportAcpSession(sessionId, { open: false });
  }
  if (session.connected) await desktop?.acp?.closeSession(sessionId);
  const remaining = storeState.sessions.filter((s) => s.id !== sessionId);
  storeState = {
    ...storeState,
    sessions: remaining,
    activePanelSessionId:
      storeState.activePanelSessionId === sessionId
        ? (remaining.find((s) => s.origin === 'panel')?.id ?? remaining[0]?.id ?? null)
        : storeState.activePanelSessionId,
    activeFloatingSessionId:
      storeState.activeFloatingSessionId === sessionId
        ? (remaining.find((s) => s.origin === 'floating')?.id ?? remaining[0]?.id ?? null)
        : storeState.activeFloatingSessionId,
  };
  notify();
}

export async function forkAcpSession(sessionId: string): Promise<AcpSession | null> {
  const source = getAcpSession(sessionId);
  if (!source) return null;
  const forked = await createAcpSession({
    agentId: source.agentId,
    cwd: source.cwd,
    origin: source.origin === 'embedded' ? 'panel' : source.origin,
    title: `${source.title} (fork)`,
  });
  updateSession(forked.id, (s) => ({
    ...s,
    items: [...source.items],
    hasSentPrompt: false,
  }));
  return getAcpSession(forked.id);
}

export async function ensureEmbeddedSession(options: {
  embeddedKey: string;
  agentId?: string;
  cwd?: string;
  persistHistory: boolean;
}): Promise<AcpSession> {
  ensureInitialized();
  if (options.persistHistory) {
    const existing = storeState.sessions.find((s) => s.embeddedKey === options.embeddedKey);
    if (existing) return existing;
  }
  return createAcpSession({
    agentId: options.agentId,
    cwd: options.cwd,
    origin: 'embedded',
    title: `Embedded (${options.embeddedKey})`,
    embeddedKey: options.persistHistory ? options.embeddedKey : undefined,
  });
}

export async function sendAcpPrompt(
  sessionId: string,
  text: string,
  options: { explicitPageIds?: PageId[]; attachments?: AcpAttachment[] } = {},
): Promise<void> {
  const api = desktop?.acp;
  const trimmed = text.trim();
  const attachments = options.attachments ?? [];
  if (!api || (!trimmed && attachments.length === 0)) return;
  const session = getAcpSession(sessionId);
  if (!session || session.status === 'running' || session.status === 'starting') return;

  commitEditors();

  const route = activeRoute();
  const activePageId = route.name === 'page' ? route.id : null;
  const state = getState();
  const selection = getAttachedSelection();
  const prefs = getPreferences();

  const { prompt, mentionedTitles } = buildAcpPromptParts({
    text: trimmed || 'Please examine the attached media.',
    state,
    explicitPageIds: options.explicitPageIds ?? [],
    activePageId,
    selection,
    attachments,
    prefs,
    isFirstTurn: !session.hasSentPrompt,
  });

  const userTitle =
    session.items.length === 0 ? (trimmed || attachments[0]?.name || 'New chat').slice(0, 48) : session.title;

  updateSession(sessionId, (s) => ({
    ...s,
    title: userTitle,
    status: 'running',
    items: [
      ...s.items,
      {
        kind: 'user',
        id: nextId('user'),
        text: trimmed,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(mentionedTitles.length > 0 ? { mentions: mentionedTitles } : {}),
      },
    ],
    updatedAt: Date.now(),
  }));

  if (!getAcpSession(sessionId)?.connected) {
    const ok = await connectAcpSession(sessionId);
    if (!ok) return;
    updateSession(sessionId, (s) => ({ ...s, status: 'running' }));
  }

  const res = await api.prompt({
    clientSessionId: sessionId,
    prompt,
    autoAllowPermissions: prefs.acpAutoAllowPermissions,
    systemNotifications: prefs.acpSystemNotifications,
  });

  updateSession(sessionId, (s) => ({
    ...s,
    hasSentPrompt: true,
    status: res.ok ? 'idle' : 'error',
    items: res.ok
      ? s.items
      : [...s.items, { kind: 'note', id: nextId('err'), text: res.error, tone: 'error' }],
    updatedAt: Date.now(),
  }));
}

export async function broadcastAcpPrompt(
  sessionIds: string[],
  text: string,
  attachments: AcpAttachment[] = [],
): Promise<void> {
  await Promise.all(sessionIds.map((id) => sendAcpPrompt(id, text, { attachments })));
}

export async function cancelAcpTurn(sessionId: string): Promise<void> {
  await desktop?.acp?.cancel(sessionId);
  updateSession(sessionId, (s) => ({
    ...s,
    status: 'idle',
    items: [...s.items, { kind: 'note', id: nextId('stop'), text: 'Stopped.', tone: 'info' }],
  }));
}

export async function setAcpMode(sessionId: string, modeId: string): Promise<void> {
  const res = await desktop?.acp?.setMode(sessionId, modeId);
  if (res?.ok) {
    updateSession(sessionId, (s) => ({ ...s, currentModeId: modeId }));
  }
}

export async function setAcpModel(sessionId: string, modelId: string): Promise<void> {
  const res = await desktop?.acp?.setModel(sessionId, modelId);
  if (res?.ok) {
    updateSession(sessionId, (s) => ({ ...s, currentModelId: modelId }));
  }
}

export async function respondAcpPermission(
  sessionId: string,
  requestId: string,
  option: AcpPermissionOption | null,
): Promise<void> {
  await desktop?.acp?.respondPermission(requestId, option ? option.optionId : null);
  updateSession(sessionId, (s) => {
    const items = s.items.map((item) => {
      if (item.kind !== 'permission' || item.requestId !== requestId) return item;
      const isReject = !option || option.kind.includes('reject');
      return {
        ...item,
        status: isReject ? ('rejected' as const) : ('approved' as const),
        ...(option ? { chosenOptionName: option.name } : {}),
      };
    });
    const stillWaiting = items.some((i) => i.kind === 'permission' && i.status === 'waiting');
    return {
      ...s,
      status: stillWaiting ? 'waiting-permission' : 'running',
      items,
      updatedAt: Date.now(),
    };
  });
}

export function respondFirstWaitingPermission(approve: boolean): boolean {
  for (const session of storeState.sessions) {
    const waiting = session.items.find(
      (i): i is Extract<AcpChatItem, { kind: 'permission' }> =>
        i.kind === 'permission' && i.status === 'waiting',
    );
    if (!waiting) continue;
    const option = approve
      ? (waiting.options.find((o) => o.kind === 'allow_once' || o.kind === 'allow_always') ??
        waiting.options[0] ??
        null)
      : (waiting.options.find((o) => o.kind.includes('reject')) ?? null);
    void respondAcpPermission(session.id, waiting.requestId, option);
    return true;
  }
  return false;
}

export async function exportAcpSession(
  sessionId: string,
  options: { open?: boolean } = {},
): Promise<PageId | null> {
  const session = getAcpSession(sessionId);
  if (!session || session.items.length === 0) return null;
  const prefs = getPreferences();
  const items: ExportableItem[] = session.items
    .filter((i) => i.kind !== 'permission')
    .map((i) => i as ExportableItem);
  return exportSessionToNote(
    {
      id: session.id,
      title: session.title,
      agentName: session.agentName,
      cwd: session.cwd,
      createdAt: session.createdAt,
      items,
    },
    prefs,
    options,
  );
}

export function activeNoteTitle(): string | null {
  const route = activeRoute();
  if (route.name !== 'page') return null;
  const page = getState().pages[route.id];
  return page && !page.encrypted ? displayTitle(page) : null;
}
