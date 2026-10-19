import { useMemo, useSyncExternalStore } from 'react';
import type { PageId } from '../core/model';
import { activeHash, getTabs, showInMain, showInSide, subscribeTabs, targetPane } from './tabs';
import type { PaneId } from './tabs';

export type Route =
  | { name: 'home' }
  | { name: 'page'; id: PageId; find: string | null }
  | { name: 'tasks' }
  | { name: 'trash' }
  | { name: 'tags' }
  | { name: 'tag'; tag: string }
  | { name: 'graph'; focus: PageId | null }
  | { name: 'review' }
  | { name: 'search'; query: string };

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'page' && parts[1]) {
    const find = new URLSearchParams(query).get('find');
    return { name: 'page', id: decodeURIComponent(parts[1]), find: find || null };
  }
  if (parts[0] === 'tasks') return { name: 'tasks' };
  if (parts[0] === 'trash') return { name: 'trash' };
  if (parts[0] === 'tags' && parts[1])
    return { name: 'tag', tag: decodeURIComponent(parts.slice(1).join('/')) };
  if (parts[0] === 'tags') return { name: 'tags' };
  if (parts[0] === 'review') return { name: 'review' };
  if (parts[0] === 'search') return { name: 'search', query: new URLSearchParams(query).get('q') ?? '' };
  if (parts[0] === 'graph') return { name: 'graph', focus: parts[1] ? decodeURIComponent(parts[1]) : null };
  return { name: 'home' };
}

export function routeHash(route: Route): string {
  switch (route.name) {
    case 'page':
      return `#/page/${encodeURIComponent(route.id)}${route.find ? `?find=${encodeURIComponent(route.find)}` : ''}`;
    case 'tasks':
      return '#/tasks';
    case 'trash':
      return '#/trash';
    case 'tags':
      return '#/tags';
    case 'tag':
      return `#/tags/${route.tag.split('/').map(encodeURIComponent).join('/')}`;
    case 'review':
      return '#/review';
    case 'search':
      return route.query ? `#/search?q=${encodeURIComponent(route.query)}` : '#/search';
    case 'graph':
      return route.focus ? `#/graph/${encodeURIComponent(route.focus)}` : '#/graph';
    default:
      return '#/';
  }
}

// goes to the side of a split tab that was used last, or the one named
export function navigate(route: Route, options: { replace?: boolean; pane?: PaneId } = {}): void {
  const hash = routeHash(route);
  const pane = options.pane ?? targetPane();
  if (pane === 'side' && getTabs().tabs.find((tab) => tab.id === getTabs().active)?.side) {
    showInSide(hash, options.replace);
    return;
  }
  showInMain(hash, options.replace);
}

export function openPage(id: PageId, find: string | null = null): void {
  navigate({ name: 'page', id, find });
}

let cachedHash = '';
let cachedRoute: Route = { name: 'home' };

function snapshot(): Route {
  const hash = window.location.hash;
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = parseRoute(hash);
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore((listener) => {
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, snapshot);
}

// the place shown where navigation goes, the side of a split tab when that side is in use
export function useActiveRoute(): Route {
  const hash = useSyncExternalStore((listener) => {
    window.addEventListener('hashchange', listener);
    const stop = subscribeTabs(listener);
    return () => {
      window.removeEventListener('hashchange', listener);
      stop();
    };
  }, activeHash);
  return useMemo(() => parseRoute(hash), [hash]);
}

export function activeRoute(): Route {
  return parseRoute(activeHash());
}
