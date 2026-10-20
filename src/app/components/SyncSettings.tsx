import { Check, Cloud, Laptop, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { commitEditors } from '../editor/commits';
import { useTranslation } from '../i18n';
import { desktop } from '../platform/desktop';
import type { CloudFolder, SyncStatus } from '../platform/desktop';
import { copyVaultFrom, syncWith } from '../sync';
import { switchVault } from '../vaults';
import { getSession } from '../workspace';
import { closeDialog, confirmAction, openDialog, toast } from '../ui';
import { Dialog, relativeTime, Switch } from './primitives';
import { SettingRow, SettingsGroup } from './SettingsRows';

function useSyncStatus(poll = 3000): [SyncStatus | null, () => void] {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const refresh = useCallback(() => {
    void desktop?.sync
      ?.status()
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, poll);
    const stop = desktop?.sync?.onEvent(() => refresh());
    return () => {
      clearInterval(timer);
      stop?.();
    };
  }, [refresh, poll]);
  return [status, refresh];
}

// keeps this vault the same on your own computers on the same network, with no server in between
export function NetworkSettings() {
  const { t } = useTranslation();
  const [status, refresh] = useSyncStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  if (!desktop?.sync || !status) return null;

  const syncNow = async (peerId: string, peerName: string) => {
    setBusy(peerId);
    const result = await syncWith(peerId);
    setBusy(null);
    refresh();
    if (result.ok)
      toast(
        result.received === 0
          ? t('settings.sync.upToDate', { name: peerName })
          : t('settings.sync.receivedChanges', { count: result.received, name: peerName }),
      );
    else toast(result.error ?? t('settings.sync.syncFailed'), { tone: 'error', durationMs: 10_000 });
  };

  const copyHere = async (peerId: string) => {
    const dir = await desktop?.vault?.choose();
    if (!dir) return;
    const result = await copyVaultFrom(peerId, dir);
    if (!result.ok) toast(result.error ?? t('settings.sync.vaultCopyFailed'), { tone: 'error' });
  };

  return (
    <SettingsGroup
      title={t('settings.sync.networkTitle')}
      help={t('settings.sync.networkHelp')}
    >
      <SettingRow
        label={t('settings.sync.networkSync')}
        help={t('settings.sync.networkSyncHelp')}
      >
        <Switch
          label={t('settings.sync.networkSync')}
          checked={status.enabled}
          onChange={(enabled) => void desktop?.sync?.enable(enabled).then(refresh)}
        />
      </SettingRow>
      <SettingRow label={t('settings.sync.computerName')}>
        <input
          className="text-input small settings-input"
          aria-label={t('settings.sync.computerNameAria')}
          value={name ?? status.name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name !== null && name.trim()) void desktop?.sync?.setName(name).then(refresh);
            setName(null);
          }}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
      </SettingRow>
      {status.peers.map((peer) => (
        <SettingRow
          key={peer.id}
          label={
            <span className="settings-peer">
              <Laptop size={14} /> {peer.name}
            </span>
          }
          help={`${peer.online ? t('settings.sync.onNetwork') : t('settings.sync.notSeenLately')}, ${
            peer.lastSync ? t('settings.sync.synced', { time: relativeTime(peer.lastSync) }) : t('settings.sync.neverSynced')
          }`}
        >
          <button
            type="button"
            className="button small"
            disabled={!peer.reachable || !status.enabled || busy !== null}
            onClick={() => void syncNow(peer.id, peer.name)}
          >
            <RefreshCw size={13} className={busy === peer.id ? 'spin' : ''} /> {t('settings.sync.syncNow')}
          </button>
          <button
            type="button"
            className="button small"
            disabled={!peer.reachable || !status.enabled}
            title={t('settings.sync.copyVaultTitle')}
            onClick={() => void copyHere(peer.id)}
          >
            {t('settings.sync.copyVault')}
          </button>
          <button
            type="button"
            className="icon-button small"
            aria-label={t('settings.sync.forgetComputer', { name: peer.name })}
            title={t('settings.sync.forgetTitle')}
            onClick={() => void desktop?.sync?.forget(peer.id).then(refresh)}
          >
            <Trash2 size={14} />
          </button>
        </SettingRow>
      ))}
      <SettingRow label={t('settings.sync.addComputer')} help={t('settings.sync.addComputerHelp')}>
        <button type="button" className="button small" onClick={() => openDialog({ kind: 'pair' })}>
          <Link2 size={13} /> {t('settings.sync.pairButton')}
        </button>
      </SettingRow>
    </SettingsGroup>
  );
}

