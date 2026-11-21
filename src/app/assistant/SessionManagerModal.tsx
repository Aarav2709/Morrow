import {
  Download,
  FolderPlus,
  GitFork,
  Layers,
  MessageSquare,
  Plus,
  Radio,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Dialog } from '../components/primitives';
import { useTranslation } from '../i18n';
import { desktop } from '../platform/desktop';
import { setPreferences, usePreferences } from '../platform/preferences';
import { navigate } from '../router';
import { closeDialog, toast } from '../ui';
import {
  broadcastAcpPrompt,
  closeAcpSession,
  createAcpSession,
  exportAcpSession,
  forkAcpSession,
  setActiveFloatingSession,
  setActivePanelSession,
  useAcpStore,
} from './acpStore';
import type { AcpSession } from './acpStore';

function focusSession(session: AcpSession): void {
  if (session.origin === 'floating') {
    setActiveFloatingSession(session.id);
    setPreferences({ acpFloatingEnabled: true });
  } else if (session.origin === 'tab') {
    navigate({ name: 'agent', sessionId: session.id });
  } else {
    setActivePanelSession(session.id);
    setPreferences({ assistant: true, assistantOpen: true, assistantEngine: 'acp' });
  }
  closeDialog();
}

export function SessionManagerModal() {
  const { t, tp } = useTranslation();
  const store = useAcpStore();
  const prefs = usePreferences();
  const [selected, setSelected] = useState<string[]>([]);
  const [broadcastText, setBroadcastText] = useState('');
  const [sending, setSending] = useState(false);

  const toggleSelected = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleBroadcast = async () => {
    const targets = selected.length > 0 ? selected : store.sessions.map((s) => s.id);
    if (targets.length === 0 || !broadcastText.trim()) return;
    setSending(true);
    try {
      const msg = broadcastText;
      setBroadcastText('');
      await broadcastAcpPrompt(targets, msg);
      toast(tp('acp.broadcastSent', targets.length));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog title={t('acp.modalTitle')} size="large" onClose={closeDialog}>
      <div className="acp-sm-toolbar">
        <button
          type="button"
          className="button small primary"
          onClick={() => {
            void createAcpSession({ origin: prefs.acpChatLocation === 'tab' ? 'tab' : 'panel' }).then((s) =>
              focusSession(s),
            );
          }}
        >
          <Plus size={14} /> {t('acp.newChat')}
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            void desktop?.acp?.pickDirectory().then((dir) => {
              if (!dir) return;
              void createAcpSession({
                cwd: dir,
                origin: prefs.acpChatLocation === 'tab' ? 'tab' : 'panel',
              }).then((s) => focusSession(s));
            });
          }}
        >
          <FolderPlus size={14} /> {t('acp.newChatInDir')}
        </button>
      </div>

      <div className="acp-sm-list">
        {store.sessions.length === 0 ? (
          <p className="muted">{t('acp.noSessions')}</p>
        ) : (
          store.sessions.map((session) => (
            <div key={session.id} className={`acp-sm-row status-${session.status}`}>
              <input
                type="checkbox"
                aria-label={t('acp.selectForBroadcast', { title: session.title })}
                checked={selected.includes(session.id)}
                onChange={() => toggleSelected(session.id)}
              />
              <button type="button" className="acp-sm-main" onClick={() => focusSession(session)}>
                <div className="acp-sm-title-row">
                  {session.status === 'waiting-permission' ? (
                    <ShieldAlert size={14} className="acp-icon-warn" />
                  ) : (
                    <MessageSquare size={14} />
                  )}
                  <strong>{session.title}</strong>
                  <span className="acp-sm-badge">{session.agentName}</span>
                  <span className="acp-sm-badge">{session.origin}</span>
                  <span className={`acp-sm-status is-${session.status}`}>
                    {session.status === 'waiting-permission' ? t('acp.waitingPermission') : session.status}
                  </span>
                </div>
                <div className="acp-sm-meta">
                  <span>{session.cwd || t('acp.vaultRoot')}</span>
                  <span>{tp('acp.itemsCount', session.items.length)}</span>
                  <span>{new Date(session.updatedAt).toLocaleTimeString()}</span>
                </div>
              </button>
              <div className="acp-sm-actions">
                <button
                  type="button"
                  className="icon-button small"
                  title={t('acp.forkSession')}
                  aria-label={t('acp.forkSession')}
                  onClick={() => void forkAcpSession(session.id)}
                >
                  <GitFork size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button small"
                  title={t('acp.exportToNote')}
                  aria-label={t('acp.exportToNote')}
                  disabled={session.items.length === 0}
                  onClick={() =>
                    void exportAcpSession(session.id, { open: prefs.acpOpenAfterExport }).then((id) => {
                      if (id) toast(t('acp.exportedNote'));
                    })
                  }
                >
                  <Download size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button small"
                  title={t('acp.closeSession')}
                  aria-label={t('acp.closeSession')}
                  onClick={() => void closeAcpSession(session.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {store.sessions.length > 0 && (
        <form
          className="acp-broadcast-bar"
          onSubmit={(e) => {
            e.preventDefault();
            void handleBroadcast();
          }}
        >
          <div className="acp-broadcast-head">
            <Radio size={14} />
            <span>
              {selected.length > 0
                ? t('acp.broadcastSelected', { count: selected.length })
                : t('acp.broadcastAll', { count: store.sessions.length })}
            </span>
          </div>
          <div className="acp-broadcast-controls">
            <input
              className="text-input small"
              placeholder={t('acp.broadcastPlaceholder')}
              value={broadcastText}
              onChange={(e) => setBroadcastText(e.target.value)}
            />
            <button
              type="submit"
              className="button small primary"
              disabled={sending || !broadcastText.trim()}
            >
              <Layers size={14} /> {t('acp.broadcastButton')}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
