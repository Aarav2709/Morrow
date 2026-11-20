import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Switch } from '../components/primitives';
import { Select } from '../components/Select';
import { SettingRow, SettingsGroup } from '../components/SettingsRows';
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
      displayName: 'Custom agent',
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
        <SettingRow label="Default agent" help="Choose which ACP agent is used when opening a new chat.">
          <Select<string>
            label="Default agent"
            value={cfg.defaultAgentId}
            options={agentOptions}
            onChange={(defaultAgentId) => void patch({ defaultAgentId })}
          />
        </SettingRow>

        <SettingRow
          label="Node.js path"
          help="Path to Node.js. Usually leave blank unless node is in a non-standard location."
          stacked
        >
          <div className="settings-inline-form">
            <input
              className="text-input small"
              aria-label="Node.js path"
              key={cfg.nodePath}
              defaultValue={cfg.nodePath}
              placeholder={cfg.detectedNodePath ?? 'Leave blank (auto-detect)'}
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
                    toast(`Detected Node.js: ${found}`);
                  } else {
                    toast('Could not find Node.js automatically.', { tone: 'error' });
                  }
                });
              }}
            >
              Auto-detect
            </button>
          </div>
        </SettingRow>

        <SettingRow label="Send message shortcut" help="Choose the keyboard shortcut to send messages.">
          <Select<'enter' | 'mod-enter'>
            label="Send message shortcut"
            value={prefs.acpSendShortcut}
            options={[
              { value: 'enter', label: 'Enter to send, Shift+Enter for newline' },
              { value: 'mod-enter', label: 'Ctrl/Cmd+Enter to send' },
            ]}
            onChange={(acpSendShortcut) => setPreferences({ acpSendShortcut })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Mentions">
        <SettingRow
          label="Auto-mention active note"
          help="Include the current note automatically without typing @notename."
        >
          <Switch
            label="Auto-mention active note"
            checked={prefs.acpAutoMentionActive}
            onChange={(acpAutoMentionActive) => setPreferences({ acpAutoMentionActive })}
          />
        </SettingRow>
        <SettingRow
          label="Expand wikilink context"
          help="Surface [[wikilinks]] inside mentioned notes as resolved file paths so the agent can read them."
        >
          <Switch
            label="Expand wikilink context"
            checked={prefs.acpExpandWikilinks}
            onChange={(acpExpandWikilinks) => setPreferences({ acpExpandWikilinks })}
          />
        </SettingRow>
        <SettingRow
          label="Max note length"
          help="Maximum characters per mentioned note. Longer notes are truncated."
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
          label="Max selection length"
          help="Maximum characters for highlighted text selection context."
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

      <SettingsGroup title="Display">
        <SettingRow label="Chat view location" help="Where to open new chat views.">
          <Select<'right-pane' | 'tab' | 'split'>
            label="Chat view location"
            value={prefs.acpChatLocation}
            options={[
              { value: 'right-pane', label: 'Right pane (panel)' },
              { value: 'tab', label: 'Editor tab' },
              { value: 'split', label: 'Split pane' },
            ]}
            onChange={(acpChatLocation) => setPreferences({ acpChatLocation })}
          />
        </SettingRow>
        <SettingRow label="Chat font size" help="Adjust the font size of the chat message area (10-30px).">
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
          label="Show emojis"
          help="Display emoji icons in tool calls, thoughts, plans, and terminal blocks."
        >
          <Switch
            label="Show emojis"
            checked={prefs.acpShowEmojis}
            onChange={(acpShowEmojis) => setPreferences({ acpShowEmojis })}
          />
        </SettingRow>
        <SettingRow
          label="Auto-collapse long diffs"
          help="Automatically collapse diffs that exceed the line threshold."
        >
          <Switch
            label="Auto-collapse long diffs"
            checked={prefs.acpAutoCollapseDiffs}
            onChange={(acpAutoCollapseDiffs) => setPreferences({ acpAutoCollapseDiffs })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Floating chat">
        <SettingRow
          label="Enable floating chat"
          help="Enable the floating chat button and draggable chat windows."
        >
          <Switch
            label="Enable floating chat"
            checked={prefs.acpFloatingEnabled}
            onChange={(acpFloatingEnabled) => setPreferences({ acpFloatingEnabled })}
          />
        </SettingRow>
        <SettingRow
          label="Floating button image"
          help="URL or path to an image for the floating button. Leave empty for default icon."
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

      <SettingsGroup title="Permissions">
        <SettingRow
          label="Auto-allow permissions"
          help="Automatically allow all permission requests from agents. Use with caution: this gives agents full access to your system."
        >
          <Switch
            label="Auto-allow permissions"
            checked={prefs.acpAutoAllowPermissions}
            onChange={(acpAutoAllowPermissions) => setPreferences({ acpAutoAllowPermissions })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Notifications">
        <SettingRow
          label="System notifications"
          help="Show OS notifications when the agent completes a response or requests permission while Morrow is unfocused."
        >
          <Switch
            label="System notifications"
            checked={prefs.acpSystemNotifications}
            onChange={(acpSystemNotifications) => setPreferences({ acpSystemNotifications })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Prompt injection">
        <SettingRow
          label="Inject Morrow Markdown instructions"
          help="Include formatting guidance in the first message of each session so agents produce Morrow-compatible Markdown."
        >
          <Switch
            label="Inject Morrow Markdown instructions"
            checked={prefs.acpInjectMarkdownRules}
            onChange={(acpInjectMarkdownRules) => setPreferences({ acpInjectMarkdownRules })}
          />
        </SettingRow>
        <SettingRow
          label="Markdown table spacing"
          help="Instruct agents to leave a blank line before Markdown tables so Morrow renders them cleanly."
        >
          <Switch
            label="Markdown table spacing"
            checked={prefs.acpInjectTableSpacing}
            onChange={(acpInjectTableSpacing) => setPreferences({ acpInjectTableSpacing })}
          />
        </SettingRow>
        <SettingRow
          label="LaTeX math formatting"
          help="Instruct agents to use $...$ and $$...$$ delimiters for math expressions."
        >
          <Switch
            label="LaTeX math formatting"
            checked={prefs.acpInjectLatexRules}
            onChange={(acpInjectLatexRules) => setPreferences({ acpInjectLatexRules })}
          />
        </SettingRow>
      </SettingsGroup>

      {desktop?.platform === 'win32' && (
        <SettingsGroup title="Windows Subsystem for Linux">
          <SettingRow
            label="Enable WSL mode"
            help="Run agents inside Windows Subsystem for Linux. Recommended for agents like Codex that work better in Linux."
          >
            <Switch
              label="Enable WSL mode"
              checked={cfg.wslMode}
              onChange={(wslMode) => void patch({ wslMode })}
            />
          </SettingRow>
        </SettingsGroup>
      )}

      <SettingsGroup title="Preset agents">
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
                  label={`Enable ${preset.displayName}`}
                  checked={preset.enabled}
                  onChange={(enabled) => void patch({ presets: [{ id: preset.id, enabled }] })}
                />
              </div>
              {isOpen && (
                <div className="acp-agent-card-body">
                  <SettingRow label="Path" help={`Default command: ${preset.defaultCommand}`} stacked>
                    <input
                      className="text-input small"
                      defaultValue={preset.command}
                      placeholder={preset.defaultCommand}
                      spellCheck={false}
                      onBlur={(e) => void patch({ presets: [{ id: preset.id, command: e.target.value }] })}
                    />
                  </SettingRow>
                  <SettingRow label="Arguments" help="One argument per line." stacked>
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
                  <SettingRow label="Environment variables" help="KEY=VALUE pairs, one per line." stacked>
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

      <SettingsGroup title="Custom agents">
        {cfg.customAgents.length === 0 ? (
          <p className="muted small acp-empty-custom">No custom agents configured yet.</p>
        ) : (
          cfg.customAgents.map((agent, index) => {
            const isOpen = Boolean(openCustom[agent.id]);
            return (
              <div key={`${agent.id}-${index}`} className="acp-agent-card">
                <div className="acp-agent-card-head">
                  <button
                    type="button"
                    className="acp-agent-card-toggle"
                    onClick={() => setOpenCustom((prev) => ({ ...prev, [agent.id]: !isOpen }))}
                  >
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>{agent.displayName || 'Custom agent'}</span>
                  </button>
                  <div className="acp-agent-card-actions">
                    <Switch
                      label={`Enable ${agent.displayName}`}
                      checked={agent.enabled}
                      onChange={(enabled) => updateCustomAgent(index, { enabled })}
                    />
                    <button
                      type="button"
                      className="icon-button small"
                      aria-label={`Delete ${agent.displayName}`}
                      onClick={() => removeCustomAgent(index)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="acp-agent-card-body">
                    <SettingRow
                      label="Agent ID"
                      help="Unique identifier used to reference this agent."
                      stacked
                    >
                      <input
                        className="text-input small"
                        defaultValue={agent.id}
                        spellCheck={false}
                        onBlur={(e) => updateCustomAgent(index, { id: e.target.value.trim() || agent.id })}
                      />
                    </SettingRow>
                    <SettingRow label="Display name" help="Shown in menus and headers." stacked>
                      <input
                        className="text-input small"
                        defaultValue={agent.displayName}
                        onBlur={(e) => updateCustomAgent(index, { displayName: e.target.value })}
                      />
                    </SettingRow>
                    <SettingRow label="Path" help="Command name or path to the custom agent." stacked>
                      <input
                        className="text-input small"
                        defaultValue={agent.command}
                        placeholder="Command name or path"
                        spellCheck={false}
                        onBlur={(e) => updateCustomAgent(index, { command: e.target.value })}
                      />
                    </SettingRow>
                    <SettingRow label="Arguments" help="Enter one argument per line." stacked>
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
                      label="Environment variables"
                      help="Enter KEY=VALUE pairs, one per line."
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
        <SettingRow label="New custom agent" help="Register any ACP-compatible agent.">
          <button type="button" className="button small primary" onClick={addCustomAgent}>
            <Plus size={14} /> Add custom agent
          </button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Export">
        <SettingRow label="Export folder" help="Folder where chat exports will be saved.">
          <input
            className="text-input small settings-input"
            defaultValue={prefs.acpExportFolder}
            onBlur={(e) => setPreferences({ acpExportFolder: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          label="Filename"
          help="Template for exported filenames. Use {date} for date and {time} for time."
        >
          <input
            className="text-input small settings-input"
            defaultValue={prefs.acpExportFilename}
            onBlur={(e) => setPreferences({ acpExportFilename: e.target.value })}
          />
        </SettingRow>
        <SettingRow
          label="Frontmatter tag"
          help="Tag to add to exported notes. Supports nested tags (e.g., projects/agent-client)."
        >
          <input
            className="text-input small settings-input"
            defaultValue={prefs.acpExportTag}
            onBlur={(e) => setPreferences({ acpExportTag: e.target.value })}
          />
        </SettingRow>
        <SettingRow label="Include images" help="Include images in exported Markdown files.">
          <Switch
            label="Include images"
            checked={prefs.acpExportIncludeImages}
            onChange={(acpExportIncludeImages) => setPreferences({ acpExportIncludeImages })}
          />
        </SettingRow>
        <SettingRow label="Image location" help="Where to save exported images.">
          <Select<'attachments' | 'export-folder' | 'custom'>
            label="Image location"
            value={prefs.acpExportImageLocation}
            options={[
              { value: 'attachments', label: "Use Morrow's attachment setting" },
              { value: 'export-folder', label: 'Export folder' },
              { value: 'custom', label: 'Custom folder' },
            ]}
            onChange={(acpExportImageLocation) => setPreferences({ acpExportImageLocation })}
          />
        </SettingRow>
        {prefs.acpExportImageLocation === 'custom' && (
          <SettingRow label="Custom image folder" stacked>
            <input
              className="text-input small"
              defaultValue={prefs.acpExportImageCustomPath}
              onBlur={(e) => setPreferences({ acpExportImageCustomPath: e.target.value })}
            />
          </SettingRow>
        )}
        <SettingRow label="Include audio" help="Include audio attachments in exported Markdown files.">
          <Switch
            label="Include audio"
            checked={prefs.acpExportIncludeAudio}
            onChange={(acpExportIncludeAudio) => setPreferences({ acpExportIncludeAudio })}
          />
        </SettingRow>
        <SettingRow label="Audio location" help="Where to save exported audio files.">
          <Select<'attachments' | 'export-folder' | 'custom'>
            label="Audio location"
            value={prefs.acpExportAudioLocation}
            options={[
              { value: 'attachments', label: "Use Morrow's attachment setting" },
              { value: 'export-folder', label: 'Export folder' },
              { value: 'custom', label: 'Custom folder' },
            ]}
            onChange={(acpExportAudioLocation) => setPreferences({ acpExportAudioLocation })}
          />
        </SettingRow>
        {prefs.acpExportAudioLocation === 'custom' && (
          <SettingRow label="Custom audio folder" stacked>
            <input
              className="text-input small"
              defaultValue={prefs.acpExportAudioCustomPath}
              onBlur={(e) => setPreferences({ acpExportAudioCustomPath: e.target.value })}
            />
          </SettingRow>
        )}
        <SettingRow
          label="Auto-export on new chat"
          help="Automatically export the current chat when starting a new chat."
        >
          <Switch
            label="Auto-export on new chat"
            checked={prefs.acpAutoExportOnNew}
            onChange={(acpAutoExportOnNew) => setPreferences({ acpAutoExportOnNew })}
          />
        </SettingRow>
        <SettingRow
          label="Auto-export on close chat"
          help="Automatically export the current chat when closing the chat view."
        >
          <Switch
            label="Auto-export on close chat"
            checked={prefs.acpAutoExportOnClose}
            onChange={(acpAutoExportOnClose) => setPreferences({ acpAutoExportOnClose })}
          />
        </SettingRow>
        <SettingRow
          label="Open note after export"
          help="Automatically open the exported note after exporting."
        >
          <Switch
            label="Open note after export"
            checked={prefs.acpOpenAfterExport}
            onChange={(acpOpenAfterExport) => setPreferences({ acpOpenAfterExport })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Developer">
        <SettingRow
          label="Debug mode"
          help="Record raw ACP JSON-RPC messages and agent stderr inside the chat view."
        >
          <Switch
            label="Debug mode"
            checked={prefs.acpDebugMode}
            onChange={(acpDebugMode) => setPreferences({ acpDebugMode })}
          />
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
