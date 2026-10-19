import { Check, CircleAlert, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatShortcut } from '../actions';
import { Switch } from '../components/primitives';
import { Select } from '../components/Select';
import { SettingRow, SettingsGroup } from '../components/SettingsRows';
import { openHref } from '../editor/EditorMenus';
import { desktop } from '../platform/desktop';
import type { AssistantProviderId, AssistantSettings as Settings } from '../platform/desktop';
import { setPreferences, usePreferences } from '../platform/preferences';

// the open panel listens for this to show the provider and model that were just picked
export const SETTINGS_CHANGED = 'morrow:assistant-settings';

// who makes each provider's models, under its name in the list
const MAKERS: Record<AssistantProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google',
  openrouter: 'Many models, one key',
  custom: 'Ollama, LM Studio, your own',
};

type Connection =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; models: string[] }
  | { state: 'error'; message: string };

// the assistant section of settings: off by default, nothing is sent anywhere until you turn it on
export function AssistantSettings() {
  const prefs = usePreferences();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [key, setKey] = useState('');
  const [checked, setChecked] = useState<{ for: string; connection: Connection } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [typing, setTyping] = useState(false);
  const api = desktop?.assistant;

  const provider = settings?.providers.find((item) => item.id === settings.provider);
  const usable = Boolean(settings && (settings.hasKey || !provider?.needsKey));

  useEffect(() => {
    if (prefs.assistant) void api?.settings().then(setSettings);
  }, [api, prefs.assistant]);

  // the model list doubles as a check that the key works, so it loads whenever the provider or key changes
  const needsModel = Boolean(settings && !settings.model);
  const target = settings ? `${settings.provider}|${settings.baseUrl}|${settings.hasKey}|${refresh}` : '';
  useEffect(() => {
    if (!api || !prefs.assistant || !usable) return;
    let live = true;
    void api.models().then((result) => {
      if (!live) return;
      // a local server with a single model needs no choosing
      if (result.ok && result.models.length === 1 && needsModel)
        void api.configure({ model: result.models[0]! }).then((next) => live && setSettings(next));
      setChecked({
        for: target,
        connection: result.ok
          ? { state: 'ok', models: result.models }
          : { state: 'error', message: result.error ?? 'Could not connect.' },
      });
    });
    return () => {
      live = false;
    };
  }, [api, prefs.assistant, usable, target, needsModel]);

  const configure = async (patch: Parameters<NonNullable<typeof api>['configure']>[0]) => {
    if (!api) return;
    const next = await api.configure(patch);
    setSettings(next);
    window.dispatchEvent(new Event(SETTINGS_CHANGED));
    return next;
  };

  if (!api) return null;
  // without a key there is nothing to connect with, and a result for other settings is out of date
  const connection: Connection = !usable
    ? { state: 'idle' }
    : checked?.for === target
      ? checked.connection
      : { state: 'checking' };
  const models = connection.state === 'ok' ? connection.models : [];
  const listed = models.length > 0 && !typing;
  const modelOptions = [
    ...(settings?.model && !models.includes(settings.model) ? [settings.model] : []),
    ...models,
  ];

  return (
    <>
      <SettingsGroup
        help={
          prefs.assistant
            ? undefined
            : 'Morrow has no AI of its own. Nothing is sent anywhere until you turn this on.'
        }
      >
        <SettingRow
          label="Assistant"
          help="Ask about your notes and have pages written or tidied up, with your own API key."
        >
          <Switch
            label="Turn on the assistant"
            checked={prefs.assistant}
            onChange={(on) => setPreferences({ assistant: on, assistantOpen: on && prefs.assistantOpen })}
          />
        </SettingRow>
      </SettingsGroup>

      {prefs.assistant && settings && (
        <>
          <SettingsGroup title="Connection">
            <SettingRow label="Provider">
              <Select<AssistantProviderId>
                label="Provider"
                value={settings.provider}
                options={settings.providers.map((item) => ({
                  value: item.id,
                  label: item.label === 'Other' ? 'On your computer' : item.label,
                  detail: MAKERS[item.id],
                }))}
                onChange={(id) => {
                  setTyping(false);
                  setKey('');
                  void configure({ provider: id });
                }}
              />
            </SettingRow>

            {settings.provider === 'custom' && (
              <SettingRow
                label="Server address"
                help="Any server that speaks the OpenAI API, such as Ollama at http://localhost:11434/v1."
                stacked
              >
                <input
                  className="text-input small"
                  aria-label="Server address"
                  key={settings.provider}
                  defaultValue={settings.baseUrl}
                  spellCheck={false}
                  onBlur={(event) =>
                    event.target.value !== settings.baseUrl && void configure({ baseUrl: event.target.value })
                  }
                  onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                />
              </SettingRow>
            )}

            <SettingRow
              label={provider?.needsKey ? 'API key' : 'API key, if your server asks for one'}
              help={
                settings.hasKey ? (
                  settings.keyStorage === 'system' ? (
                    'Saved, encrypted by your system keychain.'
                  ) : (
                    'Kept only until Morrow closes, this system has no keychain.'
                  )
                ) : provider?.keyUrl ? (
                  <>
                    Get one at{' '}
                    <button type="button" className="link-button" onClick={() => openHref(provider.keyUrl)}>
                      {new URL(provider.keyUrl).hostname}
                    </button>
                    . You pay the provider for what you use.
                  </>
                ) : undefined
              }
              stacked
            >
              <form
                className="settings-inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (key.trim()) void configure({ key }).then(() => setKey(''));
                }}
              >
                <input
                  className="text-input small"
                  type="password"
                  aria-label="API key"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={settings.hasKey ? '••••••••  Paste a new key to replace it' : 'Paste your key'}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                />
                <button type="submit" className="button small primary" disabled={!key.trim()}>
                  Save
                </button>
                {settings.hasKey && (
                  <button
                    type="button"
                    className="button small"
                    onClick={() => void configure({ key: null })}
                  >
                    Remove
                  </button>
                )}
              </form>
            </SettingRow>

            <SettingRow
              label="Model"
              help={
                <span className={`connection is-${connection.state}`}>
                  {connection.state === 'checking' && (
                    <>
                      <Loader2 size={12} className="spin" /> Checking the connection
                    </>
                  )}
                  {connection.state === 'ok' && (
                    <>
                      <Check size={12} /> Connected
                      {models.length > 0 ? `, ${models.length} model${models.length === 1 ? '' : 's'}` : ''}
                    </>
                  )}
                  {connection.state === 'error' && (
                    <>
                      <CircleAlert size={12} /> {connection.message}
                    </>
                  )}
                  {connection.state === 'idle' &&
                    (provider?.needsKey ? 'Save a key to see your models.' : '')}
                </span>
              }
            >
              {listed ? (
                <Select<string>
                  label="Model"
                  value={settings.model || null}
                  placeholder="Choose a model"
                  options={modelOptions.map((model) => ({ value: model, label: model }))}
                  footer={{ label: 'Type a model name…', onSelect: () => setTyping(true) }}
                  onChange={(model) => void configure({ model })}
                />
              ) : (
                <input
                  className="text-input small settings-input"
                  aria-label="Model"
                  key={`${settings.provider}-${settings.model}`}
                  defaultValue={settings.model}
                  placeholder="Model name"
                  spellCheck={false}
                  autoFocus={typing}
                  onBlur={(event) => {
                    if (event.target.value !== settings.model) void configure({ model: event.target.value });
                    setTyping(false);
                  }}
                  onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                />
              )}
              <button
                type="button"
                className="icon-button"
                aria-label="Check the connection and reload models"
                title="Check the connection and reload models"
                disabled={!usable || connection.state === 'checking'}
                onClick={() => {
                  setTyping(false);
                  setRefresh((count) => count + 1);
                }}
              >
                <RefreshCw size={14} className={connection.state === 'checking' ? 'spin' : undefined} />
              </button>
            </SettingRow>
          </SettingsGroup>

          <SettingsGroup
            title="Changes"
            help={`What you ask, and the pages it reads, are sent to ${settings.provider === 'custom' ? 'your server' : (provider?.label ?? 'the provider')}. Locked pages never are. Open the assistant with ${formatShortcut('Mod+J')}.`}
          >
            <SettingRow
              label="Ask before changing pages"
              help="Every change is kept in page history either way."
            >
              <Switch
                label="Ask before changing pages"
                checked={prefs.assistantAsk}
                onChange={(assistantAsk) => setPreferences({ assistantAsk })}
              />
            </SettingRow>
          </SettingsGroup>
        </>
      )}
    </>
  );
}
