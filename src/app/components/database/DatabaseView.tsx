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
  convertValue,
  filterOpsFor,
  FILTER_LABELS,
  groupRows,
  optionsFromValues,
  PROP_LABELS,
  propType,
  rowsOf,
  TITLE_PROP,
  VIEW_LABELS,
  visibleRows,
  newView,
} from '../../../core/database';
import { displayTitle, PROP_TYPES, VIEW_TYPES } from '../../../core/model';
import type { Command } from '../../../core/commands';
import type {
  DatabaseDef,
  FilterOp,
  PageId,
  PageMeta,
  PropDef,
  PropType,
  PropValue,
  ViewDef,
  ViewType,
} from '../../../core/model';
import { reservedPropertyName } from '../../../core/vault/pageFile';
import { fileUrl } from '../../platform/attachments';
import { newId } from '../../platform/files';
import { openPage } from '../../router';
import { toast } from '../../ui';
import { run, runAll, useWorkspace } from '../../workspace';
import { Menu } from '../Menu';
import { Popover } from '../Popover';
import { PageIcon } from '../Sidebar';
import { createRow, setValue, updateDatabase, updateProp, updateView } from './data';
import { Chip, DraftInput, NewProperty, PropertyDisplay, PropertyInput } from './PropertyValue';

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
  const rows = useMemo(() => (view ? visibleRows(allRows, view, database) : allRows), [allRows, view, database]);
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
                onDoubleClick={(event) => editable && setTabMenu({ view: candidate, anchor: event.currentTarget })}
              >
                <Icon size={14} /> {candidate.name || VIEW_LABELS[candidate.type]}
              </button>
            );
          })}
          {editable && (
            <button type="button" className="icon-button small" aria-label="Add a view" onClick={(event) => setAddMenu(event.currentTarget)}>
              <Plus size={14} />
            </button>
          )}
        </div>
        <Toolbar dbId={page.id} database={database} view={view} editable={editable} />
      </div>

      {view.type === 'table' && <TableView dbId={page.id} database={database} view={view} rows={rows} props={visible} editable={editable} />}
      {view.type === 'board' && <BoardView dbId={page.id} database={database} view={view} rows={rows} props={visible} editable={editable} />}
      {view.type === 'calendar' && <CalendarView dbId={page.id} database={database} view={view} rows={rows} editable={editable} />}
      {view.type === 'list' && <ListView rows={rows} props={visible} />}
      {view.type === 'gallery' && <GalleryView rows={rows} props={visible} />}
      {view.type !== 'table' && editable && (
        <button type="button" className="db-new-row" onClick={() => newRowAndOpen(page.id, {})}>
          <Plus size={14} /> New
        </button>
      )}
      <p className="db-count muted small">
        {rows.length === allRows.length ? `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}` : `${rows.length} of ${allRows.length} rows`}
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
              if (updateDatabase(page.id, (current) => ({ ...current, views: [...current.views, created] }))) choose(created.id);
            },
          }))}
        />
      )}
      {tabMenu && (
        <ViewSettings dbId={page.id} database={database} view={tabMenu.view} anchor={tabMenu.anchor} onClose={() => setTabMenu(null)} />
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
          onCommit={(name) => updateView(dbId, view.id, (current) => ({ ...current, name: name.trim() || VIEW_LABELS[current.type] }))}
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
              return { ...current, type, groupBy: current.groupBy ?? fresh.groupBy, dateProp: current.dateProp ?? fresh.dateProp };
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
            updateDatabase(dbId, (current) => ({ ...current, views: [...current.views, { ...view, id: newId(), name: `${view.name} copy` }] }));
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
            updateDatabase(dbId, (current) => ({ ...current, views: current.views.filter((candidate) => candidate.id !== view.id) }));
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

function Toolbar({ dbId, database, view, editable }: { dbId: PageId; database: DatabaseDef; view: ViewDef; editable: boolean }) {
  const [panel, setPanel] = useState<{ kind: ToolPanel; anchor: HTMLElement } | null>(null);
  const open = (kind: ToolPanel) => (event: React.MouseEvent<HTMLElement>) => setPanel({ kind, anchor: event.currentTarget });
  const names = [{ id: TITLE_PROP, name: 'Name', type: 'text' as const }, ...database.properties];
  return (
    <div className="db-tools">
      <button type="button" className={`text-tool${view.filters.length ? ' is-active' : ''}`} onClick={open('filter')} disabled={!editable}>
        <Filter size={13} /> Filter{view.filters.length ? ` ${view.filters.length}` : ''}
      </button>
      <button type="button" className={`text-tool${view.sorts.length ? ' is-active' : ''}`} onClick={open('sort')} disabled={!editable}>
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
          {view.filters.length === 0 && <p className="muted small">No filters. Rows that match every filter are shown.</p>}
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
                <select className="text-input small" aria-label="Property" value={rule.prop} onChange={(event) => {
                  const nextType = propType(database, event.target.value) ?? 'text';
                  change({ prop: event.target.value, op: filterOpsFor(nextType === 'title' ? 'text' : nextType)[0]!, value: null });
                }}>
                  {names.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <select className="text-input small" aria-label="Condition" value={rule.op} onChange={(event) => change({ op: event.target.value as FilterOp })}>
                  {ops.map((op) => (
                    <option key={op} value={op}>
                      {FILTER_LABELS[op]}
                    </option>
                  ))}
                </select>
                {needsValue &&
                  (prop && (prop.type === 'select' || prop.type === 'multiSelect') ? (
                    <select className="text-input small" aria-label="Value" value={String(rule.value ?? '')} onChange={(event) => change({ value: event.target.value || null })}>
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
                      onChange={(event) => change({ value: prop?.type === 'number' && event.target.value ? Number(event.target.value) : event.target.value })}
                    />
                  ))}
                <button
                  type="button"
                  className="icon-button tiny"
                  aria-label="Remove filter"
                  onClick={() => updateView(dbId, view.id, (current) => ({ ...current, filters: current.filters.filter((item) => item.id !== rule.id) }))}
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
              updateView(dbId, view.id, (current) => ({ ...current, filters: [...current.filters, { id: newId(), prop: TITLE_PROP, op: 'contains', value: '' }] }))
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
                  updateView(dbId, view.id, (current) => ({ ...current, sorts: current.sorts.map((item, i) => (i === index ? { ...item, prop: event.target.value } : item)) }))
                }
              >
                {[...names, { id: 'created', name: 'Created' }, { id: 'updated', name: 'Edited' }].map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                className="text-input small"
                aria-label="Direction"
                value={sort.dir}
                onChange={(event) =>
                  updateView(dbId, view.id, (current) => ({
                    ...current,
                    sorts: current.sorts.map((item, i) => (i === index ? { ...item, dir: event.target.value === 'desc' ? 'desc' : 'asc' } : item)),
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
                onClick={() => updateView(dbId, view.id, (current) => ({ ...current, sorts: current.sorts.filter((_item, i) => i !== index) }))}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link-button"
            onClick={() => updateView(dbId, view.id, (current) => ({ ...current, sorts: [...current.sorts, { prop: TITLE_PROP, dir: 'asc' }] }))}
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
                  current.type === 'board' ? { ...current, groupBy: event.target.value || null } : { ...current, dateProp: event.target.value || null },
                )
              }
            >
              <option value="">None</option>
              {database.properties
                .filter((prop) => (view.type === 'board' ? ['select', 'multiSelect', 'checkbox'].includes(prop.type) : prop.type === 'date'))
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
                        hidden: hidden ? current.hidden.filter((id) => id !== prop.id) : [...current.hidden, prop.id],
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
        </Popover>
      )}
    </div>
  );
}

// rename a property, change its type or options, or delete it
function PropertySettings({
  dbId,
  database,
  prop,
  view,
  anchor,
  onClose,
}: {
  dbId: PageId;
  database: DatabaseDef;
  prop: PropDef;
  view: ViewDef;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const state = useWorkspace();
  const changeType = (type: PropType) => {
    if (type === prop.type) return;
    const rows = rowsOf(state, dbId);
    const options =
      type === 'select' || type === 'multiSelect'
        ? prop.type === 'select' || prop.type === 'multiSelect'
          ? prop.options
          : optionsFromValues(prop, rows.map((row) => row.properties[prop.id] ?? null), newId)
        : [];
    const next: PropDef = { ...prop, type, options };
    const commands: Command[] = [
      { type: 'database.set', id: dbId, now: Date.now(), database: { ...database, properties: database.properties.map((item) => (item.id === prop.id ? next : item)) } },
      ...rows.map<Command>((row) => ({
        type: 'page.setProperties',
        id: row.id,
        now: Date.now(),
        values: { [prop.id]: convertValue(prop, next, row.properties[prop.id] ?? null) },
      })),
    ];
    runAll(commands);
  };
  return (
    <Popover anchor={anchor} onClose={onClose} label={`Property ${prop.name}`} className="db-panel">
      <label className="field">
        <span>Name</span>
        <DraftInput
          type="text"
          label="Property name"
          className="text-input small"
          value={prop.name}
          editable
          onCommit={(name) => {
            const clean = name.trim();
            if (!clean || reservedPropertyName(clean) || database.properties.some((item) => item.id !== prop.id && item.name.toLowerCase() === clean.toLowerCase())) {
              toast('That name is empty or already used.', { tone: 'error' });
              return;
            }
            updateProp(dbId, prop.id, (current) => ({ ...current, name: clean }));
          }}
        />
      </label>
      <label className="field">
        <span>Type</span>
        <select className="text-input small" value={prop.type} onChange={(event) => changeType(event.target.value as PropType)}>
          {PROP_TYPES.map((item) => (
            <option key={item} value={item}>
              {PROP_LABELS[item]}
            </option>
          ))}
        </select>
      </label>
      {(prop.type === 'select' || prop.type === 'multiSelect') && (
        <ul className="db-prop-list">
          {prop.options.map((option) => (
            <li key={option.id}>
              <DraftInput
                type="text"
                label="Option name"
                className="text-input small"
                value={option.name}
                editable
                onCommit={(name) =>
                  name.trim() &&
                  updateProp(dbId, prop.id, (current) => ({
                    ...current,
                    options: current.options.map((item) => (item.id === option.id ? { ...item, name: name.trim() } : item)),
                  }))
                }
              />
              <select
                className="text-input small color-select"
                aria-label="Colour"
                value={option.color}
                onChange={(event) =>
                  updateProp(dbId, prop.id, (current) => ({
                    ...current,
                    options: current.options.map((item) => (item.id === option.id ? { ...item, color: event.target.value as typeof option.color } : item)),
                  }))
                }
              >
                {(['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const).map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button tiny"
                aria-label={`Delete option ${option.name}`}
                onClick={() => updateProp(dbId, prop.id, (current) => ({ ...current, options: current.options.filter((item) => item.id !== option.id) }))}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="popover-actions">
        <button
          type="button"
          className="button small"
          onClick={() => {
            updateView(dbId, view.id, (current) => ({ ...current, sorts: [{ prop: prop.id, dir: 'asc' }] }));
            onClose();
          }}
        >
          Sort ascending
        </button>
        <button
          type="button"
          className="button small"
          onClick={() => {
            updateView(dbId, view.id, (current) => ({ ...current, hidden: [...current.hidden, prop.id] }));
            onClose();
          }}
        >
          <EyeOff size={13} /> Hide
        </button>
        <button
          type="button"
          className="button small danger"
          onClick={() => {
            updateDatabase(dbId, (current) => ({
              properties: current.properties.filter((item) => item.id !== prop.id),
              views: current.views.map((item) => ({
                ...item,
                filters: item.filters.filter((rule) => rule.prop !== prop.id),
                sorts: item.sorts.filter((sort) => sort.prop !== prop.id),
                hidden: item.hidden.filter((id) => id !== prop.id),
                groupBy: item.groupBy === prop.id ? null : item.groupBy,
                dateProp: item.dateProp === prop.id ? null : item.dateProp,
              })),
            }));
            onClose();
          }}
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </Popover>
  );
}

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
      <button type="button" className="icon-button tiny db-open" aria-label={`Open ${displayTitle(row)}`} title="Open" onClick={() => openPage(row.id)}>
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

function TableView({ dbId, database, view, rows, props, editable }: ViewProps) {
  const [header, setHeader] = useState<{ prop: PropDef; anchor: HTMLElement } | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [focusNew, setFocusNew] = useState<string | null>(null);
  return (
    <div className="db-table-wrap">
      <table className="db-table">
        <thead>
          <tr>
            <th scope="col" className="db-col-title">
              Name
            </th>
            {props.map((prop) => (
              <th key={prop.id} scope="col">
                <button type="button" className="db-header" disabled={!editable} onClick={(event) => setHeader({ prop, anchor: event.currentTarget })}>
                  {prop.name}
                </button>
              </th>
            ))}
            {editable && (
              <th className="db-col-add">
                <button type="button" className="icon-button tiny" aria-label="Add a property" onClick={(event) => setAdding(event.currentTarget)}>
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
        <PropertySettings dbId={dbId} database={database} prop={header.prop} view={view} anchor={header.anchor} onClose={() => setHeader(null)} />
      )}
      {adding && (
        <Popover anchor={adding} onClose={() => setAdding(null)} label="New property" className="db-panel">
          <NewProperty dbId={dbId} database={database} onDone={() => setAdding(null)} />
        </Popover>
      )}
    </div>
  );
}

function Card({ row, props, cover }: { row: PageMeta; props: PropDef[]; cover?: boolean }) {
  const state = useWorkspace();
  const [image, setImage] = useState<string | null>(null);
  const firstImage = useMemo(() => {
    if (!cover) return null;
    const doc = state.docs[row.id];
    const node = doc?.content?.find((child) => child.type === 'image' && typeof child.attrs?.fileId === 'string');
    return node ? String(node.attrs!.fileId) : null;
  }, [cover, state.docs, row.id]);
  useEffect(() => {
    let live = true;
    if (firstImage) void fileUrl(firstImage).then((url) => live && setImage(url));
    return () => {
      live = false;
    };
  }, [firstImage]);
  return (
    <button type="button" className="db-card" onClick={() => openPage(row.id)}>
      {cover && <span className="db-cover">{image ? <img src={image} alt="" /> : <span className="db-cover-empty" />}</span>}
      <span className="db-card-title">
        {row.icon && <span className="db-card-icon">{row.icon}</span>}
        {displayTitle(row)}
      </span>
      <span className="db-card-props">
        {props.map((prop) => (
          <PropertyDisplay key={prop.id} prop={prop} value={row.properties[prop.id] ?? null} />
        ))}
      </span>
    </button>
  );
}

const DRAG = 'application/x-morrow-row';

function BoardView({ dbId, database, view, rows, props, editable }: ViewProps) {
  const prop = database.properties.find((candidate) => candidate.id === view.groupBy);
  const groups = groupRows(rows, view.groupBy, database);
  const [over, setOver] = useState<string | null>(null);
  if (!prop) return <p className="muted db-hint">Choose a select or checkbox property to group cards by, under Group.</p>;
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
            className={`db-column${over === key ? ' is-over' : ''}`}
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
                <Card row={row} props={shown} />
              </div>
            ))}
            {editable && (
              <button type="button" className="db-new-row" onClick={() => newRowAndOpen(dbId, { [prop.id]: valueFor(group.key) })}>
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
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
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
        <button type="button" className="icon-button small" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" className="button small" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
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
                <button type="button" className="db-day-add" aria-label={`New row on ${day.toLocaleDateString()}`} onClick={() => newRowAndOpen(dbId, { [prop.id]: key })}>
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

function ListView({ rows, props }: { rows: PageMeta[]; props: PropDef[] }) {
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
                <PropertyDisplay key={prop.id} prop={prop} value={row.properties[prop.id] ?? null} />
              ))}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function GalleryView({ rows, props }: { rows: PageMeta[]; props: PropDef[] }) {
  return (
    <div className="db-gallery">
      {rows.map((row) => (
        <Card key={row.id} row={row} props={props} cover />
      ))}
    </div>
  );
}

