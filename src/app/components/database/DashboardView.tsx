import { Check, Columns2, Pencil, Plus, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { groupRows, rowsByMonth, widgetNumber } from '../../../core/database';
import { WIDGET_KINDS } from '../../../core/model';
import type { DatabaseDef, PageId, PageMeta, ViewDef, Widget, WidgetKind } from '../../../core/model';
import { dateLocale, t } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import { newId } from '../../platform/files';
import { updateView } from './data';

const NUMBER_KINDS: readonly WidgetKind[] = ['count', 'sum', 'average', 'min', 'max'];
const CHART_KINDS: readonly WidgetKind[] = ['bar', 'hbar', 'donut'];

// the properties a tile of each kind can use: numbers to add up, a choice to count by, a date to follow
function propsFor(kind: WidgetKind, database: DatabaseDef) {
  if (kind === 'count') return [];
  if (NUMBER_KINDS.includes(kind)) return database.properties.filter((prop) => prop.type === 'number');
  if (kind === 'line') return database.properties.filter((prop) => prop.type === 'date');
  return database.properties.filter((prop) => ['select', 'multiSelect', 'checkbox'].includes(prop.type));
}

const kindLabel = (kind: WidgetKind) => t(`database.widgets.${kind}` as TranslationKey);

function formatNumber(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString(dateLocale(), { maximumFractionDigits: 2 });
}

// a database's rows summed up: numbers worked out from them and charts of them by a property, in a grid.
// the view's filters narrow every tile at once. edit shows each tile's settings, done puts them away
export function DashboardView({
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
  const widgets = view.widgets ?? [];
  const [editing, setEditing] = useState(widgets.length === 0);
  const change = (id: string, patch: Partial<Widget> | null) =>
    updateView(dbId, view.id, (current) => ({
      ...current,
      widgets: (current.widgets ?? []).flatMap((widget) =>
        widget.id !== id ? [widget] : patch === null ? [] : [{ ...widget, ...patch }],
      ),
    }));
  const add = () =>
    updateView(dbId, view.id, (current) => ({
      ...current,
      widgets: [...(current.widgets ?? []), { id: newId(), kind: 'count', prop: null }],
    }));
  return (
    <div className="dashboard">
      {editable && (
        <div className="dashboard-bar">
          {editing && (
            <button type="button" className="button small" onClick={add}>
              <Plus size={14} /> {t('database.addWidget')}
            </button>
          )}
          <button type="button" className="button small" onClick={() => setEditing(!editing)}>
            {editing ? <Check size={14} /> : <Pencil size={14} />}{' '}
            {editing ? t('database.done') : t('database.edit')}
          </button>
        </div>
      )}
      {widgets.length === 0 && !editing && <p className="muted db-hint">{t('database.dashboardEmpty')}</p>}
      <div className="dashboard-grid">
        {widgets.map((widget) => (
          <section key={widget.id} className={`dashboard-tile${widget.wide ? ' is-wide' : ''}`}>
            <h3 className="dashboard-title">{tileTitle(widget, database)}</h3>
            <WidgetBody widget={widget} database={database} rows={rows} />
            {editing && editable && (
              <div className="dashboard-edit">
                <select
                  className="text-input small"
                  aria-label={t('database.widgetKind')}
                  value={widget.kind}
                  onChange={(event) => {
                    const kind = event.target.value as WidgetKind;
                    const options = propsFor(kind, database);
                    change(widget.id, {
                      kind,
                      prop: options.some((prop) => prop.id === widget.prop)
                        ? widget.prop
                        : (options[0]?.id ?? null),
                    });
                  }}
                >
                  {WIDGET_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kindLabel(kind)}
                    </option>
                  ))}
                </select>
                {widget.kind !== 'count' && (
                  <select
                    className="text-input small"
                    aria-label={t('database.widgetProperty')}
                    value={widget.prop ?? ''}
                    onChange={(event) => change(widget.id, { prop: event.target.value || null })}
                  >
                    {widget.kind === 'line' && <option value="">{t('database.created')}</option>}
                    {propsFor(widget.kind, database).map((prop) => (
                      <option key={prop.id} value={prop.id}>
                        {prop.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="icon-button small"
                  aria-label={widget.wide ? t('database.widgetNarrow') : t('database.widgetWide')}
                  title={widget.wide ? t('database.widgetNarrow') : t('database.widgetWide')}
                  onClick={() => change(widget.id, { wide: !widget.wide })}
                >
                  {widget.wide ? <Square size={14} /> : <Columns2 size={14} />}
                </button>
                <button
                  type="button"
                  className="icon-button small"
                  aria-label={t('database.removeWidget')}
                  title={t('database.removeWidget')}
                  onClick={() => change(widget.id, null)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function tileTitle(widget: Widget, database: DatabaseDef): string {
  if (widget.title) return widget.title;
  const prop = database.properties.find((item) => item.id === widget.prop);
  if (widget.kind === 'count') return t('database.widgets.count');
  if (widget.kind === 'line')
    return t('database.widgetByMonth', { name: prop?.name ?? t('database.created') });
  return prop
    ? t('database.widgetOf', { kind: kindLabel(widget.kind), name: prop.name })
    : kindLabel(widget.kind);
}

function WidgetBody({ widget, database, rows }: { widget: Widget; database: DatabaseDef; rows: PageMeta[] }) {
  if (NUMBER_KINDS.includes(widget.kind))
    return <p className="dashboard-number">{formatNumber(widgetNumber(widget, rows))}</p>;
  if (widget.kind === 'line') return <LineChart points={rowsByMonth(rows, widget.prop)} />;
  if (!CHART_KINDS.includes(widget.kind)) return null;
  const prop = database.properties.find((item) => item.id === widget.prop);
  if (!prop) return <p className="muted small">{t('database.widgetPick')}</p>;
  const slices = groupRows(rows, prop.id, database)
    .map((group) => ({ label: group.label, color: group.color, value: group.rows.length }))
    .filter((slice) => slice.value > 0);
  if (slices.length === 0) return <p className="muted small">{t('database.widgetNothing')}</p>;
  if (widget.kind === 'donut') return <Donut slices={slices} />;
  return <Bars slices={slices} horizontal={widget.kind === 'hbar'} />;
}

interface Slice {
  label: string;
  color: string;
  value: number;
}

function Bars({ slices, horizontal }: { slices: Slice[]; horizontal: boolean }) {
  const most = Math.max(...slices.map((slice) => slice.value), 1);
  if (horizontal)
    return (
      <ul className="dashboard-hbars">
        {slices.map((slice) => (
          <li key={slice.label}>
            <span className="dashboard-label">{slice.label}</span>
            <span className="dashboard-hbar-track">
              <span
                className="dashboard-hbar"
                style={{
                  width: `${(slice.value / most) * 100}%`,
                  background: `var(--c-${slice.color}-text)`,
                }}
              />
            </span>
            <span className="dashboard-value">{slice.value}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <div
      className="dashboard-bars"
      role="img"
      aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}
    >
      {slices.map((slice) => (
        <div key={slice.label} className="dashboard-bar-col">
          <span className="dashboard-value">{slice.value}</span>
          <span
            className="dashboard-bar"
            style={{ height: `${(slice.value / most) * 100}%`, background: `var(--c-${slice.color}-text)` }}
          />
          <span className="dashboard-label">{slice.label}</span>
        </div>
      ))}
    </div>
  );
}

function Donut({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 40;
  const length = 2 * Math.PI * radius;
  // where each slice starts around the ring, the parts before it added up
  const parts = slices.map((slice) => (slice.value / total) * length);
  const starts = parts.map((_part, index) => parts.slice(0, index).reduce((sum, part) => sum + part, 0));
  return (
    <div className="dashboard-donut">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}
      >
        {slices.map((slice, index) => {
          const part = parts[index]!;
          return (
            <circle
              key={slice.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={`var(--c-${slice.color}-text)`}
              strokeWidth="14"
              strokeDasharray={`${part} ${length - part}`}
              strokeDashoffset={-starts[index]!}
              transform="rotate(-90 50 50)"
            />
          );
        })}
        <text x="50" y="55" textAnchor="middle" className="dashboard-donut-total">
          {total}
        </text>
      </svg>
      <ul className="dashboard-legend">
        {slices.map((slice) => (
          <li key={slice.label}>
            <span className="dashboard-dot" style={{ background: `var(--c-${slice.color}-text)` }} />
            {slice.label} <span className="dashboard-value">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineChart({ points }: { points: Array<{ month: string; count: number }> }) {
  const most = Math.max(...points.map((point) => point.count), 1);
  const width = 300;
  const height = 100;
  const x = (index: number) => (index / Math.max(1, points.length - 1)) * (width - 20) + 10;
  const y = (value: number) => height - 14 - (value / most) * (height - 28);
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index)} ${y(point.count)}`).join(' ');
  const month = (key: string) =>
    new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString(dateLocale(), {
      month: 'short',
    });
  return (
    <svg
      className="dashboard-line"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={points.map((point) => `${month(point.month)} ${point.count}`).join(', ')}
    >
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {points.map((point, index) => (
        <g key={point.month}>
          <circle cx={x(index)} cy={y(point.count)} r="2.5" fill="var(--accent)">
            <title>{`${month(point.month)}: ${point.count}`}</title>
          </circle>
          {index % 2 === 0 && (
            <text x={x(index)} y={height - 2} textAnchor="middle" className="dashboard-axis">
              {month(point.month)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
