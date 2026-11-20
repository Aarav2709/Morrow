import { Check, Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { DatabaseDef, PageId, PageMeta, PropDef, PropValue } from '../../../core/model';
import { displayTitle } from '../../../core/model';
import { findPagesByTitle } from '../../../core/search';
import { t } from '../../i18n';
import { useWorkspace } from '../../workspace';
import { Popover } from '../Popover';
import { PageIcon } from '../Sidebar';
import { ensureOption, setValues } from './data';
import { Chip } from './PropertyValue';

export type BulkListMode = 'replace' | 'add' | 'remove';

export type BulkEditAction =
  | { kind: 'clear' }
  | { kind: 'scalar'; text: string; checked: boolean; optionId: string | null }
  | { kind: 'list'; items: string[]; mode: BulkListMode };

// computes the next property value for one row during a bulk property edit
export function resolveBulkValue(current: PropValue, prop: PropDef, action: BulkEditAction): PropValue {
  if (action.kind === 'clear') return null;

  if (prop.type === 'multiSelect' || prop.type === 'relation') {
    const existing = Array.isArray(current)
      ? current.filter((item): item is string => typeof item === 'string')
      : typeof current === 'string' && current
        ? [current]
        : [];
    const chosen = action.kind === 'list' ? action.items : [];
    const mode = action.kind === 'list' ? action.mode : 'replace';
    const keyOf = (item: string) => (prop.type === 'relation' ? item.toLowerCase() : item);

    if (mode === 'replace') return chosen.length ? chosen : null;
    if (mode === 'add') {
      const seen = new Set(existing.map(keyOf));
      const merged = [...existing];
      for (const item of chosen) {
        const key = keyOf(item);
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(item);
        }
      }
      return merged.length ? merged : null;
    }
    const removeKeys = new Set(chosen.map(keyOf));
    const remaining = existing.filter((item) => !removeKeys.has(keyOf(item)));
    return remaining.length ? remaining : null;
  }

  if (action.kind !== 'scalar') return null;

  switch (prop.type) {
    case 'select':
      return action.optionId || null;
    case 'checkbox':
      return action.checked;
    case 'number': {
      const trimmed = action.text.trim();
      if (!trimmed) return null;
      const number = Number(trimmed);
      return Number.isFinite(number) ? number : null;
    }
    case 'date':
    case 'url':
      return action.text.trim() || null;
    case 'text':
      return action.text || null;
    default:
      return null;
  }
}

// toggles one row or a shift-click range within the visible table rows
export function toggleRowSelection(
  selected: Set<PageId>,
  visibleRowIds: PageId[],
  clickedId: PageId,
  anchorId: PageId | null,
  shiftKey: boolean,
): Set<PageId> {
  const next = new Set(selected);
  const nextChecked = !selected.has(clickedId);

  if (shiftKey && anchorId && anchorId !== clickedId) {
    const from = visibleRowIds.indexOf(anchorId);
    const to = visibleRowIds.indexOf(clickedId);
    if (from >= 0 && to >= 0) {
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      for (const id of visibleRowIds.slice(start, end + 1)) {
        if (nextChecked) next.add(id);
        else next.delete(id);
      }
      return next;
    }
  }

  if (nextChecked) next.add(clickedId);
  else next.delete(clickedId);
  return next;
}

