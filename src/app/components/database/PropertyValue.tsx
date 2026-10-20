import { Check, ExternalLink, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { formatValue, formulaResult, PROP_LABELS } from '../../../core/database';
import { displayTitle } from '../../../core/model';
import { findPagesByTitle, resolveLinkTarget } from '../../../core/search';
import { openPage } from '../../router';
import { useWorkspace } from '../../workspace';
import { PageIcon } from '../Sidebar';
import { PROP_TYPES } from '../../../core/model';
import { reservedPropertyName } from '../../../core/vault/pageFile';
import { newId } from '../../platform/files';
import { t } from '../../i18n';
import { toast } from '../../ui';
import type {
  DatabaseDef,
  PageId,
  PageMeta,
  PropDef,
  PropType,
  PropValue,
  SelectOption,
} from '../../../core/model';
import { openExternal } from '../../platform/desktop';
import { Popover } from '../Popover';
import { ensureOption, setValue, updateDatabase } from './data';

export function Chip({ option }: { option: Pick<SelectOption, 'name' | 'color'> }) {
  return <span className={`chip color-${option.color}`}>{option.name}</span>;
}

// a value shown on a card or in a list, never editable
export function PropertyDisplay({ prop, value }: { prop: PropDef; value: PropValue }) {
  if (value === null || value === undefined || value === '' || value === false) return null;
  switch (prop.type) {
    case 'select': {
      const option = prop.options.find((candidate) => candidate.id === value);
      return option ? <Chip option={option} /> : null;
    }
    case 'multiSelect':
      return (
        <>
          {(Array.isArray(value) ? value : []).map((id) => {
            const option = prop.options.find((candidate) => candidate.id === id);
            return option ? <Chip key={id} option={option} /> : null;
          })}
        </>
      );
    case 'checkbox':
      return (
        <span className="prop-check">
          <Check size={12} /> {prop.name}
        </span>
      );
    case 'date':
      return <span className="prop-text">{formatDay(String(value))}</span>;
    case 'relation':
      return <RelationChips targets={Array.isArray(value) ? value : [String(value)]} />;
    default:
      return <span className="prop-text">{formatValue(prop, value)}</span>;
  }
}

// related pages as small links, a name that no longer matches a page is shown faded
export function RelationChips({ targets }: { targets: string[] }) {
  const state = useWorkspace();
  return (
    <>
      {targets.map((target) => {
        const id = resolveLinkTarget(state, target);
        const page = id ? state.pages[id] : undefined;
        return (
          <span
            key={target}
            role="link"
            tabIndex={0}
            className={`relation-chip${page ? '' : ' is-missing'}`}
            data-page-id={page?.id}
            title={page ? `Open ${displayTitle(page)}` : `“${target}” does not exist`}
            onClick={(event) => {
              if (!page) return;
              event.stopPropagation();
              openPage(page.id);
            }}
            onKeyDown={(event) => event.key === 'Enter' && page && openPage(page.id)}
          >
            {page && <PageIcon page={page} />}
            {page ? displayTitle(page) : target}
          </span>
        );
      })}
    </>
  );
}

export function formatDay(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// the editor for one value of one row, used in table cells and on row pages
export function PropertyInput({
  dbId,
  prop,
  row,
  editable,
}: {
  dbId: PageId;
  prop: PropDef;
  row: PageMeta;
  editable: boolean;
}) {
  const value = row.properties[prop.id] ?? null;
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const label = `${prop.name} of ${row.title || 'Untitled'}`;

  switch (prop.type) {
    case 'formula':
      return <FormulaCell dbId={dbId} prop={prop} row={row} />;
    case 'relation': {
      const targets = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      return (
        <>
          <button
            type="button"
            className="prop-select"
            aria-label={label}
            disabled={!editable}
            onClick={(event) => setPicker(event.currentTarget)}
          >
            {targets.length === 0 && editable && <span className="prop-empty">Empty</span>}
            <RelationChips targets={targets} />
          </button>
          {picker && (
            <RelationPicker
              row={row}
              prop={prop}
              targets={targets}
              anchor={picker}
              onClose={() => setPicker(null)}
            />
          )}
        </>
      );
    }
    case 'checkbox':
      return (
        <input
          type="checkbox"
          className="prop-checkbox"
          aria-label={label}
          checked={value === true}
          disabled={!editable}
          onChange={(event) => setValue(row.id, prop.id, event.target.checked)}
        />
      );
    case 'number':
      return (
        <DraftInput
          type="number"
          label={label}
          value={typeof value === 'number' ? String(value) : ''}
          editable={editable}
          onCommit={(text) => {
            const number = Number(text);
            setValue(row.id, prop.id, text.trim() && Number.isFinite(number) ? number : null);
          }}
        />
      );
    case 'date':
      return (
        <input
          type="date"
          className="prop-input"
          aria-label={label}
          value={typeof value === 'string' ? value : ''}
          disabled={!editable}
          onChange={(event) => setValue(row.id, prop.id, event.target.value || null)}
        />
      );
    case 'url':
      return (
        <span className="prop-url">
          <DraftInput
            type="url"
            label={label}
            value={typeof value === 'string' ? value : ''}
            editable={editable}
            onCommit={(text) => setValue(row.id, prop.id, text.trim() || null)}
          />
          {typeof value === 'string' && /^https?:\/\//i.test(value) && (
            <button
              type="button"
              className="icon-button tiny"
              aria-label="Open link"
              onClick={() => openExternal(value)}
            >
              <ExternalLink size={13} />
            </button>
          )}
        </span>
      );
    case 'select':
    case 'multiSelect': {
      const ids = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
      return (
        <>
          <button
            type="button"
            className="prop-select"
            aria-label={label}
            disabled={!editable}
            onClick={(event) => setPicker(event.currentTarget)}
          >
            {ids.length === 0 && editable && <span className="prop-empty">Empty</span>}
            {ids.map((id) => {
              const option = prop.options.find((candidate) => candidate.id === id);
              return option ? <Chip key={id} option={option} /> : null;
            })}
          </button>
          {picker && (
            <OptionPicker
              dbId={dbId}
              prop={prop}
              selected={ids}
              anchor={picker}
              onClose={() => setPicker(null)}
              row={row}
            />
          )}
        </>
      );
    }
    default:
      return (
        <DraftInput
          type="text"
          label={label}
          value={typeof value === 'string' ? value : value === null ? '' : String(value)}
          editable={editable}
          onCommit={(text) => setValue(row.id, prop.id, text || null)}
        />
      );
  }
}

// keeps typing local and saves on blur or enter, so every keystroke is not a separate change
export function DraftInput({
  type,
  label,
  value,
  editable,
  onCommit,
  placeholder,
  className,
  autoFocus,
  onDone,
}: {
  type: 'text' | 'number' | 'url';
  label: string;
  value: string;
  editable: boolean;
  onCommit: (text: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  // called when the input loses focus, changed or not
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
    onDone?.();
  };
  return (
    <input
      type={type}
      autoFocus={autoFocus}
      className={className ?? 'prop-input'}
      aria-label={label}
      placeholder={placeholder ?? (editable ? 'Empty' : '')}
      value={draft ?? value}
      readOnly={!editable}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function OptionPicker({
  dbId,
  prop,
  row,
  selected,
  anchor,
  onClose,
}: {
  dbId: PageId;
  prop: PropDef;
  row: PageMeta;
  selected: string[];
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const multi = prop.type === 'multiSelect';
  const shown = prop.options.filter((option) =>
    option.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const exact = prop.options.some((option) => option.name.toLowerCase() === query.trim().toLowerCase());
  const choose = (id: string) => {
    if (multi) {
      const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
      setValue(row.id, prop.id, next.length ? next : null);
    } else {
      setValue(row.id, prop.id, selected[0] === id ? null : id);
      onClose();
    }
  };
  const create = () => {
    const option = ensureOption(dbId, prop.id, query);
    if (!option) return;
    setQuery('');
    if (multi) setValue(row.id, prop.id, [...selected.filter((id) => id !== option.id), option.id]);
    else {
      setValue(row.id, prop.id, option.id);
      onClose();
    }
  };
  return (
    <Popover anchor={anchor} onClose={onClose} label={`Choose ${prop.name}`} className="option-picker">
      <input
        className="text-input small"
        data-autofocus
        placeholder={prop.options.length ? 'Find or create an option' : 'Create an option'}
        aria-label="Option"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (query.trim() && !exact) create();
          else if (shown[0]) choose(shown[0].id);
        }}
      />
      <ul className="option-list" role="listbox" aria-multiselectable={multi}>
        {shown.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              role="option"
              aria-selected={selected.includes(option.id)}
              className="option-row"
              onClick={() => choose(option.id)}
            >
              <Chip option={option} />
              {selected.includes(option.id) && <Check size={14} className="option-check" />}
            </button>
          </li>
        ))}
        {query.trim() && !exact && (
          <li>
            <button type="button" className="option-row" onClick={create}>
              <Plus size={14} /> Create <Chip option={{ name: query.trim(), color: 'gray' }} />
            </button>
          </li>
        )}
        {selected.length > 0 && (
          <li>
            <button
              type="button"
              className="option-row muted"
              onClick={() => {
                setValue(row.id, prop.id, null);
                onClose();
              }}
            >
              <X size={14} /> Clear
            </button>
          </li>
        )}
      </ul>
    </Popover>
  );
}

export function NewProperty({
  dbId,
  database,
  onDone,
}: {
  dbId: PageId;
  database: DatabaseDef;
  onDone?: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PropType>('text');
  const add = () => {
    const clean = name.trim();
    if (!clean) return;
    if (
      reservedPropertyName(clean) ||
      database.properties.some((prop) => prop.name.toLowerCase() === clean.toLowerCase())
    ) {
      toast(t('toasts.propNameDuplicate', { name: clean }), { tone: 'error' });
      return;
    }
    updateDatabase(dbId, (current) => ({
      ...current,
      properties: [...current.properties, { id: newId(), name: clean, type, options: [] }],
    }));
    setName('');
    onDone?.();
  };
  return (
    <form
      className="db-rule"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <input
        className="text-input small"
        placeholder="New property"
        aria-label="New property name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        className="text-input small"
        aria-label="Type"
        value={type}
        onChange={(event) => setType(event.target.value as PropType)}
      >
        {PROP_TYPES.map((item) => (
          <option key={item} value={item}>
            {PROP_LABELS[item]}
          </option>
        ))}
      </select>
      <button type="submit" className="button small" disabled={!name.trim()}>
        Add
      </button>
    </form>
  );
}

function FormulaCell({ dbId, prop, row }: { dbId: PageId; prop: PropDef; row: PageMeta }) {
  const state = useWorkspace();
  const database = state.pages[dbId]?.database;
  if (!database) return null;
  const result = formulaResult(row, prop, database);
  if (result.error)
    return (
      <span className="formula-error" title={result.error}>
        Error
      </span>
    );
  return <span className="prop-text formula-value">{formatValue(prop, result.value)}</span>;
}

// pick pages to relate a row to, searching every page by title
function RelationPicker({
  row,
  prop,
  targets,
  anchor,
  onClose,
}: {
  row: PageMeta;
  prop: PropDef;
  targets: string[];
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const state = useWorkspace();
  const [query, setQuery] = useState('');
  const chosen = new Set(targets.map((target) => target.toLowerCase()));
  const found = findPagesByTitle(state, query, 12).filter((page) => page.id !== row.id);
  const toggle = (title: string) => {
    const next = chosen.has(title.toLowerCase())
      ? targets.filter((target) => target.toLowerCase() !== title.toLowerCase())
      : [...targets, title];
    setValue(row.id, prop.id, next.length ? next : null);
  };
  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      label={`Relate ${row.title || 'Untitled'}`}
      className="db-panel relation-picker"
    >
      <input
        className="text-input small"
        data-autofocus
        placeholder="Search pages"
        aria-label="Search pages"
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
        {found.length === 0 && <li className="muted small">No pages match.</li>}
      </ul>
    </Popover>
  );
}
