import { lazy, Suspense, useEffect } from 'react';
import { ACTIONS, matchesShortcut, runAction } from './actions';
import { CommandPalette } from './components/CommandPalette';
import { Dialogs } from './components/Dialogs';
import { ReviewView } from './components/ReviewView';
import { TagsView, TagView } from './components/TagsView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageView } from './components/PageView';
import { Toasts } from './components/primitives';
import { TabBar } from './components/TabBar';
import { Sidebar } from './components/Sidebar';
import { HomeView } from './components/Home';
import { TasksView, TrashView } from './components/Views';
import { commitEditors, undoRedo } from './editor/commits';
import { writeAutoBackup } from './operations';
import { startAutoSync, syncWith } from './sync';
import { desktop } from './platform/desktop';
import { resolvedTheme, usePreferences } from './platform/preferences';
import { useRoute } from './router';
import { getUi, setUi, toast, useUi } from './ui';
import { loadCustomCss } from './customCss';
import { startTabs } from './tabs';
import { getSession } from './workspace';

const AUTO_BACKUP_MS = 10 * 60 * 1000;

// the graph pulls in a physics library, it is only loaded when opened
const GraphView = lazy(() =>
  import('./components/GraphView').then((module) => ({ default: module.GraphView })),
);

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
      if (event.key === 'Escape' && ui.focusMode && !ui.palette) {
        setUi({ focusMode: false });
        return;
      }
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

    void loadCustomCss();
    const stopSync = startAutoSync();
    // a vault just copied from another computer fills up straight away
    const copyFrom = sessionStorage.getItem('morrow.syncAfterOpen');
    if (copyFrom) {
      sessionStorage.removeItem('morrow.syncAfterOpen');
      void syncWith(copyFrom).then((result) =>
        toast(
          result.ok
            ? `Copied ${result.received} files from your other computer.`
            : `Copying failed: ${result.error}`,
          {
            tone: result.ok ? 'info' : 'error',
            durationMs: 10_000,
          },
        ),
      );
    }
    const first = desktop ? setTimeout(() => void writeAutoBackup(), 30_000) : null;
    const timer = desktop ? setInterval(() => void writeAutoBackup(), AUTO_BACKUP_MS) : null;
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe?.();
      stopSync();
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
  useEffect(() => {
    document.documentElement.dataset.accent = prefs.accent;
    document.documentElement.dataset.colorful = prefs.colorful ? 'true' : 'false';
  }, [prefs.accent, prefs.colorful]);
  useGlobalShortcuts();
  useEffect(() => startTabs(), []);
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
    case 'tags':
      view = <TagsView />;
      break;
    case 'tag':
      view = <TagView tag={route.tag} />;
      break;
    case 'review':
      view = <ReviewView />;
      break;
    case 'graph':
      view = <GraphView key={route.focus ?? 'all'} focus={route.focus} />;
      break;
    default:
      view = <HomeView />;
  }

  return (
    <div
      className={`app${prefs.sidebarOpen ? '' : ' sidebar-collapsed'}${ui.mobileSidebar ? ' mobile-sidebar-open' : ''}${ui.focusMode ? ' focus-mode' : ''}`}
    >
      <Sidebar />
      <div className="scrim" aria-hidden="true" onClick={() => setUi({ mobileSidebar: false })} />
      <main className="main">
        <TabBar />
        <ErrorBoundary resetKey={window.location.hash}>
          <Suspense fallback={<div className="view" aria-busy="true" />}>{view}</Suspense>
        </ErrorBoundary>
      </main>
      {ui.palette && <CommandPalette />}
      <Dialogs />
      <Toasts />
    </div>
  );
}