export function BulkEditBar({
  dbId,
  database,
  selectedRows,
  onClear,
}: {
  dbId: PageId;
  database: DatabaseDef;
  selectedRows: PageMeta[];
  onClear: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div className="db-bulk-bar" role="region" aria-label={t('database.editSelectedAria')}>
      <span className="db-bulk-count">{t('database.selectedCount', { count: selectedRows.length })}</span>
      <div className="db-bulk-actions">
        <button type="button" className="button small" onClick={(event) => setAnchor(event.currentTarget)}>
          <Pencil size={13} /> {t('database.editProperty')}
        </button>
        <button
          type="button"
          className="icon-button tiny"
          aria-label={t('database.clearSelection')}
          title={t('database.clearSelection')}
          onClick={() => {
            setAnchor(null);
            onClear();
          }}
        >
          <X size={14} />
        </button>
      </div>
      {anchor && (
        <BulkEditPopover
          dbId={dbId}
          database={database}
          selectedRows={selectedRows}
          anchor={anchor}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  );
}

function BulkEditPopover({
  dbId,
  database,
  selectedRows,
  anchor,
  onClose,
}: {
  dbId: PageId;
  database: DatabaseDef;
  selectedRows: PageMeta[];
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const state = useWorkspace();
  const editableProps = database.properties.filter((prop) => prop.type !== 'formula');
  const [propId, setPropId] = useState<string>(() => editableProps[0]?.id ?? '');
  const prop = editableProps.find((candidate) => candidate.id === propId) ?? editableProps[0] ?? null;

  const [text, setText] = useState('');
  const [checked, setChecked] = useState(true);
  const [optionId, setOptionId] = useState<string | null>(null);
  const [items, setItems] = useState<string[]>([]);
  const [mode, setMode] = useState<BulkListMode>('replace');
  const [query, setQuery] = useState('');

  const resetDraft = () => {
    setText('');
    setChecked(true);
    setOptionId(null);
    setItems([]);
    setMode('replace');
    setQuery('');
  };

  if (!prop) {
    return (
      <Popover anchor={anchor} onClose={onClose} label={t('database.editProperty')} className="db-panel">
        <p className="muted small">{t('database.noEditableProperties')}</p>
      </Popover>
    );
  }

  const canApply = (() => {
    switch (prop.type) {
      case 'checkbox':
        return true;
      case 'select':
        return optionId !== null;
      case 'multiSelect':
      case 'relation':
        return items.length > 0;
      case 'number':
        return text.trim() !== '' && Number.isFinite(Number(text));
      case 'date':
      case 'url':
        return text.trim().length > 0;
      default:
        return text.length > 0;
    }
  })();

  const commit = (action: BulkEditAction) => {
    const updates = selectedRows.map((row) => ({
      rowId: row.id,
      propId: prop.id,
      value: resolveBulkValue(row.properties[prop.id] ?? null, prop, action),
    }));
    if (setValues(updates)) onClose();
  };

  const applyCurrent = () => {
    if (!canApply) return;
    if (prop.type === 'multiSelect' || prop.type === 'relation') {
      commit({ kind: 'list', items, mode });
    } else {
      commit({ kind: 'scalar', text, checked, optionId });
    }
  };

  const renderListMode = () => (
    <div className="segmented db-bulk-mode" role="radiogroup" aria-label={t('database.editProperty')}>
      {(
        [
          ['replace', t('database.bulkModeReplace')],
          ['add', t('database.bulkModeAdd')],
          ['remove', t('database.bulkModeRemove')],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          className={mode === value ? 'is-active' : ''}
          onClick={() => setMode(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const renderOptionEditor = (multi: boolean) => {
    const clean = query.trim().toLowerCase();
    const shown = prop.options.filter((option) => option.name.toLowerCase().includes(clean));
    const exact = prop.options.some((option) => option.name.toLowerCase() === clean);
    const toggleItem = (id: string) => {
      if (multi) {
        setItems((current) =>
          current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
        );
      } else {
        setOptionId((current) => (current === id ? null : id));
      }
    };
    const create = () => {
      const option = ensureOption(dbId, prop.id, query);
      if (!option) return;
      setQuery('');
      if (multi) setItems((current) => (current.includes(option.id) ? current : [...current, option.id]));
      else setOptionId(option.id);
    };
    return (
      <>
        {multi && renderListMode()}
        <input
          className="text-input small"
          data-autofocus
          placeholder={prop.options.length ? t('database.findOrCreateOption') : t('database.createOption')}
          aria-label={t('database.option')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (query.trim() && !exact && mode !== 'remove') create();
            else if (shown[0]) toggleItem(shown[0].id);
          }}
        />
        <ul className="option-list" role="listbox" aria-multiselectable={multi}>
          {shown.map((option) => {
            const active = multi ? items.includes(option.id) : optionId === option.id;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className="option-row"
                  onClick={() => toggleItem(option.id)}
                >
                  <Chip option={option} />
                  {active && <Check size={14} className="option-check" />}
                </button>
              </li>
            );
          })}
          {query.trim() && !exact && mode !== 'remove' && (
            <li>
              <button type="button" className="option-row" onClick={create}>
                <Plus size={14} /> {t('database.create')}
                <Chip option={{ name: query.trim(), color: 'gray' }} />
              </button>
            </li>
          )}
        </ul>
      </>
    );
  };

  const renderRelationEditor = () => {
    const soleSelectedId = selectedRows.length === 1 ? selectedRows[0]!.id : null;
    const chosen = new Set(items.map((item) => item.toLowerCase()));
    const found = findPagesByTitle(state, query, 12).filter((page) => page.id !== soleSelectedId);
    const toggle = (title: string) => {
      const lower = title.toLowerCase();
      setItems((current) =>
        chosen.has(lower) ? current.filter((item) => item.toLowerCase() !== lower) : [...current, title],
      );
    };
    return (
      <>
        {renderListMode()}
        <input
          className="text-input small"
          data-autofocus
          placeholder={t('database.searchPages')}
          aria-label={t('database.searchPages')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="relation-list">
          {found.map((page) => {
            const title = displayTitle(page);
            const on = chosen.has(title.toLowerCase());
            return (
              <li key={page.id}>
                <button
                  type="button"
                  className={`relation-option${on ? ' is-on' : ''}`}
                  onClick={() => toggle(title)}
                >
                  <PageIcon page={page} />
                  <span>{title}</span>
                  {on && <Check size={13} />}
                </button>
              </li>
            );
          })}
          {found.length === 0 && <li className="muted small">{t('database.noPagesMatch')}</li>}
        </ul>
      </>
    );
  };

  const renderValueEditor = () => {
    switch (prop.type) {
      case 'select':
        return renderOptionEditor(false);
      case 'multiSelect':
        return renderOptionEditor(true);
      case 'relation':
        return renderRelationEditor();
      case 'checkbox':
        return (
          <div className="segmented" role="radiogroup" aria-label={prop.name}>
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              className={checked ? 'is-active' : ''}
              onClick={() => setChecked(true)}
            >
              {t('database.checked')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!checked}
              className={!checked ? 'is-active' : ''}
              onClick={() => setChecked(false)}
            >
              {t('database.unchecked')}
            </button>
          </div>
        );
      case 'number':
      case 'date':
      case 'url':
      case 'text':
      default:
        return (
          <input
            className="text-input small"
            data-autofocus
            type={
              prop.type === 'number'
                ? 'number'
                : prop.type === 'date'
                  ? 'date'
                  : prop.type === 'url'
                    ? 'url'
                    : 'text'
            }
            aria-label={t('database.value')}
            placeholder={t('database.value')}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              applyCurrent();
            }}
          />
        );
    }
  };

  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      label={t('database.editProperty')}
      className="db-panel db-bulk-popover"
    >
      <label className="field">
        <span>{t('database.property')}</span>
        <select
          className="text-input small"
          aria-label={t('database.property')}
          value={prop.id}
          onChange={(event) => {
            setPropId(event.target.value);
            resetDraft();
          }}
        >
          {editableProps.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>{t('database.value')}</span>
        {renderValueEditor()}
      </div>
      <div className="popover-actions db-bulk-footer">
        <button type="button" className="button small" onClick={() => commit({ kind: 'clear' })}>
          {t('database.clearProperty')}
        </button>
        <button type="button" className="button small primary" disabled={!canApply} onClick={applyCurrent}>
          {t('database.apply')}
        </button>
      </div>
    </Popover>
  );
}
