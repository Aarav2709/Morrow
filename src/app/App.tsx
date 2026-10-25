import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from './i18n';
import { ACTIONS, matchesShortcut, runAction } from './actions';
import { CommandPalette } from './components/CommandPalette';
import { Dialogs } from './components/Dialogs';
import { ReviewView } from './components/ReviewView';
import { TagsView, TagView } from './components/TagsView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageView } from './components/PageView';
import { Toasts } from './components/primitives';
import { TabBar } from './components/TabBar';
import { SearchView } from './components/SearchView';
import { Sidebar } from './components/Sidebar';
import { HomeView } from './components/Home';
import { TasksView, TrashView } from './components/Views';
import { commitEditors, undoRedo } from './editor/commits';
import { ensureToday, writeAutoBackup } from './operations';
import { startAutoSync, syncWith } from './sync';
import { startUpdateChecks } from './updates';
import { desktop, isMac, watchTitleBar } from './platform/desktop';
import { getPreferences, resolvedTheme, setPreferences, usePreferences } from './platform/preferences';
import { navigate, parseRoute, routeHash, useRoute } from './router';
import type { Route } from './router';
import { getUi, setUi, toast, useUi } from './ui';
import { loadCustomCss } from './customCss';
import {
  activateTabAt,
  claimNavigation,
  goBack,
  PaneContext,
  setActivePane,
  startTabs,
  useTabs,
} from './tabs';
import type { PaneId } from './tabs';
import { getSession } from './workspace';

const AUTO_BACKUP_MS = 10 * 60 * 1000;

// the assistant is only loaded for people who turned it on
const AssistantPanel = lazy(() =>
  import('./assistant/AssistantPanel').then((module) => ({ default: module.AssistantPanel })),
);

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
    watchTitleBar();
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
      // ctrl or cmd and a number picks a tab, nine is always the last one
      const digit = /^Digit([1-9])$/.exec(event.code);
      if (digit && (isMac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        activateTabAt(Number(digit[1]));
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
      if ((id === 'go.back' || id === 'go.forward') && !claimNavigation()) return;
      if (id === 'edit.undo' || id === 'edit.redo') {
        undoRedo(id === 'edit.undo' ? 'undo' : 'redo');
        return;
      }
      runAction(id);
    });

    void loadCustomCss();
    const stopSync = startAutoSync();
    const stopUpdates = startUpdateChecks();
    // a vault just copied from another computer fills up straight away
    const copyFrom = sessionStorage.getItem('morrow.syncAfterOpen');
    if (copyFrom) {
      sessionStorage.removeItem('morrow.syncAfterOpen');
      void syncWith(copyFrom).then((result) =>
        toast(
          result.ok
            ? result.received === 1
              ? t('toasts.syncCopiedFilesSingle')
              : t('toasts.syncCopiedFilesPlural', { count: result.received })
            : t('toasts.syncCopyFailed', { error: result.error ?? '' }),
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
      stopUpdates();
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
    };
  }, []);
}

function viewFor(route: Route) {
  switch (route.name) {
    case 'page':
      return <PageView key={route.id} id={route.id} find={route.find} anchor={route.anchor ?? null} />;
    case 'tasks':
      return <TasksView />;
    case 'trash':
      return <TrashView />;
    case 'tags':
      return <TagsView />;
    case 'tag':
      return <TagView tag={route.tag} />;
    case 'review':
      return <ReviewView />;
    case 'graph':
      return <GraphView key={route.focus ?? 'all'} focus={route.focus} />;
    case 'search':
      return <SearchView query={route.query} />;
    default:
      return <HomeView />;
  }
}

