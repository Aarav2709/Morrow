import { FolderOpen, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import { setPreferences, usePreferences } from '../platform/preferences';
import {
  listPlugins,
  openPluginsFolder,
  reloadPlugin,
  setPluginEnabled,
  startPlugins,
  stopPlugins,
  subscribePluginList,
} from '../plugins';
import type { PluginInfo } from '../plugins';
import { toast } from '../ui';
import { Switch } from './primitives';
import { SettingRow, SettingsGroup } from './SettingsRows';

export function PluginSettings() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void listPlugins().then((list) => {
        if (alive) setPlugins(list);
      });
    refresh();
    const stop = subscribePluginList(refresh);
    // plugins added to the folder while settings is open show up when the window comes back into focus
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      stop();
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const failed = (error: unknown) =>
    toast(error instanceof Error ? error.message : String(error), { tone: 'error' });

  return (
    <>
      <SettingsGroup help={t('settings.plugins.allowHelp')}>
        <SettingRow label={t('settings.plugins.allow')}>
          <Switch
            label={t('settings.plugins.allow')}
            checked={prefs.plugins}
            onChange={(plugins) => {
              setPreferences({ plugins });
              if (plugins) void startPlugins();
              else stopPlugins();
            }}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t('settings.plugins.installed')}>
        {plugins && plugins.length === 0 && <SettingRow label={t('settings.plugins.none')} />}
        {plugins?.map((plugin) => (
          <SettingRow
            key={plugin.id}
            label={
              <>
                {plugin.name}
                {plugin.version && <span className="settings-row-help"> {plugin.version}</span>}
              </>
            }
            help={
              plugin.error
                ? t('settings.plugins.failed', { error: plugin.error })
                : [plugin.description, plugin.author && t('settings.plugins.by', { author: plugin.author })]
                    .filter(Boolean)
                    .join(' · ')
            }
          >
            {plugin.enabled && prefs.plugins && (
              <button
                type="button"
                className="icon-button"
                aria-label={t('settings.plugins.reload')}
                title={t('settings.plugins.reload')}
                onClick={() => void reloadPlugin(plugin.id).catch(failed)}
              >
                <RotateCw size={14} />
              </button>
            )}
            <Switch
              label={plugin.name}
              checked={plugin.enabled}
              disabled={!prefs.plugins}
              onChange={(enabled) => void setPluginEnabled(plugin.id, enabled).catch(failed)}
            />
          </SettingRow>
        ))}
        <SettingRow label={t('settings.plugins.folder')}>
          <button
            type="button"
            className="button small"
            onClick={() => void openPluginsFolder().catch(failed)}
          >
            <FolderOpen size={14} /> {t('settings.plugins.folder')}
          </button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
