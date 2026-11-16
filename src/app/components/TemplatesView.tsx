import { FilePlus2, LayoutTemplate, MoreHorizontal, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { displayTitle } from '../../core/model';
import { foldText } from '../../core/search';
import { tagClass } from '../../core/tags';
import { findTemplatesPage, listTemplates } from '../../core/templates';
import { t } from '../i18n';
import { createFromTemplate, createPage, createTemplatesPageQuietly } from '../operations';
import { openPage } from '../router';
import { useTagColors } from '../tagColors';
import { useWorkspace } from '../workspace';
import { relativeTime, useShowMore } from './primitives';
import { PageIcon } from './Sidebar';
import { TopBar } from './TopBar';
import { Menu } from './Menu';
import { pageMenuEntries } from './pageMenu';
import { setUi } from '../ui';

// every template in one place, like tasks or review, so dozens of them never crowd the sidebar. the search
// matches a template's name, and words starting with # match its tags
export function TemplatesView() {
  const state = useWorkspace();
  useTagColors();
  const [query, setQuery] = useState('');
  const templates = useMemo(() => listTemplates(state), [state]);
  const matching = useMemo(() => {
    const words = foldText(query).split(/\s+/).filter(Boolean);
    if (!words.length) return templates;
    return templates.filter((page) => {
      const title = foldText(displayTitle(page));
      const tags = page.tags.map((tag) => foldText(tag));
      return words.every((word) =>
        word.startsWith('#')
          ? tags.some((tag) => tag.startsWith(word.slice(1)))
          : title.includes(word) || tags.some((tag) => tag.startsWith(word)),
      );
    });
  }, [templates, query]);
  const listed = useShowMore(matching, 60);
  // a template's own menu, the same as a page's in the sidebar, from a right click or its ... button
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement | DOMRect } | null>(null);

  const newTemplate = () => {
    const container = findTemplatesPage(state)?.id ?? createTemplatesPageQuietly();
    if (container) createPage({ parentId: container, title: t('dialogs.newTemplate') });
  };

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{t('dialogs.templates')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection templates-view">
          <header className="collection-header">
            <h1>{t('dialogs.templates')}</h1>
            <p className="muted">{t('templatesView.subtitle')}</p>
            <div className="templates-view-bar">
              <label className="search-field">
                <Search size={18} strokeWidth={1.75} />
                <input
                  type="search"
                  placeholder={t('templatesView.search')}
                  aria-label={t('templatesView.search')}
                  value={query}
                  spellCheck={false}
                  autoFocus={templates.length > 0}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && matching[0]) openPage(matching[0].id);
                    if (event.key === 'Escape') setQuery('');
                  }}
                />
              </label>
              <button type="button" className="button primary" onClick={newTemplate}>
                <Plus size={15} /> {t('dialogs.newTemplate')}
              </button>
            </div>
          </header>
          {templates.length === 0 ? (
            <div className="empty-state compact">
              <LayoutTemplate size={24} strokeWidth={1.5} />
              <p>{t('templatesView.empty')}</p>
            </div>
          ) : matching.length === 0 ? (
            <div className="empty-state compact">
              <Search size={24} strokeWidth={1.5} />
              <p>{t('templatesView.noMatch')}</p>
            </div>
          ) : (
            <>
              <ul className="link-list">
                {listed.shown.map((page) => (
                  <li key={page.id} className="trash-row">
                    <button
                      type="button"
                      className="link-row"
                      data-page-id={page.id}
                      onClick={() => openPage(page.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMenu({ id: page.id, anchor: new DOMRect(event.clientX, event.clientY, 0, 0) });
                      }}
                    >
                      <span className="tree-icon">
                        <PageIcon page={page} />
                      </span>
                      <span className="link-row-title">
                        {displayTitle(page)}
                        {page.tags.length > 0 && (
                          <span className="templates-view-tags">
                            {page.tags.map((tag) => (
                              <span key={tag} className={`tag-chip ${tagClass(tag)}`}>
                                #{tag}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="link-row-meta">{relativeTime(page.updatedAt)}</span>
                    </button>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button small"
                        onClick={() => createFromTemplate(page.id, null)}
                      >
                        <FilePlus2 size={14} /> {t('templatesView.use')}
                      </button>
                      <button
                        type="button"
                        className="icon-button small"
                        aria-label={t('pageMenu.pageOptions')}
                        title={t('pageMenu.pageOptions')}
                        aria-haspopup="menu"
                        onClick={(event) => setMenu({ id: page.id, anchor: event.currentTarget })}
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {listed.more}
            </>
          )}
          {menu && (
            <Menu
              anchor={menu.anchor}
              label={t('pageMenu.pageOptions')}
              entries={pageMenuEntries(menu.id, () => {
                // renamed in the page itself, its title takes the cursor
                setUi({ focusTitle: menu.id });
                openPage(menu.id);
              })}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
