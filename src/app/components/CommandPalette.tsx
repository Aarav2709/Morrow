import { CornerDownLeft, FileText, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { displayTitle } from '../../core/model';
import { foldText, searchWorkspace } from '../../core/search';
import type { SearchSnippet } from '../../core/search';
import { ancestorsOf, livePages } from '../../core/tree';
import { ACTIONS, currentContext, formatShortcut } from '../actions';
import { navigate, openPage } from '../router';
import { setUi } from '../ui';
import { useWorkspace } from '../workspace';
import { pageIcon } from './Sidebar';

interface Entry {
  key: string;
  group: string;
  title: string;
  icon: LucideIcon;
  detail?: string;
  snippet?: SearchSnippet | null;
  shortcut?: string;
  run: () => void;
}

export function CommandPalette() {
  const state = useWorkspace();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, []);

  const close = () => setUi({ palette: false });

  const entries = useMemo<Entry[]>(() => {
    const context = currentContext();
    const actionQuery = foldText(query.trim().replace(/^>/, ''));
    const actions = ACTIONS.filter(
      (action) => action.id !== 'search' && (!action.enabled || action.enabled(context)),
    )
      .filter(
        (action) =>
          !actionQuery ||
          foldText(`${action.label} ${action.keywords ?? ''} ${action.group}`).includes(actionQuery),
      )
      .map<Entry>((action) => ({
        key: `action:${action.id}`,
        group: 'Actions',
        title: action.label,
        icon: action.icon,
        ...(action.shortcut ? { shortcut: formatShortcut(action.shortcut) } : {}),
        run: () => action.run(context),
      }));

    if (query.trim().startsWith('>')) return actions;

    if (!query.trim()) {
      const recent = livePages(state.pages)
        .filter((page) => page.lastOpenedAt !== null)
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
        .slice(0, 6)
        .map<Entry>((page) => ({
          key: `page:${page.id}`,
          group: 'Recent',
          title: displayTitle(page),
          icon: pageIcon(page),
          detail: ancestorsOf(state.pages, page.id).reverse().map(displayTitle).join(' / '),
          run: () => openPage(page.id),
        }));
      return [...recent, ...actions];
    }

    const pages = searchWorkspace(state, query, 30).map<Entry>((result) => ({
      key: `page:${result.page.id}`,
      group: 'Pages',
      title: displayTitle(result.page),
      icon: result.page ? pageIcon(result.page) : FileText,
      detail: result.path.join(' / '),
      snippet: result.titleMatch ? null : result.snippet,
      run: () => openPage(result.page.id, result.titleMatch ? null : result.firstMatch),
    }));
    const everywhere: Entry = {
      key: 'search:all',
      group: 'Pages',
      title: `Search every page for “${query.trim()}”`,
      icon: Search,
      shortcut: formatShortcut('Mod+Enter'),
      run: () => navigate({ name: 'search', query: query.trim() }),
    };
    return [...pages, everywhere, ...actions.slice(0, 5)];
  }, [query, state]);

  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setActive(0);
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    close();
    entry.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(entries.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && query.trim()) {
      // every result, with every place it matched, in a view of its own
      event.preventDefault();
      close();
      navigate({ name: 'search', query: query.trim() });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(entries[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const activeEntry = entries[active];

  return (
    <div
      className="dialog-backdrop palette-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="palette-input-row">
          <Search size={18} strokeWidth={1.75} className="palette-search-icon" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Search pages, or type > for commands"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={activeEntry ? `palette-${active}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
          />
        </div>
        <div className="palette-results" id="palette-results" role="listbox" ref={listRef}>
          {entries.length === 0 && <div className="palette-empty">No pages or commands match “{query}”.</div>}
          {entries.map((entry, index) => {
            const Icon = entry.icon;
            const showGroup = entry.group !== entries[index - 1]?.group;
            return (
              <div key={entry.key}>
                {showGroup && <div className="menu-section">{entry.group}</div>}
                <div
                  id={`palette-${index}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className="palette-item"
                  onMouseMove={() => index !== active && setActive(index)}
                  onClick={() => choose(entry)}
                >
                  <Icon size={16} strokeWidth={1.75} className="palette-item-icon" />
                  <div className="palette-item-text">
                    <div className="palette-item-title">
                      {entry.title}
                      {entry.detail && <span className="palette-item-detail">{entry.detail}</span>}
                    </div>
                    {entry.snippet && (
                      <div className="palette-snippet">
                        {entry.snippet.before}
                        <mark>{entry.snippet.match}</mark>
                        {entry.snippet.after}
                      </div>
                    )}
                  </div>
                  {entry.shortcut && <kbd className="kbd">{entry.shortcut}</kbd>}
                  {index === active && !entry.shortcut && (
                    <CornerDownLeft size={14} className="palette-enter" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-footer">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to move
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> to open
          </span>
          <span>
            <kbd className="kbd">{formatShortcut('Mod+Enter')}</kbd> for every result
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
