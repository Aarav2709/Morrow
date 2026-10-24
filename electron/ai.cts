// the optional assistant: off until someone adds their own key. the key stays in this process,
// encrypted by the system keychain, and the page only ever sees the conversation
import Anthropic from '@anthropic-ai/sdk';
import { app, net, safeStorage } from 'electron';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom';

interface Provider {
  id: ProviderId;
  label: string;
  // an openai compatible endpoint, empty for claude which goes through anthropic's own sdk
  baseUrl: string;
  needsKey: boolean;
  defaultModel: string;
  keyUrl: string;
}

const PROVIDERS: Provider[] = [
  {
    id: 'anthropic',
    label: 'Claude',
    baseUrl: '',
    needsKey: true,
    defaultModel: 'claude-opus-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'ChatGPT',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    defaultModel: '',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'custom',
    label: 'Other',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    defaultModel: '',
    keyUrl: '',
  },
];

interface Stored {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  // encrypted with the system keychain, base64
  key?: string;
}

export interface AiSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  hasKey: boolean;
  // where the key lives: the system keychain, or only until morrow closes when there is none
  keyStorage: 'system' | 'session';
  providers: Provider[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type TurnInput =
  | { kind: 'user'; text: string }
  // results for the last tool calls, with the next message when a stopped turn left some owed
  | { kind: 'tools'; results: Array<{ id: string; content: string; isError: boolean }>; text?: string };

export interface TurnRequest {
  id: string;
  history: unknown[];
  add: TurnInput;
  system: string;
  tools: ToolSpec[];
}

export type TurnResult =
  | {
      ok: true;
      history: unknown[];
      text: string;
      toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
      stop: 'done' | 'tools' | 'refusal' | 'length';
      model: string;
    }
  | { ok: false; error: string };

const settingsFile = () => path.join(app.getPath('userData'), 'assistant.json');
const MAX_TOKENS = 16000;

let cached: Stored | null = null;
// used when the system has no keychain, the key is then forgotten when morrow closes
let sessionKey: string | null = null;
const running = new Map<string, AbortController>();

function secureStorage(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // linux without a keyring falls back to a fixed password, which is no protection at all
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

const providerOf = (id: ProviderId): Provider => PROVIDERS.find((item) => item.id === id) ?? PROVIDERS[0]!;

async function load(): Promise<Stored> {
  if (cached) return cached;
  try {
    const raw = JSON.parse(await readFile(settingsFile(), 'utf8')) as Partial<Stored>;
    const provider = providerOf((raw.provider as ProviderId) ?? 'anthropic');
    cached = {
      provider: provider.id,
      model: typeof raw.model === 'string' ? raw.model : provider.defaultModel,
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : provider.baseUrl,
      ...(typeof raw.key === 'string' ? { key: raw.key } : {}),
    };
  } catch {
    cached = { provider: 'anthropic', model: PROVIDERS[0]!.defaultModel, baseUrl: '' };
  }
  return cached;
}

async function save(next: Stored): Promise<void> {
  cached = next;
  const file = settingsFile();
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
  await rename(temp, file);
}

function readKey(stored: Stored): string | null {
  if (stored.key && secureStorage()) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.key, 'base64'));
    } catch {
      return null;
    }
  }
  return sessionKey;
}

function publicSettings(stored: Stored): AiSettings {
  return {
    provider: stored.provider,
    model: stored.model,
    baseUrl: stored.baseUrl,
    hasKey: readKey(stored) !== null,
    keyStorage: secureStorage() ? 'system' : 'session',
    providers: PROVIDERS,
  };
}

export async function getAiSettings(): Promise<AiSettings> {
  return publicSettings(await load());
}

