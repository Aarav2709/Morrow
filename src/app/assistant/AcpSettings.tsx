import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Switch } from '../components/primitives';
import { Select } from '../components/Select';
import { SettingRow, SettingsGroup } from '../components/SettingsRows';
import { useTranslation } from '../i18n';
import { desktop } from '../platform/desktop';
import type { AcpConfigurePatch, AcpCustomAgentConfig, AcpSettings as AcpConfig } from '../platform/desktop';
import { setPreferences, usePreferences } from '../platform/preferences';
import { toast } from '../ui';
import { refreshAcpSettings } from './acpStore';

function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function textToEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return out;
}

function argsToText(args: string[]): string {
  return args.join('\n');
}

function textToArgs(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function AcpSettings() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const [cfg, setCfg] = useState<AcpConfig | null>(null);
  const [openPresets, setOpenPresets] = useState<Record<string, boolean>>({});
  const [openCustom, setOpenCustom] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void desktop?.acp?.settings().then(setCfg);
  }, []);

  const acp = desktop?.acp;
  if (!acp || !cfg) return null;

  const patch = async (next: AcpConfigurePatch) => {
    const updated = await acp.configure(next);
    setCfg(updated);
    void refreshAcpSettings();
  };

  const agentOptions = [
    ...cfg.presets.map((p) => ({ value: p.id, label: `${p.displayName} (${p.id})` })),
    ...cfg.customAgents.map((c) => ({ value: c.id, label: `${c.displayName || c.id} (${c.id})` })),
  ];

  const updateCustomAgent = (index: number, change: Partial<AcpCustomAgentConfig>) => {
    const next = cfg.customAgents.map((c, i) => (i === index ? { ...c, ...change } : c));
    void patch({ customAgents: next });
  };

  const addCustomAgent = () => {
    const n = cfg.customAgents.length + 1;
    const id = n === 1 ? 'custom-agent' : `custom-agent-${n}`;
    const created: AcpCustomAgentConfig = {
      id,
      displayName: t('settings.assistant.acp.customAgentDefaultName'),
      enabled: true,
      command: '',
      args: [],
      env: {},
    };
    setOpenCustom((prev) => ({ ...prev, [id]: true }));
    void patch({ customAgents: [...cfg.customAgents, created] });
  };

  const removeCustomAgent = (index: number) => {
    const next = cfg.customAgents.filter((_, i) => i !== index);
    void patch({ customAgents: next });
  };

  return (
    <>
      <SettingsGroup>
        <SettingRow
          label={t('settings.assistant.acp.defaultAgent')}
          help={t('settings.assistant.acp.defaultAgentHelp')}
        >
          <Select<string>
            label={t('settings.assistant.acp.defaultAgent')}
            value={cfg.defaultAgentId}
            options={agentOptions}
            onChange={(defaultAgentId) => void patch({ defaultAgentId })}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.assistant.acp.nodePath')}
          help={t('settings.assistant.acp.nodePathHelp')}
          stacked
        >
          <div className="settings-inline-form">
            <input
              className="text-input small"
              aria-label={t('settings.assistant.acp.nodePath')}
              key={cfg.nodePath}
              defaultValue={cfg.nodePath}
              placeholder={cfg.detectedNodePath ?? t('settings.assistant.acp.nodePathPlaceholder')}
              spellCheck={false}
              onBlur={(e) => e.target.value !== cfg.nodePath && void patch({ nodePath: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <button
              type="button"
              className="button small"
              onClick={() => {
                void acp.detectNode().then((found) => {
                  if (found) {
                    void patch({ nodePath: found });
                    toast(t('settings.assistant.acp.detectedNode', { path: found }));
                  } else {
                    toast(t('settings.assistant.acp.nodeNotFound'), { tone: 'error' });
                  }
                });
              }}
            >
              {t('settings.assistant.acp.autoDetect')}
            </button>
          </div>
        </SettingRow>

        <SettingRow
          label={t('settings.assistant.acp.sendShortcut')}
          help={t('settings.assistant.acp.sendShortcutHelp')}
        >
          <Select<'enter' | 'mod-enter'>
            label={t('settings.assistant.acp.sendShortcut')}
            value={prefs.acpSendShortcut}
            options={[
              { value: 'enter', label: t('settings.assistant.acp.sendEnter') },
              { value: 'mod-enter', label: t('settings.assistant.acp.sendModEnter') },
            ]}
            onChange={(acpSendShortcut) => setPreferences({ acpSendShortcut })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t('settings.assistant.acp.mentionsTitle')}>
        <SettingRow
          label={t('settings.assistant.acp.autoMentionActive')}
          help={t('settings.assistant.acp.autoMentionActiveHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.autoMentionActive')}
            checked={prefs.acpAutoMentionActive}
            onChange={(acpAutoMentionActive) => setPreferences({ acpAutoMentionActive })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.expandWikilinks')}
          help={t('settings.assistant.acp.expandWikilinksHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.expandWikilinks')}
            checked={prefs.acpExpandWikilinks}
            onChange={(acpExpandWikilinks) => setPreferences({ acpExpandWikilinks })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.maxNoteLength')}
          help={t('settings.assistant.acp.maxNoteLengthHelp')}
        >
          <input
            type="number"
            className="text-input small acp-num-input"
            min={500}
            max={200000}
            defaultValue={prefs.acpMaxNoteLength}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 500) setPreferences({ acpMaxNoteLength: v });
            }}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.maxSelectionLength')}
          help={t('settings.assistant.acp.maxSelectionLengthHelp')}
        >
          <input
            type="number"
            className="text-input small acp-num-input"
            min={500}
            max={200000}
            defaultValue={prefs.acpMaxSelectionLength}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 500) setPreferences({ acpMaxSelectionLength: v });
            }}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t('settings.assistant.acp.displayTitle')}>
        <SettingRow
          label={t('settings.assistant.acp.chatLocation')}
          help={t('settings.assistant.acp.chatLocationHelp')}
        >
          <Select<'right-pane' | 'tab' | 'split'>
            label={t('settings.assistant.acp.chatLocation')}
            value={prefs.acpChatLocation}
            options={[
              { value: 'right-pane', label: t('settings.assistant.acp.locationRightPane') },
              { value: 'tab', label: t('settings.assistant.acp.locationTab') },
              { value: 'split', label: t('settings.assistant.acp.locationSplit') },
            ]}
            onChange={(acpChatLocation) => setPreferences({ acpChatLocation })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.chatFontSize')}
          help={t('settings.assistant.acp.chatFontSizeHelp')}
        >
          <input
            type="number"
            className="text-input small acp-num-input"
            min={10}
            max={30}
            defaultValue={prefs.acpFontSize}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setPreferences({ acpFontSize: Math.min(30, Math.max(10, v)) });
            }}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.showEmojis')}
          help={t('settings.assistant.acp.showEmojisHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.showEmojis')}
            checked={prefs.acpShowEmojis}
            onChange={(acpShowEmojis) => setPreferences({ acpShowEmojis })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.autoCollapseDiffs')}
          help={t('settings.assistant.acp.autoCollapseDiffsHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.autoCollapseDiffs')}
            checked={prefs.acpAutoCollapseDiffs}
            onChange={(acpAutoCollapseDiffs) => setPreferences({ acpAutoCollapseDiffs })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t('settings.assistant.acp.floatingTitle')}>
        <SettingRow
          label={t('settings.assistant.acp.enableFloating')}
          help={t('settings.assistant.acp.enableFloatingHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.enableFloating')}
            checked={prefs.acpFloatingEnabled}
            onChange={(acpFloatingEnabled) => setPreferences({ acpFloatingEnabled })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.floatingImage')}
          help={t('settings.assistant.acp.floatingImageHelp')}
          stacked
        >
          <input
            className="text-input small"
            placeholder="https://example.com/avatar.png"
            defaultValue={prefs.acpFloatingButtonImage}
            onBlur={(e) => setPreferences({ acpFloatingButtonImage: e.target.value })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t('settings.assistant.acp.permissionsTitle')}>
        <SettingRow
          label={t('settings.assistant.acp.autoAllowPermissions')}
          help={t('settings.assistant.acp.autoAllowPermissionsHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.autoAllowPermissions')}
            checked={prefs.acpAutoAllowPermissions}
            onChange={(acpAutoAllowPermissions) => setPreferences({ acpAutoAllowPermissions })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t('settings.assistant.acp.notificationsTitle')}>
        <SettingRow
          label={t('settings.assistant.acp.systemNotifications')}
          help={t('settings.assistant.acp.systemNotificationsHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.systemNotifications')}
            checked={prefs.acpSystemNotifications}
            onChange={(acpSystemNotifications) => setPreferences({ acpSystemNotifications })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t('settings.assistant.acp.promptInjectionTitle')}>
        <SettingRow
          label={t('settings.assistant.acp.injectMarkdown')}
          help={t('settings.assistant.acp.injectMarkdownHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.injectMarkdown')}
            checked={prefs.acpInjectMarkdownRules}
            onChange={(acpInjectMarkdownRules) => setPreferences({ acpInjectMarkdownRules })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.tableSpacing')}
          help={t('settings.assistant.acp.tableSpacingHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.tableSpacing')}
            checked={prefs.acpInjectTableSpacing}
            onChange={(acpInjectTableSpacing) => setPreferences({ acpInjectTableSpacing })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.latexFormatting')}
          help={t('settings.assistant.acp.latexFormattingHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.latexFormatting')}
            checked={prefs.acpInjectLatexRules}
            onChange={(acpInjectLatexRules) => setPreferences({ acpInjectLatexRules })}
          />
        </SettingRow>
      </SettingsGroup>

      {desktop?.platform === 'win32' && (
        <SettingsGroup title={t('settings.assistant.acp.wslTitle')}>
          <SettingRow
            label={t('settings.assistant.acp.wslMode')}
            help={t('settings.assistant.acp.wslModeHelp')}
          >
            <Switch
              label={t('settings.assistant.acp.wslMode')}
              checked={cfg.wslMode}
              onChange={(wslMode) => void patch({ wslMode })}
            />
          </SettingRow>
        </SettingsGroup>
      )}

      <SettingsGroup title={t('settings.assistant.acp.presetAgentsTitle')}>
        {cfg.presets.map((preset) => {
          const isOpen = Boolean(openPresets[preset.id]);
          return (
            <div key={preset.id} className="acp-agent-card">
              <div className="acp-agent-card-head">
                <button
                  type="button"
                  className="acp-agent-card-toggle"
                  onClick={() => setOpenPresets((prev) => ({ ...prev, [preset.id]: !isOpen }))}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>{preset.displayName}</span>
                  <code className="acp-agent-id">{preset.id}</code>
                </button>
                <Switch
                  label={t('settings.assistant.acp.enableAgent', { name: preset.displayName })}
                  checked={preset.enabled}
                  onChange={(enabled) => void patch({ presets: [{ id: preset.id, enabled }] })}
                />
              </div>
              {isOpen && (
                <div className="acp-agent-card-body">
                  <SettingRow
                    label={t('settings.assistant.acp.path')}
                    help={t('settings.assistant.acp.presetPathHelp', { command: preset.defaultCommand })}
                    stacked
                  >
                    <input
                      className="text-input small"
                      defaultValue={preset.command}
                      placeholder={preset.defaultCommand}
                      spellCheck={false}
                      onBlur={(e) => void patch({ presets: [{ id: preset.id, command: e.target.value }] })}
                    />
                  </SettingRow>
                  <SettingRow
                    label={t('settings.assistant.acp.arguments')}
                    help={t('settings.assistant.acp.argumentsHelp')}
                    stacked
                  >
                    <textarea
                      className="text-input small acp-textarea"
                      rows={2}
                      defaultValue={argsToText(preset.args)}
                      spellCheck={false}
                      onBlur={(e) =>
                        void patch({ presets: [{ id: preset.id, args: textToArgs(e.target.value) }] })
                      }
                    />
                  </SettingRow>
                  <SettingRow
                    label={t('settings.assistant.acp.envVars')}
                    help={t('settings.assistant.acp.envVarsHelp')}
                    stacked
                  >
                    <textarea
                      className="text-input small acp-textarea"
                      rows={2}
                      defaultValue={envToText(preset.env)}
                      placeholder="ANTHROPIC_API_KEY=..."
                      spellCheck={false}
                      onBlur={(e) =>
                        void patch({ presets: [{ id: preset.id, env: textToEnv(e.target.value) }] })
                      }
                    />
                  </SettingRow>
                </div>
              )}
            </div>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title={t('settings.assistant.acp.customAgentsTitle')}>
        {cfg.customAgents.length === 0 ? (
          <p className="muted small acp-empty-custom">{t('settings.assistant.acp.noCustomAgents')}</p>
        ) : (
          cfg.customAgents.map((agent, index) => {
            const isOpen = Boolean(openCustom[agent.id]);
            const display = agent.displayName || t('settings.assistant.acp.customAgentDefaultName');
            return (
              <div key={`${agent.id}-${index}`} className="acp-agent-card">
                <div className="acp-agent-card-head">
                  <button
                    type="button"
                    className="acp-agent-card-toggle"
                    onClick={() => setOpenCustom((prev) => ({ ...prev, [agent.id]: !isOpen }))}
                  >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>{display}</span>
                  </button>
                  <div className="acp-agent-card-actions">
                    <Switch
                      label={t('settings.assistant.acp.enableAgent', { name: display })}
                      checked={agent.enabled}
                      onChange={(enabled) => updateCustomAgent(index, { enabled })}
                    />
                    <button
                      type="button"
                      className="icon-button small"
                      aria-label={t('settings.assistant.acp.deleteAgent', { name: display })}
                      onClick={() => removeCustomAgent(index)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="acp-agent-card-body">
                    <SettingRow
                      label={t('settings.assistant.acp.agentId')}
                      help={t('settings.assistant.acp.agentIdHelp')}
                      stacked
                    >
                      <input
                        className="text-input small"
                        defaultValue={agent.id}
                        spellCheck={false}
                        onBlur={(e) => updateCustomAgent(index, { id: e.target.value.trim() || agent.id })}
                      />
                    </SettingRow>
                    <SettingRow
                      label={t('settings.assistant.acp.displayName')}
                      help={t('settings.assistant.acp.displayNameHelp')}
                      stacked
                    >
                      <input
                        className="text-input small"
                        defaultValue={agent.displayName}
                        onBlur={(e) => updateCustomAgent(index, { displayName: e.target.value })}
                      />
                    </SettingRow>
                    <SettingRow
                      label={t('settings.assistant.acp.path')}
                      help={t('settings.assistant.acp.customPathHelp')}
                      stacked
                    >
                      <input
                        className="text-input small"
                        defaultValue={agent.command}
                        placeholder={t('settings.assistant.acp.customPathPlaceholder')}
                        spellCheck={false}
                        onBlur={(e) => updateCustomAgent(index, { command: e.target.value })}
                      />
                    </SettingRow>
                    <SettingRow
                      label={t('settings.assistant.acp.arguments')}
                      help={t('settings.assistant.acp.argumentsHelp')}
                      stacked
                    >
                      <textarea
                        className="text-input small acp-textarea"
                        rows={2}
                        defaultValue={argsToText(agent.args)}
                        placeholder={'--flag\n--another=value'}
                        spellCheck={false}
                        onBlur={(e) => updateCustomAgent(index, { args: textToArgs(e.target.value) })}
                      />
                    </SettingRow>
                    <SettingRow
                      label={t('settings.assistant.acp.envVars')}
                      help={t('settings.assistant.acp.envVarsHelp')}
                      stacked
                    >
                      <textarea
                        className="text-input small acp-textarea"
                        rows={2}
                        defaultValue={envToText(agent.env)}
                        placeholder="TOKEN=..."
                        spellCheck={false}
                        onBlur={(e) => updateCustomAgent(index, { env: textToEnv(e.target.value) })}
                      />
                    </SettingRow>
                  </div>
                )}
              </div>
            );
          })
        )}
        <SettingRow
          label={t('settings.assistant.acp.newCustomAgent')}
          help={t('settings.assistant.acp.newCustomAgentHelp')}
        >
          <button type="button" className="button small primary" onClick={addCustomAgent}>
            <Plus size={14} /> {t('settings.assistant.acp.addCustomAgent')}
          </button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t('settings.assistant.acp.exportTitle')}>
        <SettingRow
          label={t('settings.assistant.acp.exportFolder')}
          help={t('settings.assistant.acp.exportFolderHelp')}
        >
          <input
            className="text-input small settings-input"
            defaultValue={prefs.acpExportFolder}
            onBlur={(e) => setPreferences({ acpExportFolder: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.filename')}
          help={t('settings.assistant.acp.filenameHelp')}
        >
          <input
            className="text-input small settings-input"
            defaultValue={prefs.acpExportFilename}
            onBlur={(e) => setPreferences({ acpExportFilename: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.frontmatterTag')}
          help={t('settings.assistant.acp.frontmatterTagHelp')}
        >
          <input
            className="text-input small settings-input"
            defaultValue={prefs.acpExportTag}
            onBlur={(e) => setPreferences({ acpExportTag: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.includeImages')}
          help={t('settings.assistant.acp.includeImagesHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.includeImages')}
            checked={prefs.acpExportIncludeImages}
            onChange={(acpExportIncludeImages) => setPreferences({ acpExportIncludeImages })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.imageLocation')}
          help={t('settings.assistant.acp.imageLocationHelp')}
        >
          <Select<'attachments' | 'export-folder' | 'custom'>
            label={t('settings.assistant.acp.imageLocation')}
            value={prefs.acpExportImageLocation}
            options={[
              { value: 'attachments', label: t('settings.assistant.acp.locationAttachments') },
              { value: 'export-folder', label: t('settings.assistant.acp.locationExportFolder') },
              { value: 'custom', label: t('settings.assistant.acp.locationCustom') },
            ]}
            onChange={(acpExportImageLocation) => setPreferences({ acpExportImageLocation })}
          />
        </SettingRow>
        {prefs.acpExportImageLocation === 'custom' && (
          <SettingRow label={t('settings.assistant.acp.customImageFolder')} stacked>
            <input
              className="text-input small"
              defaultValue={prefs.acpExportImageCustomPath}
              onBlur={(e) => setPreferences({ acpExportImageCustomPath: e.target.value })}
            />
          </SettingRow>
        )}
        <SettingRow
          label={t('settings.assistant.acp.includeAudio')}
          help={t('settings.assistant.acp.includeAudioHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.includeAudio')}
            checked={prefs.acpExportIncludeAudio}
            onChange={(acpExportIncludeAudio) => setPreferences({ acpExportIncludeAudio })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.audioLocation')}
          help={t('settings.assistant.acp.audioLocationHelp')}
        >
          <Select<'attachments' | 'export-folder' | 'custom'>
            label={t('settings.assistant.acp.audioLocation')}
            value={prefs.acpExportAudioLocation}
            options={[
              { value: 'attachments', label: t('settings.assistant.acp.locationAttachments') },
              { value: 'export-folder', label: t('settings.assistant.acp.locationExportFolder') },
              { value: 'custom', label: t('settings.assistant.acp.locationCustom') },
            ]}
            onChange={(acpExportAudioLocation) => setPreferences({ acpExportAudioLocation })}
          />
        </SettingRow>
        {prefs.acpExportAudioLocation === 'custom' && (
          <SettingRow label={t('settings.assistant.acp.customAudioFolder')} stacked>
            <input
              className="text-input small"
              defaultValue={prefs.acpExportAudioCustomPath}
              onBlur={(e) => setPreferences({ acpExportAudioCustomPath: e.target.value })}
            />
          </SettingRow>
        )}
        <SettingRow
          label={t('settings.assistant.acp.autoExportNew')}
          help={t('settings.assistant.acp.autoExportNewHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.autoExportNew')}
            checked={prefs.acpAutoExportOnNew}
            onChange={(acpAutoExportOnNew) => setPreferences({ acpAutoExportOnNew })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.autoExportClose')}
          help={t('settings.assistant.acp.autoExportCloseHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.autoExportClose')}
            checked={prefs.acpAutoExportOnClose}
            onChange={(acpAutoExportOnClose) => setPreferences({ acpAutoExportOnClose })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.assistant.acp.openAfterExport')}
          help={t('settings.assistant.acp.openAfterExportHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.openAfterExport')}
            checked={prefs.acpOpenAfterExport}
            onChange={(acpOpenAfterExport) => setPreferences({ acpOpenAfterExport })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title={t('settings.assistant.acp.developerTitle')}>
        <SettingRow
          label={t('settings.assistant.acp.debugMode')}
          help={t('settings.assistant.acp.debugModeHelp')}
        >
          <Switch
            label={t('settings.assistant.acp.debugMode')}
            checked={prefs.acpDebugMode}
            onChange={(acpDebugMode) => setPreferences({ acpDebugMode })}
          />
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
