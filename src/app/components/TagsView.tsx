import { Hash, Palette, Plus, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageMeta } from '../../core/model';
import { collectTags, pagesWithTag, tagClass } from '../../core/tags';
import { ancestorsOf } from '../../core/tree';
import { normalizeTag } from '../../core/vault/frontmatter';
import { navigate, openPage } from '../router';
import { run, useWorkspace } from '../workspace';
import { relativeTime, useShowMore } from './primitives';
import { t } from '../i18n';
import { PageIcon } from './Sidebar';
import { TopBar } from './TopBar';
import { TagColorMenu } from './TagColorMenu';
import { useTagColors } from '../tagColors';

export function TagsView() {
  const state = useWorkspace();
  const tags = useMemo(() => collectTags(state), [state]);
  useTagColors();
  const [colouring, setColouring] = useState<{ tag: string; at: DOMRect } | null>(null);
  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{t('tags.title')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection">
          <header className="collection-header">
            <h1>{t('tags.title')}</h1>
            <p className="muted">{t('tags.subtitle')}</p>
          </header>
          {tags.length === 0 ? (
            <div className="empty-state compact">
              <Hash size={24} strokeWidth={1.5} />
              <p>{t('tags.empty')}</p>
            </div>
          ) : (
            <ul className="tag-cloud">
              {tags.map((entry) => (
                <li key={entry.tag}>
                  <button
                    type="button"
                    className={`tag-chip large ${tagClass(entry.tag)}`}
                    onClick={() => navigate({ name: 'tag', tag: entry.tag })}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setColouring({ tag: entry.tag, at: new DOMRect(event.clientX, event.clientY, 0, 0) });
                    }}
                  >
                    #{entry.tag} <span className="tag-count">{entry.pages.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {colouring && (
            <TagColorMenu name={colouring.tag} anchor={colouring.at} onClose={() => setColouring(null)} />
          )}
        </div>
      </div>
    </div>
  );
}

export function TagView({ tag }: { tag: string }) {
  const state = useWorkspace();
  const pages = useMemo(() => pagesWithTag(state, tag), [state, tag]);
  const { shown, more } = useShowMore(pages, 60);
  useTagColors();
  const [colouring, setColouring] = useState<HTMLElement | null>(null);
  return (
    <div className="view">
      <TopBar>
        <nav className="breadcrumbs" aria-label={t('common.breadcrumb')}>
          <ol>
            <li>
              <button type="button" className="crumb" onClick={() => navigate({ name: 'tags' })}>
                {t('tags.breadcrumbTags')}
              </button>
              <span className="crumb-sep" aria-hidden="true">
                /
              </span>
            </li>
            <li>
              <span className="crumb is-current">#{tag}</span>
            </li>
          </ol>
        </nav>
      </TopBar>
      <div className="page-scroll">
        <div className="collection">
          <header className="collection-header">
            <div className="tag-heading">
              <h1>
                <span className={`tag-chip large ${tagClass(tag)}`}>#{tag}</span>
              </h1>
              <button
                type="button"
                className="button small"
                onClick={(event) => setColouring(event.currentTarget)}
              >
                <Palette size={14} /> {t('tags.changeColour')}
              </button>
              {colouring && <TagColorMenu name={tag} anchor={colouring} onClose={() => setColouring(null)} />}
            </div>
            <p className="muted">
              {pages.length === 1
                ? t('tags.pageCountSingle')
                : t('tags.pageCountPlural', { count: pages.length })}
            </p>
          </header>
          <ul className="link-list">
            {shown.map((page) => (
              <PageRow
                key={page.id}
                page={page}
                path={ancestorsOf(state.pages, page.id).reverse().map(displayTitle).join(' / ')}
              />
            ))}
          </ul>
          {more}
        </div>
      </div>
    </div>
  );
}

function PageRow({ page, path }: { page: PageMeta; path: string }) {
  return (
    <li>
      <button type="button" className="link-row" onClick={() => openPage(page.id)}>
        <span className="tree-icon">
          <PageIcon page={page} />
        </span>
        <span className="link-row-title">
          {displayTitle(page)}
          {path && <span className="link-row-path">{path}</span>}
        </span>
        <span className="link-row-meta">{relativeTime(page.updatedAt)}</span>
      </button>
    </li>
  );
}

function setTags(page: PageMeta, tags: string[]): void {
  run({ type: 'page.setTags', id: page.id, tags, now: Date.now() });
}

// the tags property of a page, shown under its title
export function PageTags({ page, editable }: { page: PageMeta; editable: boolean }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [colouring, setColouring] = useState<{ tag: string; at: DOMRect } | null>(null);
  const [active, setActive] = useState(0);
  const state = useWorkspace();
  useTagColors();
  // tags used elsewhere in the vault that start with what is typed, the most used first
  const known = useMemo(() => (adding ? collectTags(state) : []), [adding, state]);
  const typed = draft.trim().replace(/^#/, '').toLowerCase();
  const suggestions = typed
    ? known
        .filter(
          (entry) =>
            entry.tag.toLowerCase().startsWith(typed) &&
            entry.tag.toLowerCase() !== typed &&
            !page.tags.some((tag) => tag.toLowerCase() === entry.tag.toLowerCase()),
        )
        .sort((a, b) => b.pages.length - a.pages.length)
        .slice(0, 8)
    : [];
  if (page.tags.length === 0 && !editable) return null;
  const save = (tags: string[]) => setTags(page, tags);
  const add = (picked?: string) => {
    const tags = (picked ?? draft)
      .split(/[,\s]+/)
      .map((tag) => normalizeTag(tag))
      .filter((tag): tag is string => tag !== null);
    if (tags.length) save([...page.tags, ...tags]);
    setDraft('');
    setActive(0);
  };
  return (
    <div className="page-tags" aria-label={t('tags.title')}>
      {page.tags.map((tag) => (
        <span key={tag} className={`tag-chip ${tagClass(tag)}`}>
          <button
            type="button"
            className="tag-chip-name"
            onClick={() => navigate({ name: 'tag', tag })}
            onContextMenu={(event) => {
              event.preventDefault();
              setColouring({ tag, at: new DOMRect(event.clientX, event.clientY, 0, 0) });
            }}
          >
            #{tag}
          </button>
          {editable && (
            <button
              type="button"
              className="tag-remove"
              aria-label={t('tags.removeTag', { tag })}
              onClick={() => save(page.tags.filter((item) => item !== tag))}
            >
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {editable &&
        (adding ? (
          <span className="tag-input-holder">
            <input
              ref={inputRef}
              className="tag-input"
              autoFocus
              aria-label={t('tags.newTag')}
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
              placeholder={t('tags.tagPlaceholder')}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setActive(0);
              }}
              onBlur={() => {
                add();
                setAdding(false);
              }}
              onKeyDown={(event) => {
                const suggestion = suggestions[Math.min(active, suggestions.length - 1)];
                if (event.key === 'ArrowDown' && suggestions.length) {
                  event.preventDefault();
                  setActive((active + 1) % suggestions.length);
                } else if (event.key === 'ArrowUp' && suggestions.length) {
                  event.preventDefault();
                  setActive((active - 1 + suggestions.length) % suggestions.length);
                } else if ((event.key === 'Enter' || event.key === 'Tab') && suggestion) {
                  event.preventDefault();
                  add(suggestion.tag);
                } else if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  add();
                } else if (event.key === 'Escape') {
                  setDraft('');
                  setAdding(false);
                } else if (event.key === 'Backspace' && !draft && page.tags.length)
                  save(page.tags.slice(0, -1));
              }}
            />
            {suggestions.length > 0 && (
              <ul className="tag-suggestions popover" role="listbox" aria-label={t('tags.title')}>
                {suggestions.map((entry, index) => (
                  <li key={entry.tag} role="option" aria-selected={index === active}>
                    <button
                      type="button"
                      className={index === active ? 'is-active' : ''}
                      // picked before the input loses focus, which would add what was typed instead
                      onMouseDown={(event) => {
                        event.preventDefault();
                        add(entry.tag);
                      }}
                    >
                      <span className={`tag-chip ${tagClass(entry.tag)}`}>#{entry.tag}</span>
                      <span className="tag-count">{entry.pages.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </span>
        ) : (
          <button type="button" className="add-tag" onClick={() => setAdding(true)}>
            <Plus size={12} /> {page.tags.length ? t('page.tag') : t('page.addTag')}
          </button>
        ))}
      {colouring && (
        <TagColorMenu name={colouring.tag} anchor={colouring.at} onClose={() => setColouring(null)} />
      )}
    </div>
  );
}