// a key of null removes it, a missing key keeps the one there is, changing provider forgets it
export async function setAiSettings(patch: {
  provider?: unknown;
  model?: unknown;
  baseUrl?: unknown;
  key?: unknown;
}): Promise<AiSettings> {
  const current = await load();
  const next: Stored = { ...current };
  if (typeof patch.provider === 'string' && patch.provider !== current.provider) {
    const provider = providerOf(patch.provider as ProviderId);
    next.provider = provider.id;
    next.model = provider.defaultModel;
    next.baseUrl = provider.baseUrl;
    delete next.key;
    sessionKey = null;
  }
  if (typeof patch.model === 'string') next.model = patch.model.trim().slice(0, 200);
  if (typeof patch.baseUrl === 'string')
    next.baseUrl = patch.baseUrl.trim().replace(/\/+$/, '').slice(0, 500);
  if (patch.key === null) {
    delete next.key;
    sessionKey = null;
  } else if (typeof patch.key === 'string' && patch.key.trim()) {
    const key = patch.key.trim();
    if (secureStorage()) next.key = safeStorage.encryptString(key).toString('base64');
    else sessionKey = key;
  }
  await save(next);
  return publicSettings(next);
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'The API key was not accepted.';
  if (error instanceof Anthropic.PermissionDeniedError)
    return 'This API key is not allowed to use that model.';
  if (error instanceof Anthropic.NotFoundError)
    return 'That model was not found. Pick another one in Settings.';
  if (error instanceof Anthropic.RateLimitError) return 'Too many requests for now, try again in a moment.';
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the service. Are you online?';
  if (error instanceof Anthropic.APIError)
    return `The service returned an error (${error.status}): ${error.message}`;
  if (error instanceof Error && error.name === 'AbortError') return 'Stopped.';
  // a request that never got an answer says only "fetch failed", the reason is underneath it
  const reason =
    error instanceof Error
      ? `${error.message} ${String((error.cause as Error | undefined)?.message ?? error.cause ?? '')}`
      : '';
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/.test(reason))
    return 'Could not reach the model. Check that it is running and the address in Settings is right.';
  if (/ECONNRESET|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|other side closed|socket hang up/i.test(reason))
    return 'The model stopped before answering. It may have run out of memory, try a smaller model.';
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(reason))
    return 'Could not reach the service. Are you online?';
  return error instanceof Error ? error.message : String(error);
}

// requests to other services go through chromium's network stack. node's own fetch gives up when no answer
// starts within five minutes, which a model on this computer reading a long page can easily take
function send(url: string, init: RequestInit): Promise<Response> {
  return net.fetch(url, init);
}

