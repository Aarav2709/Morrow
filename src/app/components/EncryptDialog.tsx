import { Lock } from 'lucide-react';
import { useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageId, PageMeta } from '../../core/model';
import { useTranslation } from '../i18n';
import { closeDialog, toast } from '../ui';
import { getSession, useWorkspace } from '../workspace';
import { Dialog } from './primitives';

const MIN_LENGTH = 8;

export function EncryptDialog({ pageId }: { pageId: PageId }) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const page = state.pages[pageId];
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  if (!page) return null;
  const tooShort = password.length < MIN_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== password;
  const submit = async () => {
    if (tooShort || password !== repeat || busy) return;
    setBusy(true);
    const result = await getSession().protectPage(pageId, password);
    setBusy(false);
    if (!result.ok) {
      toast(result.error, { tone: 'error' });
      return;
    }
    closeDialog();
    toast(t('toasts.pageEncrypted', { title: displayTitle(page) }));
  };
  return (
    <Dialog
      title={`Encrypt “${displayTitle(page)}”`}
      size="small"
      onClose={closeDialog}
      footer={
        <>
          <button type="button" className="button" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={tooShort || password !== repeat || busy}
            onClick={() => void submit()}
          >
            <Lock size={14} /> {busy ? 'Encrypting…' : 'Encrypt'}
          </button>
        </>
      }
    >
      <form
        className="encrypt-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="muted small">
          The page's file is encrypted with AES-256. Morrow keeps no copy of the password and no plain version
          in page history. <strong>If you forget the password, the page cannot be recovered.</strong>
        </p>
        <label className="field">
          <span>Password</span>
          <input
            className="text-input"
            type="password"
            data-autofocus
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Repeat it</span>
          <input
            className="text-input"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </label>
        {password.length > 0 && tooShort && (
          <p className="field-error">Use at least {MIN_LENGTH} characters.</p>
        )}
        {mismatch && <p className="field-error">The two passwords are different.</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// a locked encrypted page asks for its password
export function LockedPage({ page }: { page: PageMeta }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    const result = await getSession().unlockPage(page.id, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setPassword('');
    }
  };
  return (
    <form
      className="locked-page"
      onSubmit={(event) => {
        event.preventDefault();
        void unlock();
      }}
    >
      <Lock size={28} strokeWidth={1.5} />
      <p>This page is encrypted. Enter its password to open it.</p>
      <div className="locked-row">
        <input
          className="text-input"
          type="password"
          aria-label="Password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="button primary" disabled={!password || busy}>
          {busy ? 'Opening…' : 'Unlock'}
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}
