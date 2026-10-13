import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource-variable/source-serif-4/index.css';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import '@fontsource-variable/jetbrains-mono/index.css';
import './app/styles/tokens.css';
import './app/styles/app.css';
import './app/styles/editor.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sampleCommands } from './core/sample';
import { WorkspaceSession } from './storage/session';
import { App } from './app/App';
import { Logo } from './app/components/primitives';
import { commitEditors } from './app/editor/commits';
import { desktop } from './app/platform/desktop';
import { newId } from './app/platform/files';
import { resolvedTheme, getPreferences } from './app/platform/preferences';
import { onTakeoverRequest, takeOverLock, tryAcquireLock } from './app/platform/tabLock';
import { toast } from './app/ui';
import { setSession } from './app/workspace';

type BootState =
  | { kind: 'loading' }
  | { kind: 'busy' }
  | { kind: 'released' }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

// the theme is applied before react renders so there is no flash
document.documentElement.dataset.theme = resolvedTheme(getPreferences().theme);
// the desktop window has no title bar, styles use this to make room for the native buttons
if (desktop) document.documentElement.dataset.desktop = desktop.platform;

async function openWorkspace(): Promise<BootState> {
  const opened = await WorkspaceSession.open();
  if (!opened.ok) return { kind: 'error', message: opened.error };
  const session = opened.value;
  if (session.firstRun) {
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
            Your data has not been changed. Private browsing modes can block local storage.
          </p>
          <button type="button" className="button primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
