import { Bot, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../i18n';
import { desktop } from '../platform/desktop';
import { setPreferences, usePreferences } from '../platform/preferences';
import { openDialog } from '../ui';
import { AgentClientView } from './AgentClientView';
import { createAcpSession, ensureEmbeddedSession, sendAcpPrompt, setActivePanelSession } from './acpStore';

// the folder an agent block in a note may run in: one inside the vault, the vault itself otherwise. a note
// can come from anywhere, through sync or an import, so it never sends an agent elsewhere on the computer
export function vaultFolder(raw: string | undefined, vault: string | null): string | undefined {
  if (!vault) return undefined;
  const clean = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
  const root = clean(vault);
  if (!raw?.trim()) return vault;
  const wanted = clean(raw.trim());
  const absolute = /^([a-z]:)?\//i.test(wanted) ? wanted : `${root}/${wanted}`;
  // .. could climb out of the vault, so a path with it is not taken
  if (absolute.split('/').includes('..')) return vault;
  const inside =
    absolute.toLowerCase() === root.toLowerCase() ||
    absolute.toLowerCase().startsWith(`${root.toLowerCase()}/`);
  return inside ? absolute : vault;
}

async function blockFolder(raw: string | undefined): Promise<string | undefined> {
  const settings = await desktop?.acp?.settings().catch(() => null);
  return vaultFolder(raw, settings?.currentVaultPath ?? null);
}

export function parseAgentBlockConfig(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of source.split('\n')) {
    const idx = rawLine.indexOf(':');
    if (idx === -1) continue;
    const key = rawLine.slice(0, idx).trim().toLowerCase();
    const val = rawLine.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

export function EmbeddedAgentChat({ source }: { source: string }) {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const cfg = useMemo(() => parseAgentBlockConfig(source), [source]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // a note opened never starts an agent by itself, it waits to be asked
  const [started, setStarted] = useState(false);
  const embeddedKey = cfg.session || 'default-note-chat';
  const persistHistory = cfg.persist !== 'false';

  useEffect(() => {
    if (!started) return;
    let live = true;
    void blockFolder(cfg.cwd)
      .then((cwd) =>
        ensureEmbeddedSession({
          embeddedKey,
          agentId: cfg.agent || undefined,
          cwd,
          persistHistory,
        }),
      )
      .then((s) => {
        if (live) setSessionId(s.id);
      });
    return () => {
      live = false;
    };
  }, [started, embeddedKey, cfg.agent, cfg.cwd, persistHistory]);

  if (!started)
    return (
      <div className="acp-embedded-button-wrap">
        <button
          type="button"
          className="button small acp-embedded-button"
          disabled={!prefs.assistant}
          onClick={() => setStarted(true)}
        >
          <Bot size={13} /> {t('acp.startEmbedded')}
        </button>
        {!prefs.assistant && <span className="acp-embedded-prompt-preview">{t('acp.needsAssistant')}</span>}
      </div>
    );

  return (
    <div className="acp-embedded-chat">
      {sessionId ? (
        <AgentClientView
          sessionId={sessionId}
          origin="embedded"
          compact
          onOpenSessionManager={() => openDialog({ kind: 'sessionManager' })}
          onOpenSettings={() => openDialog({ kind: 'settings', section: 'assistant' })}
        />
      ) : (
        <div className="acp-embedded-loading">
          <Bot size={14} /> {t('acp.loadingSession')}
        </div>
      )}
    </div>
  );
}

export function EmbeddedAgentButton({ source }: { source: string }) {
  const { t } = useTranslation();
  const cfg = useMemo(() => parseAgentBlockConfig(source), [source]);
  const label = cfg.label || t('acp.runAgentPrompt');
  const prompt = cfg.prompt || '';

  const prefs = usePreferences();
  // a button in a note only runs while the assistant is turned on, it never turns it on by itself
  const trigger = async () => {
    if (!prompt || !prefs.assistant) return;
    const session = await createAcpSession({
      agentId: cfg.agent || undefined,
      cwd: await blockFolder(cfg.cwd),
      origin: 'panel',
      title: label,
    });
    setActivePanelSession(session.id);
    setPreferences({ assistantOpen: true, assistantEngine: 'acp' });
    await sendAcpPrompt(session.id, prompt);
  };

  return (
    <div className="acp-embedded-button-wrap">
      <button
        type="button"
        className="button small primary acp-embedded-button"
        disabled={!prompt || !prefs.assistant}
        title={prefs.assistant ? undefined : t('acp.needsAssistant')}
        onClick={() => void trigger()}
      >
        <Play size={13} /> {label}
      </button>
      {prompt && <span className="acp-embedded-prompt-preview">{prompt}</span>}
    </div>
  );
}
