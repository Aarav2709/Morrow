import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource-variable/source-serif-4/index.css';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './app/styles/tokens.css';
import './app/styles/app.css';
import './app/styles/editor.css';
import './app/styles/features.css';
import 'katex/dist/katex.min.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sampleCommands } from './core/sample';
import type { WorkspaceRepository } from './storage/repository';
import { WorkspaceSession } from './storage/session';
import { VaultRepository } from './storage/vaultRepository';
import { App } from './app/App';
import { Logo } from './app/components/primitives';
import { VaultChooser } from './app/components/VaultChooser';
import { commitEditors } from './app/editor/commits';
import { COPY_LEGACY_KEY, copyLegacyInto, legacyPageCount } from './app/legacy';
import { desktop } from './app/platform/desktop';
import { newId } from './app/platform/files';
import { desktopVaultBridge } from './app/platform/vault';
import { resolvedTheme, getPreferences } from './app/platform/preferences';
import { onTakeoverRequest, takeOverLock, tryAcquireLock } from './app/platform/tabLock';
import { toast } from './app/ui';
import { setSession } from './app/workspace';

type BootState =
  | { kind: 'loading' }
  | { kind: 'busy' }
  | { kind: 'released' }
  | { kind: 'error'; message: string }
  | { kind: 'choose'; legacy: number }
  | { kind: 'ready' };


// the theme is applied before react renders so there is no flash
document.documentElement.dataset.theme = resolvedTheme(getPreferences().theme);
// the desktop window has no title bar, styles use this to make room for the native buttons
if (desktop) document.documentElement.dataset.desktop = desktop.platform;

async function openWorkspace(): Promise<BootState> {
  // the desktop app keeps pages as files in a folder the person chooses, the browser keeps them in the browser
  let repository: WorkspaceRepository | undefined;
  if (desktop?.vault) {
    const vault = await desktop.vault.open();
    if (!vault.ok || !vault.root) return { kind: 'choose', legacy: await legacyPageCount().catch(() => 0) };
    repository = new VaultRepository(desktopVaultBridge(desktop.vault, vault.root), newId);
  }
  const opened = await WorkspaceSession.open(repository);
  if (!opened.ok) return { kind: 'error', message: opened.error };
  const session = opened.value;
  session.beforeExternal = commitEditors;
  const copyLegacy = desktop?.vault && sessionStorage.getItem(COPY_LEGACY_KEY) === '1';
  sessionStorage.removeItem(COPY_LEGACY_KEY);
  if (copyLegacy) {
    const copied = await copyLegacyInto(session);
    if (copied.ok && copied.value > 0)
      toast(`Copied ${copied.value} page${copied.value === 1 ? '' : 's'} from Morrow 1.0 into this folder. The original copy was left as it was.`, { durationMs: 12_000 });
    else if (!copied.ok) toast(`Your earlier pages could not be copied: ${copied.error}`, { tone: 'error', durationMs: 12_000 });
  } else if (session.firstRun) {
    const seeded = session.executeAll(sampleCommands(newId, Date.now()));
    if (seeded.ok) await session.flush();
  }
  await session.markInitialized();
  setSession(session);
  if (session.problems.length > 0) {
    console.warn('Morrow could not read some stored records:', session.problems);
    toast(
      `${session.problems.length} item${session.problems.length === 1 ? '' : 's'} could not be read and ${session.problems.length === 1 ? 'was' : 'were'} left untouched.`,
      {
        tone: 'error',
        durationMs: 12_000,
      },
    );
  }
  onTakeoverRequest(async () => {
    commitEditors();
    await session.close();
    window.dispatchEvent(new Event('morrow:released'));
  });
  return { kind: 'ready' };
}

const fail = (error: unknown): BootState => ({ kind: 'error', message: String(error) });

// booting runs once even when strict mode mounts twice
let booting: Promise<BootState> | null = null;
function bootOnce(): Promise<BootState> {
  booting ??= (async () =>
    (await tryAcquireLock()) ? openWorkspace().catch(fail) : { kind: 'busy' as const })();
  return booting;
}

function Boot() {
  const [state, setState] = useState<BootState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void bootOnce().then((next) => !cancelled && setState(next));
    const onReleased = () => setState({ kind: 'released' });
    window.addEventListener('morrow:released', onReleased);
    return () => {
      cancelled = true;
      window.removeEventListener('morrow:released', onReleased);
    };
  }, []);

  const takeOver = async () => {
    setState({ kind: 'loading' });
    await takeOverLock();
    setState(await openWorkspace().catch(fail));
  };

  if (state.kind === 'ready') return <App />;
  if (state.kind === 'choose') return <VaultChooser legacy={state.legacy} />;
  return (
    <div className="boot">
      <Logo size={36} />
      {state.kind === 'loading' && <p className="boot-text">Opening your workspace</p>}
      {(state.kind === 'busy' || state.kind === 'released') && (
        <>
          <h1>Morrow is open in another window</h1>
          <p className="boot-text">To keep your pages safe, only one window can edit them at a time.</p>
          <button type="button" className="button primary" onClick={() => void takeOver()}>
            Use Morrow here
          </button>
        </>
      )}
      {state.kind === 'error' && (
        <>
          <h1>Morrow could not open your workspace</h1>
          <p className="boot-text">{state.message}</p>
          <p className="boot-text muted">
            {desktop?.vault
              ? 'Nothing in the folder has been changed.'
              : 'Your data has not been changed. Private browsing modes can block local storage.'}
          </p>
          <div className="button-row">
            <button type="button" className="button primary" onClick={() => window.location.reload()}>
              Try again
            </button>
            {desktop?.vault && (
              <button
                type="button"
                className="button"
                onClick={() => setState({ kind: 'choose', legacy: 0 })}
              >
                Open another folder
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// the browser version can be installed and used offline, the desktop app does not need this
if (!desktop && import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
