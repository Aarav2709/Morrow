import { Check, CircleAlert, ExternalLink, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatShortcut } from '../actions';
import { openHref } from '../editor/EditorMenus';
import { desktop } from '../platform/desktop';
import type { AssistantProviderId, AssistantSettings } from '../platform/desktop';
import { setPreferences, usePreferences } from '../platform/preferences';

// the open panel listens for this to show the provider and model that were just picked
export const SETTINGS_CHANGED = 'morrow:assistant-settings';

// who makes each model, under its name on the provider tiles
const MAKERS: Record<AssistantProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google',
  openrouter: 'Many models, one key',
  custom: 'Ollama, LM Studio, your own',
};

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

type Connection =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; models: string[] }
  | { state: 'error'; message: string };

// the assistant section of settings: off by default, nothing is sent anywhere until you turn it on
export function AssistantSettingsSection() {
  const prefs = usePreferences();
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
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

  return (
    <section className="settings-section assistant-settings">
      <div className="assistant-settings-head">
        <span className="assistant-settings-icon">
          <Sparkles size={18} />
        </span>
        <div className="assistant-settings-intro">
          <h3>Assistant</h3>
          <p className="muted">
            Ask questions about your notes and have pages written or tidied up, with your own API key. Morrow
            has no AI of its own, so this stays off until you turn it on.
          </p>
        </div>
        <Switch
          label="Turn on the assistant"
          checked={prefs.assistant}
          onChange={(on) => setPreferences({ assistant: on, assistantOpen: on && prefs.assistantOpen })}
        />
      </div>

      {prefs.assistant && settings && (
        <div className="assistant-config">
          <div className="field">
            <span className="field-label" id="assistant-provider">
              Provider
            </span>
            <div className="provider-grid" role="radiogroup" aria-labelledby="assistant-provider">
              {settings.providers.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.provider === item.id}
                  className={`provider-tile${settings.provider === item.id ? ' is-active' : ''}`}
                  onClick={() => {
                    if (item.id === settings.provider) return;
                    setTyping(false);
                    setKey('');
                    void configure({ provider: item.id });
                  }}
                >
                  <strong>{item.label === 'Other' ? 'On your computer' : item.label}</strong>
                  <span>{MAKERS[item.id]}</span>
                </button>
              ))}
            </div>
          </div>

          {settings.provider === 'custom' && (
            <label className="field">
              <span className="field-label">Server address</span>
              <input
                className="text-input"
                key={settings.provider}
                defaultValue={settings.baseUrl}
                spellCheck={false}
                onBlur={(event) =>
                  event.target.value !== settings.baseUrl && void configure({ baseUrl: event.target.value })
                }
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              />
              <span className="field-help">
                Any server that speaks the OpenAI API. Ollama is http://localhost:11434/v1, LM Studio is
                http://localhost:1234/v1.
              </span>
            </label>
          )}

          <div className="field">
            <label className="field-label" htmlFor="assistant-key">
              API key
              {!provider?.needsKey && <span className="muted"> (only if your server asks for one)</span>}
            </label>
            <form
              className="field-row"
              onSubmit={(event) => {
                event.preventDefault();
                if (key.trim()) void configure({ key }).then(() => setKey(''));
              }}
            >
              <input
                id="assistant-key"
                className="text-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={settings.hasKey ? 'Saved. Paste a new key to replace it' : 'Paste your key here'}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              <button type="submit" className="button primary" disabled={!key.trim()}>
                Save
              </button>
              {settings.hasKey && (
                <button type="button" className="button" onClick={() => void configure({ key: null })}>
                  Remove
                </button>
              )}
            </form>
            <span className="field-help">
              {settings.hasKey
                ? settings.keyStorage === 'system'
                  ? 'Your key is encrypted by your system keychain and never leaves this computer except to the provider.'
                  : 'This system has no keychain, so the key is kept only until Morrow closes.'
                : provider?.keyUrl && (
                    <>
                      Get one at{' '}
                      <button type="button" className="link-button" onClick={() => openHref(provider.keyUrl)}>
                        {new URL(provider.keyUrl).hostname}
                        <ExternalLink size={11} />
                      </button>
                      . You pay the provider for what you use.
                    </>
                  )}
            </span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="assistant-model">
              Model
            </label>
            <div className="field-row">
              {listed ? (
                <select
                  id="assistant-model"
                  className="text-input select-input"
                  value={settings.model}
                  onChange={(event) => {
                    if (event.target.value === '__type') setTyping(true);
                    else void configure({ model: event.target.value });
                  }}
                >
                  {!models.includes(settings.model) && (
                    <option value={settings.model} disabled={!settings.model}>
                      {settings.model || 'Choose a model'}
                    </option>
                  )}
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                  <option value="__type">Type a model name…</option>
                </select>
              ) : (
                <input
                  id="assistant-model"
                  className="text-input"
                  key={`${settings.provider}-${settings.model}`}
                  defaultValue={settings.model}
                  placeholder="Model name, such as claude-opus-5-5"
                  spellCheck={false}
                  onBlur={(event) =>
                    event.target.value !== settings.model && void configure({ model: event.target.value })
                  }
                  onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                />
              )}
              <button
                type="button"
                className="icon-button bordered"
                aria-label="Check the connection and reload models"
                title="Check the connection and reload models"
                disabled={!usable || connection.state === 'checking'}
                onClick={() => {
                  setTyping(false);
                  setRefresh((count) => count + 1);
                }}
              >
                <RefreshCw size={15} className={connection.state === 'checking' ? 'spin' : undefined} />
              </button>
            </div>
            <span className={`field-help connection is-${connection.state}`}>
              {connection.state === 'checking' && (
                <>
                  <Loader2 size={13} className="spin" /> Checking the connection
                </>
              )}
              {connection.state === 'ok' && (
                <>
                  <Check size={13} /> Connected
                  {models.length > 0
                    ? `, ${models.length} model${models.length === 1 ? '' : 's'} available`
                    : ''}
                </>
              )}
              {connection.state === 'error' && (
                <>
                  <CircleAlert size={13} /> {connection.message}
                </>
              )}
              {connection.state === 'idle' &&
                (provider?.needsKey ? 'Save a key to see the models you can use.' : '')}
            </span>
          </div>

          <div className="assistant-toggle-row">
            <div>
              <strong>Ask before changing pages</strong>
              <span className="field-help">
                You see every change first. Changes are always kept in page history.
              </span>
            </div>
            <Switch
              label="Ask before changing pages"
              checked={prefs.assistantAsk}
              onChange={(assistantAsk) => setPreferences({ assistantAsk })}
            />
          </div>

          <p className="assistant-note">
            What you ask, and the pages the assistant reads, are sent to {provider?.label ?? 'the provider'}.
            Locked pages never are. Open it with {formatShortcut('Mod+J')} or from the sidebar.
          </p>
        </div>
      )}
    </section>
  );
}
