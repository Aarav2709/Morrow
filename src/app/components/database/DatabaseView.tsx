import {
  ArrowDownUp,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Eye,
  EyeOff,
  Filter,
  GalleryVerticalEnd,
  LayoutList,
  Maximize2,
  Plus,
  Settings2,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { dateKey } from '../../../core/daily';
import {
  FILTER_LABELS,
  filterOpsFor,
  groupRows,
  PROP_LABELS,
  propType,
  rowsOf,
  TITLE_PROP,
  VIEW_LABELS,
  visibleRows,
  newView,
  valueOf,
} from '../../../core/database';
import { displayTitle, VIEW_TYPES } from '../../../core/model';
import { unclaimedKeys } from '../../../core/properties';
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../../../core/migrations';
import type {
  DocNode,
  DatabaseDef,
  FilterOp,
  PageId,
  PageMeta,
  PropDef,
  PropValue,
  ViewDef,
  ViewType,
} from '../../../core/model';
import { fileUrl } from '../../platform/attachments';
import { newId } from '../../platform/files';
import { openPage } from '../../router';
import { run, useWorkspace } from '../../workspace';
import { Menu } from '../Menu';
import { Popover } from '../Popover';
import { Emoji } from '../Emoji';
import { PageIcon } from '../Sidebar';
import { addColumnsFromPages, createRow, setValue, updateDatabase, updateView } from './data';
import { Chip, DraftInput, NewProperty, PropertyDisplay, PropertyInput } from './PropertyValue';
import { PropertySettings } from './PropertySettings';

const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  table: Table2,
  board: Columns3,
  calendar: Calendar,
  list: LayoutList,
  gallery: GalleryVerticalEnd,
};

const viewKey = (id: PageId) => `morrow.view.${id}`;

function readViewChoice(id: PageId): string | null {
  try {
    return localStorage.getItem(viewKey(id));
  } catch {
    return null;
  }
}