export async function listAiModels(): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const stored = await load();
  const key = readKey(stored);
  const provider = providerOf(stored.provider);
  if (provider.needsKey && !key) return { ok: false, models: [], error: 'Add an API key first.' };
  try {
    if (provider.id === 'anthropic') {
      const client = new Anthropic({ apiKey: key! });
      const models: string[] = [];
      for await (const model of client.models.list()) models.push(model.id);
      return { ok: true, models };
    }
    const response = await send(`${stored.baseUrl}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
    if (!response.ok) return { ok: false, models: [], error: await httpError(response) };
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const models = (body.data ?? [])
      .map((item) => String(item.id ?? '').replace(/^models\//, ''))
      // only models that chat, not the ones for pictures, speech or embeddings
      .filter(
        (id) =>
          id && !/embed|tts|whisper|dall-e|moderation|transcribe|image|audio|realtime|imagen|veo/i.test(id),
      )
      .sort();
    return { ok: true, models };
  } catch (error) {
    return { ok: false, models: [], error: describeError(error) };
  }
}

async function httpError(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: { message?: string } | string; message?: string };
    detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message ?? '');
  } catch {
    // the body was not json, the status says enough
  }
  if (response.status === 401 || response.status === 403) return 'The API key was not accepted.';
  if (response.status === 429) return 'Too many requests for now, try again in a moment.';
  return `The service returned an error (${response.status})${detail ? `: ${detail}` : '.'}`;
}

export function cancelAiTurn(id: unknown): void {
  running.get(String(id))?.abort();
}

// one reply from the model: the new input is added to the history, the reply comes back with it
export async function aiTurn(request: TurnRequest): Promise<TurnResult> {
  const stored = await load();
  const key = readKey(stored);
  const provider = providerOf(stored.provider);
  if (provider.needsKey && !key) return { ok: false, error: 'Add an API key in Settings first.' };
  if (!stored.model) return { ok: false, error: 'Choose a model in Settings first.' };
  const controller = new AbortController();
  running.set(request.id, controller);
  try {
    return provider.id === 'anthropic'
      ? await claudeTurn(request, stored, key!, controller.signal)
      : await compatibleTurn(request, stored, key, controller.signal);
  } catch (error) {
    return { ok: false, error: describeError(error) };
  } finally {
    running.delete(request.id);
  }
}

async function claudeTurn(
  request: TurnRequest,
  stored: Stored,
  key: string,
  signal: AbortSignal,
): Promise<TurnResult> {
  const history = [...(request.history as Anthropic.Beta.BetaMessageParam[])];
  if (request.add.kind === 'user') history.push({ role: 'user', content: request.add.text });
  else
    history.push({
      role: 'user',
      content: [
        ...request.add.results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.id,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })),
        ...(request.add.text ? [{ type: 'text' as const, text: request.add.text }] : []),
      ],
    });
  const client = new Anthropic({ apiKey: key });
  const response = await client.beta.messages.create(
    {
      model: stored.model,
      max_tokens: MAX_TOKENS,
      system: request.system,
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters as Anthropic.Beta.BetaTool.InputSchema,
      })),
      messages: history,
      // the rules and tools stay the same all conversation, so they are read from the cache after the first turn
      cache_control: { type: 'ephemeral' },
      // a declined request is answered by the model anthropic recommends for it instead of stopping
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    },
    { signal },
  );
  // the whole reply goes back next time, as it came, so nothing the model needs is lost
  history.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n');
  const toolCalls = response.content
    .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use')
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: (block.input ?? {}) as Record<string, unknown>,
    }));
  if (response.stop_reason === 'refusal')
    return {
      ok: true,
      history,
      text: text || response.stop_details?.explanation || 'The model declined to answer this.',
      toolCalls: [],
      stop: 'refusal',
      model: response.model,
    };
  return {
    ok: true,
    history,
    text,
    toolCalls,
    stop:
      response.stop_reason === 'max_tokens'
        ? 'length'
        : toolCalls.length && response.stop_reason === 'tool_use'
          ? 'tools'
          : 'done',
    model: response.model,
  };
}

interface CompatibleCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

async function compatibleTurn(
  request: TurnRequest,
  stored: Stored,
  key: string | null,
  signal: AbortSignal,
): Promise<TurnResult> {
  const history = [...(request.history as Array<Record<string, unknown>>)];
  if (request.add.kind === 'user') history.push({ role: 'user', content: request.add.text });
  else {
    for (const result of request.add.results)
      history.push({
        role: 'tool',
        tool_call_id: result.id,
        content: result.isError ? `Error: ${result.content}` : result.content,
      });
    if (request.add.text) history.push({ role: 'user', content: request.add.text });
  }
  const response = await send(`${stored.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      // openrouter shows where requests come from
      ...(stored.provider === 'openrouter' ? { 'X-Title': 'Morrow' } : {}),
    },
    body: JSON.stringify({
      model: stored.model,
      messages: [{ role: 'system', content: request.system }, ...history],
      tools: request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
    }),
  });
  if (!response.ok) return { ok: false, error: await httpError(response) };
  const body = (await response.json()) as {
    model?: string;
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string | null; tool_calls?: CompatibleCall[]; refusal?: string | null };
    }>;
  };
  const choice = body.choices?.[0];
  if (!choice?.message) return { ok: false, error: 'The service sent back an empty reply.' };
  const calls = (choice.message.tool_calls ?? []).map((call, index) => ({
    ...call,
    id: call.id || `call_${Date.now().toString(36)}_${index}`,
    type: 'function',
  }));
  history.push({
    role: 'assistant',
    content: choice.message.content ?? '',
    ...(calls.length ? { tool_calls: calls } : {}),
  });
  const toolCalls = calls.map((call) => ({
    id: call.id,
    name: call.function?.name ?? '',
    input: parseArguments(call.function?.arguments),
  }));
  const refused = choice.finish_reason === 'content_filter' || Boolean(choice.message.refusal);
  return {
    ok: true,
    history,
    text: choice.message.content ?? choice.message.refusal ?? '',
    toolCalls: refused ? [] : toolCalls,
    stop: refused
      ? 'refusal'
      : choice.finish_reason === 'length'
        ? 'length'
        : toolCalls.length
          ? 'tools'
          : 'done',
    model: body.model ?? stored.model,
  };
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { __invalid: raw };
  }
}
