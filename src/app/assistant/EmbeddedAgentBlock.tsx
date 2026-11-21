import { Bot, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../i18n';
import { setPreferences } from '../platform/preferences';
import { openDialog } from '../ui';
import { AgentClientView } from './AgentClientView';
import { createAcpSession, ensureEmbeddedSession, sendAcpPrompt, setActivePanelSession } from './acpStore';

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
  const cfg = useMemo(() => parseAgentBlockConfig(source), [source]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const embeddedKey = cfg.session || 'default-note-chat';
  const persistHistory = cfg.persist !== 'false';

  useEffect(() => {
    let live = true;
    void ensureEmbeddedSession({
      embeddedKey,
      agentId: cfg.agent || undefined,
      cwd: cfg.cwd || undefined,
      persistHistory,
    }).then((s) => {
      if (live) setSessionId(s.id);
    });
    return () => {
      live = false;
    };
  }, [embeddedKey, cfg.agent, cfg.cwd, persistHistory]);

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

  const trigger = async () => {
    if (!prompt) return;
    const session = await createAcpSession({
      agentId: cfg.agent || undefined,
      cwd: cfg.cwd || undefined,
      origin: 'panel',
      title: label,
    });
    setActivePanelSession(session.id);
    setPreferences({ assistant: true, assistantOpen: true, assistantEngine: 'acp' });
    await sendAcpPrompt(session.id, prompt);
  };

  return (
    <div className="acp-embedded-button-wrap">
      <button
        type="button"
        className="button small primary acp-embedded-button"
        disabled={!prompt}
        onClick={() => void trigger()}
      >
        <Play size={13} /> {label}
      </button>
      {prompt && <span className="acp-embedded-prompt-preview">{prompt}</span>}
    </div>
  );
}
