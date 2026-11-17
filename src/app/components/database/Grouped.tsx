import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { arrangeGroups, groupKey, groupRows } from '../../../core/database';
import type { DatabaseDef, PageId, PageMeta, ViewDef } from '../../../core/model';
import { t } from '../../i18n';
import { usePreferences } from '../../platform/preferences';
import { updateView } from './data';

// how many rows a view shows at first: its own limit, or the default from settings once it has more rows
// than that. 0 shows them all
export function viewLimit(view: ViewDef, total: number, fallback: number): number {
  if (view.limit !== undefined) return view.limit;
  return fallback > 0 && total > fallback ? fallback : 0;
}

// rows past the limit wait under a footer that shows how many there are and loads more of them, a page
// of them at a time or all at once
export function Limited({
  view,
  rows,
  children,
}: {
  view: ViewDef;
  rows: PageMeta[];
  children: (rows: PageMeta[]) => ReactNode;
}) {
  const { databaseLimit } = usePreferences();
  const limit = viewLimit(view, rows.length, databaseLimit);
  const [extra, setExtra] = useState(0);
  const [all, setAll] = useState(false);
  const count = !limit || all ? rows.length : Math.min(rows.length, limit + extra);
  return (
    <>
      {children(count === rows.length ? rows : rows.slice(0, count))}
      {count < rows.length && (
        <div className="db-load-more">
          <span className="muted small">{t('database.showingOf', { count, total: rows.length })}</span>
          <button type="button" className="link-button small" onClick={() => setExtra(extra + limit)}>
            {t('database.loadMore', { count: Math.min(limit, rows.length - count) })}
          </button>
          <button type="button" className="link-button small" onClick={() => setAll(true)}>
            {t('database.showAll')}
          </button>
        </div>
      )}
    </>
  );
}

// a table, list or gallery split into a group for each value of a property. a group folds under its
// heading, which is kept with the view so it stays folded when the page opens again
export function Grouped({
  dbId,
  database,
  view,
  rows,
  editable,
  children,
}: {
  dbId: PageId;
  database: DatabaseDef;
  view: ViewDef;
  rows: PageMeta[];
  editable: boolean;
  children: (rows: PageMeta[]) => ReactNode;
}) {
  // a database that can't be changed still folds its groups while it is open
  const [folded, setFolded] = useState<string[] | null>(null);
  const collapsed = folded ?? view.collapsedGroups ?? [];
  const groups = arrangeGroups(groupRows(rows, view.groupBy, database), view);
  const toggle = (key: string) => {
    const next = collapsed.includes(key) ? collapsed.filter((item) => item !== key) : [...collapsed, key];
    if (editable) {
      setFolded(null);
      updateView(dbId, view.id, (current) => ({ ...current, collapsedGroups: next }));
    } else setFolded(next);
  };
  if (groups.length === 0) return <p className="muted db-hint">{t('database.noGroups')}</p>;
  return (
    <div className="db-groups">
      {groups.map((group) => {
        const key = groupKey(group);
        const open = !collapsed.includes(key);
        return (
          <section key={key} className="db-group" aria-label={group.label}>
            <button type="button" className="db-group-head" aria-expanded={open} onClick={() => toggle(key)}>
              <ChevronRight size={14} className={`db-group-chevron${open ? ' is-open' : ''}`} />
              <span className={`chip color-${group.color}`}>{group.label}</span>
              <span className="section-count">{group.rows.length}</span>
            </button>
            {open && (
              <Limited view={view} rows={group.rows}>
                {children}
              </Limited>
            )}
          </section>
        );
      })}
    </div>
  );
}
