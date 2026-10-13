import { useEffect } from 'react';
import { ACTIONS, matchesShortcut, runAction } from './actions';
import { CommandPalette } from './components/CommandPalette';
import { Dialogs } from './components/Dialogs';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageView } from './components/PageView';
import { Toasts } from './components/primitives';
import { Sidebar } from './components/Sidebar';
import { HomeView, TasksView, TrashView } from './components/Views';
import { commitEditors, undoRedo } from './editor/commits';
import { writeAutoBackup } from './operations';
import { desktop } from './platform/desktop';
import { resolvedTheme, usePreferences } from './platform/preferences';
import { useRoute } from './router';
import { getUi, setUi, useUi } from './ui';
import { getSession } from './workspace';

const AUTO_BACKUP_MS = 10 * 60 * 1000;

function useTheme(theme: 'system' | 'light' | 'dark') {
  useEffect(() => {
    const apply = () => {
      const resolved = resolvedTheme(theme);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      desktop?.setTheme(resolved);
    };
    apply();
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const ui = getUi();
      if (ui.dialog) return;
      if (matchesShortcut(event, 'Mod+P')) {
        event.preventDefault();
        setUi({ palette: !ui.palette });
        return;
      }
      for (const action of ACTIONS) {
        if (action.shortcut && matchesShortcut(event, action.shortcut)) {
          event.preventDefault();
          if (ui.palette && action.id !== 'search') setUi({ palette: false });
          runAction(action.id);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

// pending edits are written before the window goes away
function useLifecycle() {
  useEffect(() => {
    const session = getSession();
    const flush = () => {
      commitEditors();
      void session.flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      commitEditors();
      if (desktop || !session.queue.hasPending()) return;
      void session.flush();
      event.preventDefault();
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);

    const unsubscribe = desktop?.onCommand(async (id) => {
      if (id === 'app.prepareToClose') {
        commitEditors();
        await session.flush();
        await writeAutoBackup();
        return;
      }
      if (id === 'edit.undo' || id === 'edit.redo') {
        undoRedo(id === 'edit.undo' ? 'undo' : 'redo');
        return;
      }
      runAction(id);
    });

    const first = desktop ? setTimeout(() => void writeAutoBackup(), 30_000) : null;
    const timer = desktop ? setInterval(() => void writeAutoBackup(), AUTO_BACKUP_MS) : null;
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe?.();
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
    };
  }, []);
}

export function App() {
  const route = useRoute();
  const ui = useUi();
  const prefs = usePreferences();
  useTheme(prefs.theme);
  useGlobalShortcuts();
  useLifecycle();

  useEffect(() => {
    setUi({ mobileSidebar: false });
  }, [route]);

  let view;
  switch (route.name) {
    case 'page':
      view = <PageView key={route.id} id={route.id} find={route.find} />;
      break;
    case 'tasks':
      view = <TasksView />;
      break;
    case 'trash':
      view = <TrashView />;
      break;
    default:
      view = <HomeView />;
  }

  return (
    <div
      className={`app${prefs.sidebarOpen ? '' : ' sidebar-collapsed'}${ui.mobileSidebar ? ' mobile-sidebar-open' : ''}`}
    >
      <Sidebar />
      <div className="scrim" aria-hidden="true" onClick={() => setUi({ mobileSidebar: false })} />
      <main className="main">
        <ErrorBoundary resetKey={window.location.hash}>{view}</ErrorBoundary>
      </main>
      {ui.palette && <CommandPalette />}
      <Dialogs />
      <Toasts />
    </div>
  );
}
