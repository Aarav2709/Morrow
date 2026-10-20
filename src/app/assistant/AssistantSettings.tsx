import { Check, CircleAlert, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatShortcut } from '../actions';
import { Switch } from '../components/primitives';
import { Select } from '../components/Select';
import { SettingRow, SettingsGroup } from '../components/SettingsRows';
import { openHref } from '../editor/EditorMenus';
import { useTranslation } from '../i18n';
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
  const { t } = useTranslation();
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
            : t('settings.assistant.help')
        }
      >
        <SettingRow
          label={t('settings.assistant.row')}
          help={t('settings.assistant.rowHelp')}
        >
          <Switch
            label={t('settings.assistant.switch')}
            checked={prefs.assistant}
            onChange={(on) => setPreferences({ assistant: on, assistantOpen: on && prefs.assistantOpen })}
          />
        </SettingRow>
      </SettingsGroup>

      {prefs.assistant && settings && (
        <>
          <SettingsGroup title={t('settings.assistant.connection')}>
            <SettingRow label={t('settings.assistant.provider')}>
              <Select<AssistantProviderId>
                label={t('settings.assistant.provider')}
                value={settings.provider}
                options={settings.providers.map((item) => ({
                  value: item.id,
                  label: item.label === 'Other' ? t('settings.assistant.otherProvider') : item.label,
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
                label={t('settings.assistant.serverAddress')}
                help={t('settings.assistant.serverAddressHelp')}
                stacked
              >
                <input
                  className="text-input small"
                  aria-label={t('settings.assistant.serverAddress')}
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
              label={provider?.needsKey ? t('settings.assistant.apiKey') : t('settings.assistant.apiKeyOptional')}
              help={
                settings.hasKey ? (
                  settings.keyStorage === 'system' ? (
                    t('settings.assistant.keySavedSystem')
                  ) : (
                    t('settings.assistant.keySavedSession')
                  )
                ) : provider?.keyUrl ? (
                  <>
                    {t('settings.assistant.getKeyPrefix')}
                    <button type="button" className="link-button" onClick={() => openHref(provider.keyUrl)}>
                      {new URL(provider.keyUrl).hostname}
                    </button>
                    {t('settings.assistant.getKeySuffix')}
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
                  aria-label={t('settings.assistant.apiKey')}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={settings.hasKey ? t('settings.assistant.replaceKey') : t('settings.assistant.pasteKey')}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                />
                <button type="submit" className="button small primary" disabled={!key.trim()}>
                  {t('settings.assistant.saveKey')}
                </button>
                {settings.hasKey && (
                  <button
                    type="button"
                    className="button small"
                    onClick={() => void configure({ key: null })}
                  >
                    {t('settings.assistant.removeKey')}
                  </button>
                )}
              </form>
            </SettingRow>

            <SettingRow
              label={t('settings.assistant.model')}
              help={
                <span className={`connection is-${connection.state}`}>
                  {connection.state === 'checking' && (
                    <>
                      <Loader2 size={12} className="spin" /> {t('settings.assistant.checkingConnection')}
                    </>
                  )}
                  {connection.state === 'ok' && (
                    <>
                      <Check size={12} /> {t('settings.assistant.connected')}
                      {models.length > 0 ? `, ${t('settings.assistant.modelsCount', { count: models.length })}` : ''}
                    </>
                  )}
                  {connection.state === 'error' && (
                    <>
                      <CircleAlert size={12} /> {connection.message}
                    </>
                  )}
                  {connection.state === 'idle' &&
                    (provider?.needsKey ? t('settings.assistant.saveKeyToSeeModels') : '')}
                </span>
              }
            >
              {listed ? (
                <Select<string>
                  label={t('settings.assistant.model')}
                  value={settings.model || null}
                  placeholder={t('settings.assistant.chooseModel')}
                  options={modelOptions.map((model) => ({ value: model, label: model }))}
                  footer={{ label: t('settings.assistant.typeModelName'), onSelect: () => setTyping(true) }}
                  onChange={(model) => void configure({ model })}
                />
              ) : (
                <input
                  className="text-input small settings-input"
                  aria-label={t('settings.assistant.model')}
                  key={`${settings.provider}-${settings.model}`}
                  defaultValue={settings.model}
                  placeholder={t('settings.assistant.modelNamePlaceholder')}
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
                aria-label={t('settings.assistant.reloadModels')}
                title={t('settings.assistant.reloadModels')}
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
            title={t('settings.assistant.changesTitle')}
            help={t('settings.assistant.changesHelp', {
              target: settings.provider === 'custom' ? t('settings.assistant.yourServer') : (provider?.label ?? t('settings.assistant.theProvider')),
              shortcut: formatShortcut('Mod+J'),
            })}
          >
            <SettingRow
              label={t('settings.assistant.askBeforeChanging')}
              help={t('settings.assistant.askBeforeChangingHelp')}
            >
              <Switch
                label={t('settings.assistant.askBeforeChanging')}
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