// how much room a side has, so its bars and page fit it whether it fills the window or half of it
type PaneSize = 'narrow' | 'medium' | 'wide';
function usePaneSize(ref: React.RefObject<HTMLElement | null>): PaneSize {
  const [size, setSize] = useState<PaneSize>('wide');
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (width: number) => setSize(width < 620 ? 'narrow' : width < 900 ? 'medium' : 'wide');
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => entry && measure(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// one side of the window's content, a split tab shows two of these
function Pane({
  pane,
  route,
  active,
  style,
}: {
  pane: PaneId;
  route: Route;
  active: boolean;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  const size = usePaneSize(ref);
  return (
    <PaneContext.Provider value={pane}>
      <section
        ref={ref}
        className={`pane${active ? ' is-active' : ''}`}
        data-pane={pane}
        data-size={size}
        style={style}
        aria-label={pane === 'side' ? t('tabs.secondPage') : undefined}
        onPointerDownCapture={() => setActivePane(pane)}
        onFocusCapture={() => setActivePane(pane)}
      >
        <ErrorBoundary resetKey={routeHash(route)}>
          <Suspense fallback={<div className="view" aria-busy="true" />}>{viewFor(route)}</Suspense>
        </ErrorBoundary>
      </section>
    </PaneContext.Provider>
  );
}

// dragging the line between the two sides of a split, the share is remembered
function SplitResizer() {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const panes = handle.parentElement!.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) => {
      const share = (moved.clientX - panes.left) / panes.width;
      setPreferences({ splitShare: Math.min(0.8, Math.max(0.2, share)) });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  return (
    <div
      className="split-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('tabs.resizeSplit')}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setPreferences({ splitShare: 0.5 })}
    />
  );
}

// the first view after opening, once per window
let started = false;
function useStartPage() {
  useEffect(() => {
    if (started) return;
    started = true;
    // a window opened at a particular place, or a brand new vault showing its guide, stays as it is
    if ((window.location.hash && window.location.hash !== '#/') || getSession().firstRun) return;
    const start = getPreferences().startPage;
    if (start === 'last') goBack('main');
    else if (start === 'today') {
      const id = ensureToday();
      if (id) navigate({ name: 'page', id, find: null }, { replace: true, pane: 'main' });
    }
  }, []);
}

export function App() {
  const route = useRoute();
  const ui = useUi();
  const prefs = usePreferences();
  const tabs = useTabs();
  useTheme(prefs.theme);
  useEffect(() => {
    document.documentElement.dataset.accent = prefs.accent;
    document.documentElement.dataset.colorful = prefs.colorful ? 'true' : 'false';
  }, [prefs.accent, prefs.colorful]);
  useGlobalShortcuts();
  useEffect(() => startTabs(), []);
  useStartPage();
  useLifecycle();

  useEffect(() => {
    setUi({ mobileSidebar: false });
  }, [route]);

  const side = tabs.tabs.find((tab) => tab.id === tabs.active)?.side ?? null;
  const sideRoute = useMemo(() => (side ? parseRoute(side.hash) : null), [side]);

  return (
    <div
      className={`app${prefs.sidebarOpen ? '' : ' sidebar-collapsed'}${prefs.assistant && prefs.assistantOpen ? ' has-assistant' : ''}${ui.mobileSidebar ? ' mobile-sidebar-open' : ''}${ui.focusMode ? ' focus-mode' : ''}`}
    >
      <Sidebar />
      <div className="scrim" aria-hidden="true" onClick={() => setUi({ mobileSidebar: false })} />
      <main className="main">
        <TabBar />
        <div className={`panes${sideRoute ? ' is-split' : ''}`}>
          <Pane
            pane="main"
            route={route}
            active={!sideRoute || tabs.pane === 'main'}
            style={sideRoute ? { flexGrow: prefs.splitShare } : undefined}
          />
          {sideRoute && (
            <>
              <SplitResizer />
              <Pane
                pane="side"
                route={sideRoute}
                active={tabs.pane === 'side'}
                style={{ flexGrow: 1 - prefs.splitShare }}
              />
            </>
          )}
        </div>
      </main>
      {prefs.assistant && prefs.assistantOpen && desktop?.assistant && (
        <Suspense fallback={null}>
          <AssistantPanel />
        </Suspense>
      )}
      {ui.palette && <CommandPalette />}
      <Dialogs />
      <Toasts />
    </div>
  );
}