// a vault is a plain folder, so dropbox, icloud, google drive, onedrive or syncthing can carry it between
// computers. morrow only finds their folders and copies the vault in, their own apps do the syncing
export function CloudSettings() {
  const { t } = useTranslation();
  const [cloud, setCloud] = useState<{ folders: CloudFolder[]; inside: CloudFolder | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void desktop?.vault
      ?.cloud()
      .then(setCloud)
      .catch(() => undefined);
  }, []);
  if (!desktop?.vault || !cloud) return null;

  const copyInto = (dir: string | null | undefined, where?: string) => {
    if (!dir) return;
    const dest = where ?? t('settings.sync.thatFolder');
    confirmAction({
      title: t('settings.sync.moveConfirmTitle', { where: dest }),
      body: t('settings.sync.moveConfirmBody', { dir }),
      confirmLabel: t('settings.sync.copyAndOpenButton'),
      onConfirm: () => void copyAndOpen(dir),
    });
  };
  const copyAndOpen = async (dir: string) => {
    setBusy(true);
    try {
      commitEditors();
      await getSession().flush();
      const result = await desktop!.vault!.copyInto(dir);
      if (result.ok && result.path) await switchVault(result.path);
      else toast(result.error ?? t('settings.sync.vaultCopyFailed'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup
      title={t('settings.sync.cloudTitle')}
      help={t('settings.sync.cloudHelp')}
    >
      {cloud.inside ? (
        <SettingRow
          label={
            <span className="settings-peer">
              <Check size={14} className="settings-ok" /> {t('settings.sync.syncingThrough', { provider: cloud.inside.provider })}
            </span>
          }
          help={t('settings.sync.openSameFolder')}
        />
      ) : (
        cloud.folders.map((folder) => (
          <SettingRow
            key={folder.path}
            label={
              <span className="settings-peer">
                <Cloud size={14} /> {folder.provider}
              </span>
            }
            help={<span className="settings-path">{folder.path}</span>}
          >
            <button
              type="button"
              className="button small"
              disabled={busy}
              onClick={() => copyInto(folder.path, folder.provider)}
            >
              {t('settings.sync.moveVaultHere')}
            </button>
          </SettingRow>
        ))
      )}
      {!cloud.inside && (
        <SettingRow
          label={cloud.folders.length ? t('settings.sync.anotherFolder') : t('settings.sync.syncedFolder')}
          help={
            cloud.folders.length
              ? t('settings.sync.anotherFolderHelp')
              : t('settings.sync.syncedFolderHelp')
          }
        >
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={() => void desktop?.vault?.choose().then((dir) => copyInto(dir))}
          >
            {t('settings.sync.chooseFolder')}
          </button>
        </SettingRow>
      )}
    </SettingsGroup>
  );
}

export function PairDialog() {
  const { t } = useTranslation();
  const [status] = useSyncStatus(1500);
  const [code, setCode] = useState<string | null>(null);
  const [entered, setEntered] = useState('');
  const [target, setTarget] = useState<{ id?: string; address: string; port?: number } | null>(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void desktop?.sync?.startPairing().then(setCode);
    return () => void desktop?.sync?.stopPairing();
  }, []);

  useEffect(() => {
    const stop = desktop?.sync?.onEvent((event) => {
      if (event.type === 'paired') closeDialog();
    });
    return () => stop?.();
  }, []);

  const pair = async () => {
    const chosen = target ?? (address.trim() ? { address: address.trim() } : null);
    if (!chosen || !entered.trim()) return;
    setBusy(true);
    setError(null);
    const result = await desktop?.sync?.pair(chosen, entered);
    setBusy(false);
    if (result?.ok) {
      toast(t('toasts.pairedWithTurnSync', { name: result.name ?? '' }));
      closeDialog();
    } else setError(result?.error ?? 'Pairing failed.');
  };

  return (
    <Dialog title="Pair a computer" onClose={closeDialog}>
      <div className="pair-columns">
        <section>
          <h4>On the other computer, enter this code</h4>
          <p className="pair-code" aria-label="Pairing code">
            {code ?? '…'}
          </p>
          <p className="muted small">
            Open Settings there, choose Pair a computer, pick this one and type the code. It works for ten
            minutes.
          </p>
        </section>
        <section>
          <h4>Or pair with a computer showing a code</h4>
          {status && status.waiting.length > 0 ? (
            <ul className="pair-waiting">
              {status.waiting.map((item) => (
                <li key={item.id}>
                  <label className="checkbox-row">
                    <input
                      type="radio"
                      name="pair-target"
                      checked={target?.id === item.id}
                      onChange={() => setTarget({ id: item.id, address: item.address, port: item.port })}
                    />
                    {item.name}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              Looking for computers showing a code… If yours does not appear, type its address.
            </p>
          )}
          {!target && (
            <input
              className="text-input small"
              placeholder="Address, like 192.168.1.20"
              aria-label="Address of the other computer"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
          )}
          <input
            className="text-input"
            placeholder="XXXX-XXXX-XXXX-XXXX"
            aria-label="Code shown on the other computer"
            value={entered}
            onChange={(event) => setEntered(event.target.value.toUpperCase())}
            onKeyDown={(event) => event.key === 'Enter' && void pair()}
          />
          {error && <p className="field-error">{error}</p>}
          <button
            type="button"
            className="button primary"
            disabled={busy || !entered.trim() || (!target && !address.trim())}
            onClick={() => void pair()}
          >
            {busy ? 'Pairing…' : 'Pair'}
          </button>
        </section>
      </div>
    </Dialog>
  );
}
