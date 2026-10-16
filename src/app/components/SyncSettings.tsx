import { Laptop, Link2, RefreshCw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { desktop } from '../platform/desktop';
import type { SyncStatus } from '../platform/desktop';
import { copyVaultFrom, syncWith } from '../sync';
import { closeDialog, openDialog, toast } from '../ui';
import { Dialog, relativeTime } from './primitives';

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

export function SyncSection() {
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
          ? `Up to date with ${peerName}.`
          : `Received ${result.received} change${result.received === 1 ? '' : 's'} from ${peerName}.`,
      );
    else toast(result.error ?? 'Sync failed.', { tone: 'error', durationMs: 10_000 });
  };

  const copyHere = async (peerId: string) => {
    const dir = await desktop?.vault?.choose();
    if (!dir) return;
    const result = await copyVaultFrom(peerId, dir);
    if (!result.ok) toast(result.error ?? 'The vault could not be copied.', { tone: 'error' });
  };

  return (
    <section className="settings-section">
      <h3>Sync between your computers</h3>
      <p className="muted">
        Keeps this vault the same on your own computers while they are on the same network. Nothing goes
        through a server and every transfer is encrypted. When a page changed on both, both versions are kept.
      </p>
      <label className="setting-row checkbox-row">
        <span className="setting-label">Sync on this network</span>
        <input
          type="checkbox"
          checked={status.enabled}
          onChange={(event) => void desktop?.sync?.enable(event.target.checked).then(refresh)}
        />
      </label>
      <div className="setting-row">
        <span className="setting-label">This computer is called</span>
        <input
          className="text-input small sync-name"
          aria-label="Name of this computer"
          value={name ?? status.name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name !== null && name.trim()) void desktop?.sync?.setName(name).then(refresh);
            setName(null);
          }}
        />
      </div>
      {status.peers.length > 0 && (
        <ul className="sync-peers">
          {status.peers.map((peer) => (
            <li key={peer.id} className="sync-peer">
              <Laptop size={16} />
              <span className="sync-peer-name">
                {peer.name}
                <span className="muted small">
                  {peer.online ? <Wifi size={11} /> : <WifiOff size={11} />}{' '}
                  {peer.online ? 'On this network' : 'Not seen lately'}
                  {peer.lastSync ? ` · synced ${relativeTime(peer.lastSync)}` : ' · never synced'}
                </span>
              </span>
              <button
                type="button"
                className="button small"
                disabled={!peer.reachable || !status.enabled || busy !== null}
                onClick={() => void syncNow(peer.id, peer.name)}
              >
                <RefreshCw size={13} className={busy === peer.id ? 'spin' : ''} /> Sync now
              </button>
              <button
                type="button"
                className="button small"
                disabled={!peer.reachable || !status.enabled}
                title="Copy the vault open on that computer into a new folder here"
                onClick={() => void copyHere(peer.id)}
              >
                Copy its vault here
              </button>
              <button
                type="button"
                className="icon-button small"
                aria-label={`Forget ${peer.name}`}
                onClick={() => void desktop?.sync?.forget(peer.id).then(refresh)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="button small" onClick={() => openDialog({ kind: 'pair' })}>
        <Link2 size={14} /> Pair a computer
      </button>
    </section>
  );
}

export function PairDialog() {
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
      toast(`Paired with ${result.name}. Turn on sync there too, then press Sync now.`);
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
