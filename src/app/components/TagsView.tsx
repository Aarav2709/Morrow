import { Hash, Plus, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageMeta } from '../../core/model';
import { collectTags, pagesWithTag, tagColor } from '../../core/tags';
import { ancestorsOf } from '../../core/tree';
import { normalizeTag } from '../../core/vault/frontmatter';
import { navigate, openPage } from '../router';
import { run, useWorkspace } from '../workspace';
import { relativeTime } from './primitives';
import { t } from '../i18n';
import { PageIcon } from './Sidebar';
import { TopBar } from './TopBar';

export function TagsView() {
  const state = useWorkspace();
  const tags = useMemo(() => collectTags(state), [state]);
  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{t('tags.title')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection">
          <header className="collection-header">
            <h1>{t('tags.title')}</h1>
            <p className="muted">
              {t('tags.subtitle')}
            </p>
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
                    className={`tag-chip large tag-${tagColor(entry.tag)}`}
                    onClick={() => navigate({ name: 'tag', tag: entry.tag })}
                  >
                    #{entry.tag} <span className="tag-count">{entry.pages.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function TagView({ tag }: { tag: string }) {
  const state = useWorkspace();
  const pages = useMemo(() => pagesWithTag(state, tag), [state, tag]);
  return (
    <div className="view">
      <TopBar>
        <nav className="breadcrumbs" aria-label="Breadcrumb">
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
            <h1>#{tag}</h1>
            <p className="muted">
              {pages.length === 1 ? t('tags.pageCountSingle') : t('tags.pageCountPlural', { count: pages.length })}
            </p>
          </header>
          <ul className="link-list">
            {pages.map((page) => (
              <PageRow
                key={page.id}
                page={page}
                path={ancestorsOf(state.pages, page.id).reverse().map(displayTitle).join(' / ')}
              />
            ))}
          </ul>
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
  if (page.tags.length === 0 && !editable) return null;
  const save = (tags: string[]) => setTags(page, tags);
  const add = () => {
    const tags = draft
      .split(/[,\s]+/)
      .map((tag) => normalizeTag(tag))
      .filter((tag): tag is string => tag !== null);
    if (tags.length) save([...page.tags, ...tags]);
    setDraft('');
  };
  return (
    <div className="page-tags" aria-label={t('tags.title')}>
      {page.tags.map((tag) => (
        <span key={tag} className={`tag-chip tag-${tagColor(tag)}`}>
          <button type="button" className="tag-chip-name" onClick={() => navigate({ name: 'tag', tag })}>
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
          <input
            ref={inputRef}
            className="tag-input"
            autoFocus
            aria-label={t('tags.newTag')}
            placeholder={t('tags.tagPlaceholder')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              add();
              setAdding(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                add();
              } else if (event.key === 'Escape') {
                setDraft('');
                setAdding(false);
              } else if (event.key === 'Backspace' && !draft && page.tags.length)
                save(page.tags.slice(0, -1));
            }}
          />
        ) : (
          <button type="button" className="add-tag" onClick={() => setAdding(true)}>
            <Plus size={12} /> {page.tags.length ? t('page.tag') : t('page.addTag')}
          </button>
        ))}
    </div>
  );
}
