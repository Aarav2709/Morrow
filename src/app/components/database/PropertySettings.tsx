import { EyeOff, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { Command } from '../../../core/commands';
import {
  convertValue,
  formatValue,
  formulaResult,
  optionsFromValues,
  PROP_LABELS,
  rowsOf,
} from '../../../core/database';
import { COLORS, PROP_TYPES } from '../../../core/model';
import type { ColorName, DatabaseDef, PageId, PropDef, PropType, ViewDef } from '../../../core/model';
import { reservedPropertyName } from '../../../core/vault/pageFile';
import { COLOR_LABELS } from '../../editor/EditorMenus';
import { newId } from '../../platform/files';
import { toast } from '../../ui';
import { runAll, useWorkspace } from '../../workspace';
import { Popover } from '../Popover';
import { Select } from '../Select';
import { updateDatabase, updateProp, updateView } from './data';
import { DraftInput } from './PropertyValue';
import { t } from '../../i18n';

// rename a property, change its type, options or how it shows. opened from a column, or from a page's
// properties, where there is no view to sort or hide in
export function PropertySettings({
  dbId,
  database,
  prop: opened,
  view,
  anchor,
  onClose,
}: {
  dbId: PageId;
  database: DatabaseDef;
  prop: PropDef;
  view?: ViewDef;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const state = useWorkspace();
  // the panel stays open while the property changes, so it reads the latest version of it
  const prop = database.properties.find((item) => item.id === opened.id) ?? opened;
  const changeType = (type: PropType) => {
    if (type === prop.type) return;
    const rows = rowsOf(state, dbId);
    const options =
      type === 'select' || type === 'multiSelect'
        ? prop.type === 'select' || prop.type === 'multiSelect'
          ? prop.options
          : optionsFromValues(
              prop,
              rows.map((row) => row.properties[prop.id] ?? null),
              newId,
            )
        : [];
    const next: PropDef = { ...prop, type, options };
    const commands: Command[] = [
      {
        type: 'database.set',
        id: dbId,
        now: Date.now(),
        database: {
          ...database,
          properties: database.properties.map((item) => (item.id === prop.id ? next : item)),
        },
      },
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
    <Popover
      anchor={anchor}
      onClose={onClose}
      label={t('database.propertyAria', { name: prop.name })}
      className={`db-panel${prop.type === 'formula' ? ' is-wide' : ''}`}
    >
      <label className="field">
        <span>{t('database.name')}</span>
        <DraftInput
          type="text"
          label={t('page.propertyNamePlaceholder')}
          className="text-input small"
          value={prop.name}
          editable
          onCommit={(name) => {
            const clean = name.trim();
            if (
              !clean ||
              reservedPropertyName(clean) ||
              database.properties.some(
                (item) => item.id !== prop.id && item.name.toLowerCase() === clean.toLowerCase(),
              )
            ) {
              toast(t('toasts.propNameEmptyOrUsed'), { tone: 'error' });
              return;
            }
            updateProp(dbId, prop.id, (current) => ({ ...current, name: clean }));
          }}
        />
      </label>
      <div className="field">
        <span>{t('database.type')}</span>
        <Select<PropType>
          label={t('database.type')}
          value={prop.type}
          options={PROP_TYPES.map((item) => ({ value: item, label: PROP_LABELS[item] }))}
          onChange={changeType}
        />
      </div>
      {(prop.type === 'number' || prop.type === 'formula') && (
        <div className="field">
          <span>{t('database.showAs')}</span>
          <div className="segmented" role="radiogroup" aria-label={t('database.showAs')}>
            {(
              [
                [undefined, 'Number'],
                ['bar', 'Progress bar'],
              ] as const
            ).map(([display, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={prop.display === display}
                className={prop.display === display ? 'is-active' : ''}
                onClick={() =>
                  updateProp(dbId, prop.id, (current) => {
                    const { display: _old, ...rest } = current;
                    return display ? { ...rest, display } : rest;
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          {prop.display === 'bar' && (
            <label className="field-inline">
              <span>{t('database.outOf')}</span>
              <DraftInput
                type="number"
                label={t('database.outOf')}
                className="text-input small"
                value={String(prop.max ?? 100)}
                editable
                onCommit={(text) => {
                  const max = Number(text);
                  if (Number.isFinite(max) && max > 0)
                    updateProp(dbId, prop.id, (current) => ({ ...current, max }));
                }}
              />
            </label>
          )}
        </div>
      )}
      {prop.type === 'formula' && <FormulaField dbId={dbId} prop={prop} database={database} />}
      {(prop.type === 'select' || prop.type === 'multiSelect') && (
        <ul className="db-prop-list">
          {prop.options.map((option) => (
            <li key={option.id}>
              <DraftInput
                type="text"
                label={t('database.optionName')}
                className="text-input small"
                value={option.name}
                editable
                onCommit={(name) =>
                  name.trim() &&
                  updateProp(dbId, prop.id, (current) => ({
                    ...current,
                    options: current.options.map((item) =>
                      item.id === option.id ? { ...item, name: name.trim() } : item,
                    ),
                  }))
                }
              />
              <Select<ColorName>
                label={t('editor.colour')}
                value={option.color}
                options={COLORS.map((color) => ({ value: color, label: COLOR_LABELS[color] }))}
                onChange={(color) =>
                  updateProp(dbId, prop.id, (current) => ({
                    ...current,
                    options: current.options.map((item) =>
                      item.id === option.id ? { ...item, color } : item,
                    ),
                  }))
                }
              />
              <button
                type="button"
                className="icon-button tiny"
                aria-label={t('database.deleteOptionAria', { name: option.name })}
                onClick={() =>
                  updateProp(dbId, prop.id, (current) => ({
                    ...current,
                    options: current.options.filter((item) => item.id !== option.id),
                  }))
                }
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="popover-actions">
        {view && (
          <>
            <button
              type="button"
              className="button small"
              onClick={() => {
                updateView(dbId, view!.id, (current) => ({
                  ...current,
                  sorts: [{ prop: prop.id, dir: 'asc' }],
                }));
                onClose();
              }}
            >
              {t('database.sortAscending')}
            </button>
            <button
              type="button"
              className="button small"
              onClick={() => {
                updateView(dbId, view!.id, (current) => ({
                  ...current,
                  hidden: [...current.hidden, prop.id],
                }));
                onClose();
              }}
            >
              <EyeOff size={13} /> {t('database.hide')}
            </button>
          </>
        )}
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
          <Trash2 size={13} /> {t('common.delete')}
        </button>
      </div>
    </Popover>
  );
}

const FORMULA_EXAMPLES = [
  'prop("Price") * prop("Count")',
  'if(prop("Done"), "✅", "⏳")',
  'dateBetween(prop("Due"), today(), "days")',
  'concat(prop("Name"), " · ", prop("Status"))',
];

// the expression a formula property runs, checked against the first row as you type
function FormulaField({ dbId, prop, database }: { dbId: PageId; prop: PropDef; database: DatabaseDef }) {
  const [draft, setDraft] = useState(prop.formula ?? '');
  const state = useWorkspace();
  const sample = rowsOf(state, dbId)[0];
  const preview = sample ? formulaResult(sample, { ...prop, formula: draft }, database) : null;
  const save = () => {
    if (draft !== (prop.formula ?? ''))
      updateProp(dbId, prop.id, (current) => ({ ...current, formula: draft }));
  };
  return (
    <div className="field formula-field">
      <span>{t('slash.items.math.title')}</span>
      <textarea
        className="text-input small formula-input"
        spellCheck={false}
        value={draft}
        placeholder='prop("Price") * prop("Count")'
        aria-label={t('slash.items.math.title')}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            save();
          }
        }}
      />
      {preview?.error ? (
        <span className="formula-error">{preview.error}</span>
      ) : preview && draft.trim() ? (
        <span className="muted small">
          First row: <strong>{formatValue(prop, preview.value) || 'empty'}</strong>
        </span>
      ) : null}
      <details className="formula-help">
        <summary>{t('database.howFormulasWork')}</summary>
        <p className="muted small">
          Use <code>prop("Name")</code> for another property, maths like <code>+ - * / ^</code>, comparisons
          like <code>&gt; == !=</code>, <code>and</code>, <code>or</code>, <code>not</code>, and functions:
          if, empty, round, floor, ceil, abs, min, max, sum, length, concat, join, upper, lower, contains,
          replace, slice, today, now, dateAdd, dateBetween, year, month, day.
        </p>
        <ul className="formula-examples">
          {FORMULA_EXAMPLES.map((example) => (
            <li key={example}>
              <button type="button" className="link-button" onClick={() => setDraft(example)}>
                <code>{example}</code>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
