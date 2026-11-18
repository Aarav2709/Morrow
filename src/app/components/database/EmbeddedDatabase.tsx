import { Maximize2 } from 'lucide-react';
import { displayTitle } from '../../../core/model';
import type { PageId } from '../../../core/model';
import { openPage } from '../../router';
import { useWorkspace } from '../../workspace';
import { PageIcon } from '../Sidebar';
import { DatabaseView } from './DatabaseView';
import { t } from '../../i18n';
import { viewName } from '../../i18n/labels';

// a database living inside another page, with all its views, still a page of its own. it can show one of
// its views alone, a linked view kept in the page as ![[Database#View]], with that view's own filters,
// sorts and properties
export function EmbeddedDatabase({
  pageId,
  editable,
  viewId = null,
  onPickView,
}: {
  pageId: PageId;
  editable: boolean;
  viewId?: string | null;
  onPickView?: (name: string | null) => void;
}) {
  const state = useWorkspace();
  const page = state.pages[pageId];
  if (!page?.database) return null;
  const views = page.database.views;
  return (
    <div className="inline-database">
      <div className="inline-database-head">
        <button type="button" className="inline-database-title" onClick={() => openPage(page.id)}>
          <PageIcon page={page} />
          <span>{displayTitle(page)}</span>
        </button>
        {editable && onPickView && views.length > 1 && (
          <select
            className="text-input small inline-database-view"
            aria-label={t('database.showInPage')}
            title={t('database.showInPage')}
            value={viewId ?? ''}
            onChange={(event) => {
              const view = views.find((item) => item.id === event.target.value);
              onPickView(view ? view.name || viewName(view) : null);
            }}
          >
            <option value="">{t('database.allViews')}</option>
            {views.map((view) => (
              <option key={view.id} value={view.id}>
                {viewName(view)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="icon-button"
          title={t('database.openAsAFullPage')}
          aria-label={t('database.openAsAFullPage')}
          onClick={() => openPage(page.id)}
        >
          <Maximize2 size={14} />
        </button>
      </div>
      <DatabaseView page={page} editable={editable} onlyView={viewId} />
    </div>
  );
}
