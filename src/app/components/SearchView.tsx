import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { displayTitle } from '../../core/model';
import { searchWorkspace } from '../../core/search';
import type { SearchResult } from '../../core/search';
import { navigate, openPage } from '../router';
import { usePane } from '../tabs';
import { useWorkspace } from '../workspace';
import { PageIcon } from './Sidebar';
import { relativeTime } from './primitives';
import { useTranslation } from '../i18n';
import { TopBar } from './TopBar';
import { tr } from '../i18n/rich';

type Order = 'best' | 'recent' | 'title';

const MAX_RESULTS = 200;
const SNIPPETS_PER_PAGE = 3;

function sorted(results: SearchResult[], order: Order): SearchResult[] {
  if (order === 'recent') return [...results].sort((a, b) => b.page.updatedAt - a.page.updatedAt);
  if (order === 'title')
    return [...results].sort((a, b) => displayTitle(a.page).localeCompare(displayTitle(b.page)));
  return results;
}

// every page that matches, with each place it matched, the query lives in the address so tabs keep it
export function SearchView({ query }: { query: string }) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const orders: Array<[Order, string]> = [
    ['best', t('searchView.orders.best')],
    ['recent', t('searchView.orders.recent')],
    ['title', t('searchView.orders.title')],
  ];
  const pane = usePane();
  const [text, setText] = useState(query);
  const [order, setOrder] = useState<Order>('best');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // typing updates the address after a pause, without a history entry for every letter
  useEffect(() => {
    if (text === query) return;
    const timer = setTimeout(() => navigate({ name: 'search', query: text }, { replace: true, pane }), 250);
    return () => clearTimeout(timer);
  }, [text, query, pane]);

  const results = useMemo(
    () => sorted(searchWorkspace(state, query, MAX_RESULTS, SNIPPETS_PER_PAGE), order),
    [state, query, order],
  );

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{t('common.search')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection search-view">
          <header className="collection-header">
            <label className="search-field">
              <Search size={18} strokeWidth={1.75} />
              <input
                ref={inputRef}
                type="search"
                placeholder={t('searchView.placeholder')}
                aria-label={t('searchView.ariaLabel')}
                value={text}
                spellCheck={false}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter')
                    navigate({ name: 'search', query: text }, { replace: true, pane });
                }}
              />
            </label>
            <p className="muted small search-tips">
              {tr('searchView.tips', {
                phrase: <code>{t('searchView.tipPhrase')}</code>,
                exclude: <code>{t('searchView.tipExclude')}</code>,
                tag: <code>{t('searchView.tipTag')}</code>,
              })}
            </p>
            {query.trim() && (
              <div className="search-meta">
                <span className="muted">
                  {results.length === 1
                    ? t('searchView.pageCountSingular', { count: 1 })
                    : t('searchView.pageCountPlural', {
                        count: results.length === MAX_RESULTS ? `${MAX_RESULTS}+` : results.length,
                      })}
                </span>
                <div className="segmented" role="radiogroup" aria-label={t('searchView.orderAria')}>
                  {orders.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={order === value}
                      className={order === value ? 'is-active' : ''}
                      onClick={() => setOrder(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </header>
          {query.trim() && results.length === 0 && (
            <div className="empty-state compact">
              <Search size={24} strokeWidth={1.5} />
              <p>{t('searchView.noMatches', { query })}</p>
            </div>
          )}
          <ul className="search-results">
            {results.map((result) => (
              <li key={result.page.id}>
                <button
                  type="button"
                  className="search-result"
                  data-page-id={result.page.id}
                  title={t('searchView.resultTooltip')}
                  onClick={() => openPage(result.page.id, result.titleMatch ? null : result.firstMatch)}
                >
                  <span className="search-result-head">
                    <span className="tree-icon">
                      <PageIcon page={result.page} />
                    </span>
                    <span className="search-result-title">{displayTitle(result.page)}</span>
                    {result.path.length > 0 && (
                      <span className="search-result-path">{result.path.join(' / ')}</span>
                    )}
                    <span className="search-result-time">{relativeTime(result.page.updatedAt)}</span>
                  </span>
                  {result.snippets.map((snippet, index) => (
                    <span key={index} className="search-snippet">
                      {snippet.before}
                      <mark>{snippet.match}</mark>
                      {snippet.after}
                    </span>
                  ))}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