export function DatabaseView({ page, editable }: { page: PageMeta; editable: boolean }) {
  const state = useWorkspace();
  const database = useMemo(() => page.database ?? { properties: [], views: [] }, [page.database]);
  const [viewId, setViewId] = useState<string | null>(() => readViewChoice(page.id));
  const view = database.views.find((candidate) => candidate.id === viewId) ?? database.views[0] ?? null;
  const allRows = useMemo(() => rowsOf(state, page.id), [state, page.id]);
  const rows = useMemo(
    () => (view ? visibleRows(allRows, view, database) : allRows),
    [allRows, view, database],
  );
  const [tabMenu, setTabMenu] = useState<{ view: ViewDef; anchor: HTMLElement } | null>(null);
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);

  const choose = (id: string) => {
    setViewId(id);
    try {
      localStorage.setItem(viewKey(page.id), id);
    } catch {
      // the choice is only remembered for convenience
    }
  };

  // a database always has at least one view
  useEffect(() => {
    if (editable && database.views.length === 0)
      updateDatabase(page.id, (current) => ({ ...current, views: [newView('table', current, newId)] }));
  }, [editable, database.views.length, page.id]);

  if (!view) return null;
  const visible = database.properties.filter((prop) => !view.hidden.includes(prop.id));

  return (
    <section className="database" aria-label="Database">
      <div className="db-bar">
        <div className="db-tabs" role="tablist" aria-label="Views">
          {database.views.map((candidate) => {
            const Icon = VIEW_ICONS[candidate.type];
            return (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-selected={candidate.id === view.id}
                className={`db-tab${candidate.id === view.id ? ' is-active' : ''}`}
                onClick={() => choose(candidate.id)}
                onContextMenu={(event) => {
                  if (!editable) return;
                  event.preventDefault();
                  setTabMenu({ view: candidate, anchor: event.currentTarget });
                }}
                onDoubleClick={(event) =>
                  editable && setTabMenu({ view: candidate, anchor: event.currentTarget })
                }
              >
                <Icon size={14} /> {candidate.name || VIEW_LABELS[candidate.type]}
              </button>
            );
          })}
          {editable && (
            <button
              type="button"
              className="icon-button small"
              aria-label="Add a view"
              onClick={(event) => setAddMenu(event.currentTarget)}
            >
              <Plus size={14} />
            </button>
          )}
        </div>
        <Toolbar dbId={page.id} database={database} view={view} rows={allRows} editable={editable} />
      </div>
      {editable && <ColumnSuggestion dbId={page.id} database={database} rows={allRows} />}

      {view.type === 'table' && (
        <TableView
          dbId={page.id}
          database={database}
          view={view}
          rows={rows}
          props={visible}
          editable={editable}
        />
      )}
      {view.type === 'board' && (
        <BoardView
          dbId={page.id}
          database={database}
          view={view}
          rows={rows}
          props={visible}
          editable={editable}
        />
      )}
      {view.type === 'calendar' && (
        <CalendarView dbId={page.id} database={database} view={view} rows={rows} editable={editable} />
      )}
      {view.type === 'list' && <ListView rows={rows} props={visible} database={database} />}
      {view.type === 'gallery' && <GalleryView rows={rows} props={visible} database={database} />}
      {view.type !== 'table' && editable && (
        <button type="button" className="db-new-row" onClick={() => newRowAndOpen(page.id, {})}>
          <Plus size={14} /> New
        </button>
      )}
      <p className="db-count muted small">
        {rows.length === allRows.length
          ? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`
          : `${rows.length} of ${allRows.length} rows`}
      </p>

      {addMenu && (
        <Menu
          anchor={addMenu}
          label="Add a view"
          onClose={() => setAddMenu(null)}
          entries={VIEW_TYPES.map((type) => ({
            label: VIEW_LABELS[type],
            icon: VIEW_ICONS[type],
            onSelect: () => {
              const created = newView(type, database, newId);
              if (updateDatabase(page.id, (current) => ({ ...current, views: [...current.views, created] })))
                choose(created.id);
            },
          }))}
        />
      )}
      {tabMenu && (
        <ViewSettings
          dbId={page.id}
          database={database}
          view={tabMenu.view}
          anchor={tabMenu.anchor}
          onClose={() => setTabMenu(null)}
        />
      )}
    </section>
  );
}

function newRowAndOpen(dbId: PageId, values: Record<string, PropValue>): void {
  const id = createRow(dbId, values);
  if (id) openPage(id);
}

function ViewSettings({
  dbId,
  database,
  view,
  anchor,
  onClose,
}: {
  dbId: PageId;
  database: DatabaseDef;
  view: ViewDef;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  return (
    <Popover anchor={anchor} onClose={onClose} label="View settings">
      <label className="field">
        <span>Name</span>
        <DraftInput
          type="text"
          label="View name"
          className="text-input small"
          value={view.name}
          editable
          onCommit={(name) =>
            updateView(dbId, view.id, (current) => ({
              ...current,
              name: name.trim() || VIEW_LABELS[current.type],
            }))
          }
        />
      </label>
      <label className="field">
        <span>Layout</span>
        <select
          className="text-input small"
          value={view.type}
          onChange={(event) =>
            updateView(dbId, view.id, (current) => {
              const type = event.target.value as ViewType;
              const fresh = newView(type, database, () => current.id);
              return {
                ...current,
                type,
                groupBy: current.groupBy ?? fresh.groupBy,
                dateProp: current.dateProp ?? fresh.dateProp,
              };
            })
          }
        >
          {VIEW_TYPES.map((type) => (
            <option key={type} value={type}>
              {VIEW_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <div className="popover-actions">
        <button
          type="button"
          className="button small"
          onClick={() => {
            updateDatabase(dbId, (current) => ({
              ...current,
              views: [...current.views, { ...view, id: newId(), name: `${view.name} copy` }],
            }));
            onClose();
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="button small danger"
          disabled={database.views.length <= 1}
          onClick={() => {
            updateDatabase(dbId, (current) => ({
              ...current,
              views: current.views.filter((candidate) => candidate.id !== view.id),
            }));
            onClose();
          }}
        >
          <Trash2 size={13} /> Delete view
        </button>
      </div>
    </Popover>
  );
}

type ToolPanel = 'filter' | 'sort' | 'properties' | 'layout';

// the frontmatter keys rows already have but no column shows yet, such as the properties of notes that
// came from obsidian, offered once until they are added or dismissed
function ColumnSuggestion({
  dbId,
  database,
  rows,
}: {
  dbId: PageId;
  database: DatabaseDef;
  rows: PageMeta[];
}) {
  const keys = useMemo(() => unclaimedKeys(database, rows), [database, rows]);
  const storageKey = `morrow.columns-dismissed.${dbId}`;
  const [dismissed, setDismissed] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  });
  const signature = keys.join('\n');
  if (keys.length === 0 || dismissed === signature) return null;
  const shown = keys.slice(0, 4).join(', ') + (keys.length > 4 ? ` and ${keys.length - 4} more` : '');
  return (
    <div className="db-suggest" role="note">
      <Columns3 size={14} />
      <span>
        Your pages have {keys.length === 1 ? 'a property' : `${keys.length} properties`} that{' '}
        {keys.length === 1 ? 'is not a column' : 'are not columns'} yet: {shown}.
      </span>
      <button type="button" className="button small" onClick={() => addColumnsFromPages(dbId, keys)}>
        Add as columns
      </button>
      <button
        type="button"
        className="icon-button tiny"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(signature);
          try {
            localStorage.setItem(storageKey, signature);
          } catch {
            // only a convenience
          }
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}

function Toolbar({
  dbId,
  database,
  view,
  rows,
  editable,
}: {
  dbId: PageId;
  database: DatabaseDef;
  view: ViewDef;
  rows: PageMeta[];
  editable: boolean;
}) {
  const unclaimed = useMemo(() => unclaimedKeys(database, rows), [database, rows]);
  const [panel, setPanel] = useState<{ kind: ToolPanel; anchor: HTMLElement } | null>(null);
  const open = (kind: ToolPanel) => (event: React.MouseEvent<HTMLElement>) =>
    setPanel({ kind, anchor: event.currentTarget });
  const names = [{ id: TITLE_PROP, name: 'Name', type: 'text' as const }, ...database.properties];
  return (
    <div className="db-tools">
      <button
        type="button"
        className={`text-tool${view.filters.length ? ' is-active' : ''}`}
        onClick={open('filter')}
        disabled={!editable}
      >
        <Filter size={13} /> Filter{view.filters.length ? ` ${view.filters.length}` : ''}
      </button>
      <button
        type="button"
        className={`text-tool${view.sorts.length ? ' is-active' : ''}`}
        onClick={open('sort')}
        disabled={!editable}
      >
        <ArrowDownUp size={13} /> Sort{view.sorts.length ? ` ${view.sorts.length}` : ''}
      </button>
      {(view.type === 'board' || view.type === 'calendar') && (
        <button type="button" className="text-tool" onClick={open('layout')} disabled={!editable}>
          <Settings2 size={13} /> {view.type === 'board' ? 'Group' : 'Date'}
        </button>
      )}
      <button type="button" className="text-tool" onClick={open('properties')}>
        <Eye size={13} /> Properties
      </button>
      {panel?.kind === 'filter' && (
        <Popover anchor={panel.anchor} onClose={() => setPanel(null)} label="Filters" className="db-panel">
          {view.filters.length === 0 && (
            <p className="muted small">No filters. Rows that match every filter are shown.</p>
          )}
          {view.filters.map((rule) => {
            const type = propType(database, rule.prop) ?? 'text';
            const prop = database.properties.find((candidate) => candidate.id === rule.prop);
            const ops = filterOpsFor(type === 'title' ? 'text' : type);
            const needsValue = !['empty', 'notEmpty', 'checked', 'unchecked'].includes(rule.op);
            const change = (patch: Partial<typeof rule>) =>
              updateView(dbId, view.id, (current) => ({
                ...current,
                filters: current.filters.map((item) => (item.id === rule.id ? { ...item, ...patch } : item)),
              }));
            return (
              <div key={rule.id} className="db-rule">
                <select
                  className="text-input small"
                  aria-label="Property"
                  value={rule.prop}
                  onChange={(event) => {
                    const nextType = propType(database, event.target.value) ?? 'text';
                    change({
                      prop: event.target.value,
                      op: filterOpsFor(nextType === 'title' ? 'text' : nextType)[0]!,
                      value: null,
                    });
                  }}
                >
                  {names.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select
                  className="text-input small"
                  aria-label="Condition"
                  value={rule.op}
                  onChange={(event) => change({ op: event.target.value as FilterOp })}
                >
                  {ops.map((op) => (
                    <option key={op} value={op}>
                      {FILTER_LABELS[op]}
                    </option>
                  ))}
                </select>
                {needsValue &&
                  (prop && (prop.type === 'select' || prop.type === 'multiSelect') ? (
                    <select
                      className="text-input small"
                      aria-label="Value"
                      value={String(rule.value ?? '')}
                      onChange={(event) => change({ value: event.target.value || null })}
                    >
                      <option value="">Choose</option>
                      {prop.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="text-input small"
                      aria-label="Value"
                      type={prop?.type === 'number' ? 'number' : prop?.type === 'date' ? 'date' : 'text'}
                      value={rule.value === null ? '' : String(rule.value)}
                      onChange={(event) =>
                        change({
                          value:
                            prop?.type === 'number' && event.target.value
                              ? Number(event.target.value)
                              : event.target.value,
                        })
                      }
                    />
                  ))}
                <button
                  type="button"
                  className="icon-button tiny"
                  aria-label="Remove filter"
                  onClick={() =>
                    updateView(dbId, view.id, (current) => ({
                      ...current,
                      filters: current.filters.filter((item) => item.id !== rule.id),
                    }))
                  }
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="link-button"
            onClick={() =>
              updateView(dbId, view.id, (current) => ({
                ...current,
                filters: [...current.filters, { id: newId(), prop: TITLE_PROP, op: 'contains', value: '' }],
              }))
            }
          >
            <Plus size={13} /> Add a filter
          </button>
        </Popover>
      )}
      {panel?.kind === 'sort' && (
        <Popover anchor={panel.anchor} onClose={() => setPanel(null)} label="Sorting" className="db-panel">
          {view.sorts.length === 0 && <p className="muted small">Rows keep the order you give them.</p>}
          {view.sorts.map((sort, index) => (
            <div key={`${sort.prop}-${index}`} className="db-rule">
              <select
                className="text-input small"
                aria-label="Sort by"
                value={sort.prop}
                onChange={(event) =>
                  updateView(dbId, view.id, (current) => ({
                    ...current,
                    sorts: current.sorts.map((item, i) =>
                      i === index ? { ...item, prop: event.target.value } : item,
                    ),
                  }))
                }
              >
                {[...names, { id: 'created', name: 'Created' }, { id: 'updated', name: 'Edited' }].map(
                  (item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ),
                )}
              </select>
              <select
                className="text-input small"
                aria-label="Direction"
                value={sort.dir}
                onChange={(event) =>
                  updateView(dbId, view.id, (current) => ({
                    ...current,
                    sorts: current.sorts.map((item, i) =>
                      i === index ? { ...item, dir: event.target.value === 'desc' ? 'desc' : 'asc' } : item,
                    ),
                  }))
                }
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <button
                type="button"
                className="icon-button tiny"
                aria-label="Remove sort"
                onClick={() =>
                  updateView(dbId, view.id, (current) => ({
                    ...current,
                    sorts: current.sorts.filter((_item, i) => i !== index),
                  }))
                }
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link-button"
            onClick={() =>
              updateView(dbId, view.id, (current) => ({
                ...current,
                sorts: [...current.sorts, { prop: TITLE_PROP, dir: 'asc' }],
              }))
            }
          >
            <Plus size={13} /> Add a sort
          </button>
        </Popover>
      )}
      {panel?.kind === 'layout' && (
        <Popover anchor={panel.anchor} onClose={() => setPanel(null)} label="Layout" className="db-panel">
          <label className="field">
            <span>{view.type === 'board' ? 'Group cards by' : 'Place rows by'}</span>
            <select
              className="text-input small"
              value={(view.type === 'board' ? view.groupBy : view.dateProp) ?? ''}
              onChange={(event) =>
                updateView(dbId, view.id, (current) =>
                  current.type === 'board'
                    ? { ...current, groupBy: event.target.value || null }
                    : { ...current, dateProp: event.target.value || null },
                )
              }
            >
              <option value="">None</option>
              {database.properties
                .filter((prop) =>
                  view.type === 'board'
                    ? ['select', 'multiSelect', 'checkbox'].includes(prop.type)
                    : prop.type === 'date',
                )
                .map((prop) => (
                  <option key={prop.id} value={prop.id}>
                    {prop.name}
                  </option>
                ))}
            </select>
          </label>
        </Popover>
      )}
      {panel?.kind === 'properties' && (
        <Popover anchor={panel.anchor} onClose={() => setPanel(null)} label="Properties" className="db-panel">
          <ul className="db-prop-list">
            {database.properties.map((prop) => {
              const hidden = view.hidden.includes(prop.id);
              return (
                <li key={prop.id}>
                  <span className="db-prop-name">{prop.name}</span>
                  <span className="muted small">{PROP_LABELS[prop.type]}</span>
                  <button
                    type="button"
                    className="icon-button tiny"
                    aria-label={hidden ? `Show ${prop.name}` : `Hide ${prop.name}`}
                    disabled={!editable}
                    onClick={() =>
                      updateView(dbId, view.id, (current) => ({
                        ...current,
                        hidden: hidden
                          ? current.hidden.filter((id) => id !== prop.id)
                          : [...current.hidden, prop.id],
                      }))
                    }
                  >
                    {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </li>
              );
            })}
          </ul>
          {editable && <NewProperty dbId={dbId} database={database} />}
          {editable && unclaimed.length > 0 && (
            <>
              <p className="db-panel-heading">In your pages</p>
              <ul className="db-prop-list">
                {unclaimed.map((key) => (
                  <li key={key}>
                    <span className="db-prop-name">{key}</span>
                    <button
                      type="button"
                      className="icon-button tiny"
                      aria-label={`Add ${key} as a column`}
                      title="Add as a column"
                      onClick={() => addColumnsFromPages(dbId, [key])}
                    >
                      <Plus size={13} />
                    </button>
                  </li>
                ))}
              </ul>
              {unclaimed.length > 1 && (
                <button
                  type="button"
                  className="button small"
                  onClick={() => addColumnsFromPages(dbId, unclaimed)}
                >
                  Add all as columns
                </button>
              )}
            </>
          )}
        </Popover>
      )}
    </div>
  );
}

// rename a property, change its type or options, or delete it
interface ViewProps {
  dbId: PageId;
  database: DatabaseDef;
  view: ViewDef;
  rows: PageMeta[];
  props: PropDef[];
  editable: boolean;
}

function RowTitle({ row, editable, autoFocus }: { row: PageMeta; editable: boolean; autoFocus?: boolean }) {
  return (
    <div className="db-title">
      <span className="tree-icon">
        <PageIcon page={row} />
      </span>
      <DraftInput
        type="text"
        label="Name"
        className="db-title-input"
        value={row.title}
        placeholder="Untitled"
        editable={editable}
        onCommit={(title) => run({ type: 'page.rename', id: row.id, title, now: Date.now() })}
      />
      {autoFocus && <FocusLast />}
      <button
        type="button"
        className="icon-button tiny db-open"
        aria-label={`Open ${displayTitle(row)}`}
        title="Open"
        onClick={() => openPage(row.id)}
      >
        <Maximize2 size={13} />
      </button>
    </div>
  );
}

// moves focus into the title of a row just added to a table
function FocusLast() {
  useEffect(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>('.db-table .db-title-input');
    inputs[inputs.length - 1]?.focus();
  }, []);
  return null;
}

const TITLE_WIDTH = 260;
const COLUMN_WIDTH = 180;

// drag a column's right edge to size it, a double click goes back to the usual width
function ColumnResizer({
  width,
  onResize,
  onDone,
  onReset,
}: {
  width: number;
  onResize: (width: number) => void;
  onDone: (width: number) => void;
  onReset: () => void;
}) {
  return (
    <span
      className="db-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to resize"
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        event.preventDefault();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const start = event.clientX;
        let next = width;
        const move = (moved: PointerEvent) => {
          next = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width + moved.clientX - start));
          onResize(next);
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          onDone(next);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      }}
    />
  );
}

function TableView({ dbId, database, view, rows, props, editable }: ViewProps) {
  const [header, setHeader] = useState<{ prop: PropDef; anchor: HTMLElement } | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [focusNew, setFocusNew] = useState<string | null>(null);
  // the width being dragged, saved to the view once the drag ends
  const [dragging, setDragging] = useState<{ key: string; width: number } | null>(null);
  const widthOf = (key: string) =>
    dragging?.key === key
      ? dragging.width
      : (view.widths?.[key] ?? (key === TITLE_PROP ? TITLE_WIDTH : COLUMN_WIDTH));
  const saveWidth = (key: string, width: number | null) => {
    setDragging(null);
    updateView(dbId, view.id, (current) => {
      const widths = { ...current.widths };
      if (width === null) delete widths[key];
      else widths[key] = width;
      return { ...current, widths };
    });
  };
  const resizer = (key: string) =>
    editable && (
      <ColumnResizer
        width={widthOf(key)}
        onResize={(width) => setDragging({ key, width })}
        onDone={(width) => saveWidth(key, width)}
        onReset={() => saveWidth(key, null)}
      />
    );
  const total =
    widthOf(TITLE_PROP) + props.reduce((sum, prop) => sum + widthOf(prop.id), 0) + (editable ? 36 : 0);
  return (
    <div className="db-table-wrap">
      <table className={`db-table${editable ? ' is-filled' : ''}`} style={{ width: total }}>
        <colgroup>
          <col style={{ width: widthOf(TITLE_PROP) }} />
          {props.map((prop) => (
            <col key={prop.id} style={{ width: widthOf(prop.id) }} />
          ))}
          {/* the add column takes whatever room is left, so the others keep the width they were given */}
          {editable && <col />}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="db-col-title">
              Name
              {resizer(TITLE_PROP)}
            </th>
            {props.map((prop) => (
              <th key={prop.id} scope="col">
                <button
                  type="button"
                  className="db-header"
                  disabled={!editable}
                  onClick={(event) => setHeader({ prop, anchor: event.currentTarget })}
                >
                  {prop.name}
                </button>
                {resizer(prop.id)}
              </th>
            ))}
            {editable && (
              <th className="db-col-add">
                <button
                  type="button"
                  className="icon-button tiny"
                  aria-label="Add a property"
                  onClick={(event) => setAdding(event.currentTarget)}
                >
                  <Plus size={13} />
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="db-col-title">
                <RowTitle row={row} editable={editable} autoFocus={focusNew === row.id} />
              </td>
              {props.map((prop) => (
                <td key={prop.id}>
                  <PropertyInput dbId={dbId} prop={prop} row={row} editable={editable} />
                </td>
              ))}
              {editable && <td />}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <button
          type="button"
          className="db-new-row"
          onClick={() => {
            const id = createRow(dbId);
            if (id) setFocusNew(id);
          }}
        >
          <Plus size={14} /> New
        </button>
      )}
      {header && (
        <PropertySettings
          dbId={dbId}
          database={database}
          prop={header.prop}
          view={view}
          anchor={header.anchor}
          onClose={() => setHeader(null)}
        />
      )}
      {adding && (
        <Popover anchor={adding} onClose={() => setAdding(null)} label="New property" className="db-panel">
          <NewProperty dbId={dbId} database={database} onDone={() => setAdding(null)} />
        </Popover>
      )}
    </div>
  );
}

function Card({
  row,
  props,
  database,
  cover,
}: {
  row: PageMeta;
  props: PropDef[];
  database: DatabaseDef;
  cover?: boolean;
}) {
  const state = useWorkspace();
  const [image, setImage] = useState<string | null>(null);
  const firstImage = useMemo(() => {
    if (!cover) return null;
    const doc = state.docs[row.id];
    const node = doc?.content?.find(
      (child) => child.type === 'image' && typeof child.attrs?.fileId === 'string',
    );
    return node ? String(node.attrs!.fileId) : null;
  }, [cover, state.docs, row.id]);
  const progress = useMemo(() => taskProgress(state.docs[row.id]), [state.docs, row.id]);
  useEffect(() => {
    let live = true;
    if (firstImage) void fileUrl(firstImage).then((url) => live && setImage(url));
    return () => {
      live = false;
    };
  }, [firstImage]);
  return (
    <button type="button" className="db-card" onClick={() => openPage(row.id)}>
      {cover && (
        <span className="db-cover">
          {image ? <img src={image} alt="" /> : <span className="db-cover-empty" />}
        </span>
      )}
      <span className="db-card-title">
        {row.icon && <Emoji emoji={row.icon} className="db-card-icon" />}
        {displayTitle(row)}
      </span>
      <span className="db-card-props">
        {props.map((prop) => (
          <PropertyDisplay key={prop.id} prop={prop} value={valueOf(row, prop.id, database)} />
        ))}
      </span>
      {progress.total > 0 && (
        <span className="db-progress" title={`${progress.done} of ${progress.total} tasks done`}>
          <span className="db-progress-bar">
            <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </span>
          <span className="db-progress-label">
            {progress.done}/{progress.total}
          </span>
        </span>
      )}
    </button>
  );
}

// how many of the checklist items in a page are ticked
function taskProgress(doc: DocNode | undefined): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const visit = (node: DocNode) => {
    if (node.type === 'taskItem') {
      total++;
      if (node.attrs?.checked === true) done++;
    }
    for (const child of node.content ?? []) visit(child);
  };
  if (doc) visit(doc);
  return { done, total };
}

const DRAG = 'application/x-morrow-row';

function BoardView({ dbId, database, view, rows, props, editable }: ViewProps) {
  const prop = database.properties.find((candidate) => candidate.id === view.groupBy);
  // an empty column for rows without a value only adds noise
  const groups = groupRows(rows, view.groupBy, database).filter(
    (group) => group.key !== null || group.rows.length > 0,
  );
  const [over, setOver] = useState<string | null>(null);
  if (!prop)
    return (
      <p className="muted db-hint">Choose a select or checkbox property to group cards by, under Group.</p>
    );
  const shown = props.filter((item) => item.id !== prop.id);
  const valueFor = (key: string | null): PropValue => {
    if (prop.type === 'checkbox') return key === 'true';
    if (key === null) return null;
    return prop.type === 'multiSelect' ? [key] : key;
  };
  return (
    <div className="db-board">
      {groups.map((group) => {
        const key = group.key ?? '__none';
        return (
          <section
            key={key}
            className={`db-column color-${group.color ?? 'gray'}${over === key ? ' is-over' : ''}`}
            aria-label={group.label}
            onDragOver={(event) => {
              if (!editable || !event.dataTransfer.types.includes(DRAG)) return;
              event.preventDefault();
              setOver(key);
            }}
            onDragLeave={() => setOver((current) => (current === key ? null : current))}
            onDrop={(event) => {
              setOver(null);
              const id = event.dataTransfer.getData(DRAG);
              if (id) setValue(id, prop.id, valueFor(group.key));
            }}
          >
            <header className="db-column-head">
              <span className="db-column-dot" aria-hidden="true" />
              <Chip option={{ name: group.label, color: group.color }} />
              <span className="muted small">{group.rows.length}</span>
            </header>
            {group.rows.map((row) => (
              <div
                key={row.id}
                draggable={editable}
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG, row.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
              >
                <Card row={row} props={shown} database={database} />
              </div>
            ))}
            {editable && (
              <button
                type="button"
                className="db-new-row"
                onClick={() => newRowAndOpen(dbId, { [prop.id]: valueFor(group.key) })}
              >
                <Plus size={13} /> New
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function CalendarView({ dbId, database, view, rows, editable }: Omit<ViewProps, 'props'>) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [over, setOver] = useState<string | null>(null);
  const prop = database.properties.find((candidate) => candidate.id === view.dateProp);
  if (!prop) return <p className="muted db-hint">Choose a date property to place rows by, under Date.</p>;
  // weeks start on monday
  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
  const byDay = new Map<string, PageMeta[]>();
  for (const row of rows) {
    const value = row.properties[prop.id];
    if (typeof value === 'string') byDay.set(value, [...(byDay.get(value) ?? []), row]);
  }
  const today = dateKey(new Date());
  const shift = (delta: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  return (
    <div className="db-calendar">
      <header className="db-calendar-head">
        <h3>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
        <button
          type="button"
          className="icon-button small"
          aria-label="Previous month"
          onClick={() => shift(-1)}
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
        >
          Today
        </button>
        <button type="button" className="icon-button small" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight size={15} />
        </button>
      </header>
      <div className="db-calendar-grid" role="grid">
        {days.slice(0, 7).map((day) => (
          <div key={day.toISOString()} className="db-weekday" role="columnheader">
            {day.toLocaleDateString(undefined, { weekday: 'short' })}
          </div>
        ))}
        {days.map((day) => {
          const key = dateKey(day);
          const inMonth = day.getMonth() === month.getMonth();
          return (
            <div
              key={key}
              role="gridcell"
              className={`db-day${inMonth ? '' : ' is-outside'}${key === today ? ' is-today' : ''}${over === key ? ' is-over' : ''}`}
              onDragOver={(event) => {
                if (!editable || !event.dataTransfer.types.includes(DRAG)) return;
                event.preventDefault();
                setOver(key);
              }}
              onDragLeave={() => setOver((current) => (current === key ? null : current))}
              onDrop={(event) => {
                setOver(null);
                const id = event.dataTransfer.getData(DRAG);
                if (id) setValue(id, prop.id, key);
              }}
            >
              <span className="db-day-number">{day.getDate()}</span>
              {(byDay.get(key) ?? []).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="db-event"
                  draggable={editable}
                  onDragStart={(event) => event.dataTransfer.setData(DRAG, row.id)}
                  onClick={() => openPage(row.id)}
                >
                  {displayTitle(row)}
                </button>
              ))}
              {editable && (
                <button
                  type="button"
                  className="db-day-add"
                  aria-label={`New row on ${day.toLocaleDateString()}`}
                  onClick={() => newRowAndOpen(dbId, { [prop.id]: key })}
                >
                  <Plus size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ rows, props, database }: { rows: PageMeta[]; props: PropDef[]; database: DatabaseDef }) {
  return (
    <ul className="link-list db-list">
      {rows.map((row) => (
        <li key={row.id}>
          <button type="button" className="link-row" onClick={() => openPage(row.id)}>
            <span className="tree-icon">
              <PageIcon page={row} />
            </span>
            <span className="link-row-title">{displayTitle(row)}</span>
            <span className="db-card-props">
              {props.map((prop) => (
                <PropertyDisplay key={prop.id} prop={prop} value={valueOf(row, prop.id, database)} />
              ))}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function GalleryView({
  rows,
  props,
  database,
}: {
  rows: PageMeta[];
  props: PropDef[];
  database: DatabaseDef;
}) {
  return (
    <div className="db-gallery">
      {rows.map((row) => (
        <Card key={row.id} row={row} props={props} database={database} cover />
      ))}
    </div>
  );
}
