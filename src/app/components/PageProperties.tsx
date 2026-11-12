import { Check, Columns3, ExternalLink, Palette, Pencil, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { stringify } from 'yaml';
import { displayTitle } from '../../core/model';
import type { DatabaseDef, PageId, PageMeta, PropDef } from '../../core/model';
import { inferFrontmatterType } from '../../core/properties';
import { findKey, MANAGED_KEYS } from '../../core/vault/frontmatter';
import { RECURRENCE_KEYS } from '../../core/recurring';
import { findTemplatesPage } from '../../core/templates';
import { tagColor } from '../../core/tags';
import { useTagColors } from '../tagColors';
import { TagColorMenu } from './TagColorMenu';
import { openExternal } from '../platform/desktop';
import { setPropertyType, usePropertyTypes } from '../propertyTypes';
import type { ChosenType } from '../propertyTypes';
import { getState } from '../workspace';
import { toast } from '../ui';
import { run } from '../workspace';
import { addColumnsFromPages } from './database/data';
import { DraftInput, NewProperty, PropertyInput, RelationChips } from './database/PropertyValue';
import { PropertySettings } from './database/PropertySettings';
import { Menu } from './Menu';
import type { MenuEntry } from './Menu';
import { Popover } from './Popover';
import { t } from '../i18n';
import { propLabel } from '../i18n/labels';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// the properties at the top of a page: its database values, then any other frontmatter it has, such as the
// properties of a note written in obsidian, shown and edited as plain values
export function PageProperties({
  page,
  database,
  editable,
  adding,
  onAdded,
}: {
  page: PageMeta;
  database: { id: PageId; database: DatabaseDef } | null;
  editable: boolean;
  // set when the page header asked to add the first property
  adding: boolean;
  onAdded: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [naming, setNaming] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<{ prop: PropDef; anchor: HTMLElement } | null>(null);
  const [extraMenu, setExtraMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const chosenTypes = usePropertyTypes();
  // a template's repeat settings have their own bar under its title
  const extraKeys = Object.keys(page.extra).filter(
    (key) => !(isTemplate(page) && RECURRENCE_KEYS.includes(key.toLowerCase())),
  );
  const props = database?.database.properties ?? [];
  const showNaming = editable && (naming || adding);
  if (props.length === 0 && extraKeys.length === 0 && !showNaming && !(database && editable)) return null;

  const setExtra = (extra: Record<string, unknown>) => saveExtra(page.id, extra);

  const addKey = (name: string): boolean => {
    const clean = name.trim();
    if (!clean) return false;
    if (MANAGED_KEYS.has(clean) || clean.length > 200) {
      toast(t('toasts.propNameUsed', { name: clean }), { tone: 'error' });
      return false;
    }
    if (
      findKey(page.extra, clean) !== undefined ||
      props.some((prop) => prop.name.toLowerCase() === clean.toLowerCase())
    ) {
      toast(t('toasts.pageHasProp', { name: clean }), { tone: 'error' });
      return false;
    }
    if (!setExtra({ ...page.extra, [clean]: '' })) return false;
    setFocusKey(clean);
    return true;
  };

  return (
    <section className="row-props" aria-label={t('properties.properties')}>
      {database &&
        props.map((prop) => (
          <div key={prop.id} className="row-prop">
            {editable ? (
              <button
                type="button"
                className="row-prop-name row-prop-button"
                title={t('properties.editProperty')}
                onClick={(event) => setSettings({ prop, anchor: event.currentTarget })}
              >
                {prop.name}
              </button>
            ) : (
              <span className="row-prop-name">{prop.name}</span>
            )}
            <span className="row-prop-value">
              <PropertyInput dbId={database.id} prop={prop} row={page} editable={editable} />
            </span>
          </div>
        ))}
      {extraKeys.map((key) => (
        <div key={key} className="row-prop is-extra">
          {editable ? (
            <button
              type="button"
              className="row-prop-name row-prop-button"
              title={key}
              onClick={(event) => setExtraMenu({ key, anchor: event.currentTarget })}
            >
              {key}
            </button>
          ) : (
            <span className="row-prop-name" title={key}>
              {key}
            </span>
          )}
          <span className="row-prop-value">
            <ExtraValue
              propKey={key}
              type={extraType(page.extra[key], chosenTypes[key])}
              label={t('properties.valueOf', { key, title: displayTitle(page) })}
              value={page.extra[key]}
              editable={editable}
              autoFocus={focusKey === key}
              onChange={(value) => setExtra({ ...page.extra, [key]: value })}
            />
          </span>
          {editable && (
            <span className="row-prop-actions">
              {database && inferFrontmatterType([page.extra[key]]) !== null && (
                <button
                  type="button"
                  className="icon-button tiny"
                  aria-label={t('properties.makeColumnAria', { key })}
                  title={t('properties.makeColumn')}
                  onClick={() => addColumnsFromPages(database.id, [key])}
                >
                  <Columns3 size={13} />
                </button>
              )}
              <button
                type="button"
                className="icon-button tiny"
                aria-label={t('properties.removeAria', { key })}
                title={t('properties.remove')}
                onClick={() => {
                  const { [key]: _removed, ...rest } = page.extra;
                  setExtra(rest);
                }}
              >
                <X size={13} />
              </button>
            </span>
          )}
        </div>
      ))}
      {showNaming && (
        <form
          className="row-prop row-prop-new"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem('name') as HTMLInputElement;
            if (addKey(input.value)) {
              setNaming(false);
              onAdded();
            }
          }}
        >
          <input
            name="name"
            className="prop-input row-prop-name-input"
            placeholder={t('page.propertyNamePlaceholder')}
            aria-label={t('page.newPropertyNameAria')}
            autoFocus
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              setNaming(false);
              onAdded();
            }}
            onBlur={(event) => {
              if (event.currentTarget.value.trim()) return;
              setNaming(false);
              onAdded();
            }}
          />
          <span className="muted small">{t('page.pressEnterToAdd')}</span>
        </form>
      )}
      {editable && !showNaming && (
        <>
          <button
            type="button"
            className="link-button row-prop-add"
            onClick={(event) => (database ? setMenu(event.currentTarget) : setNaming(true))}
          >
            <Plus size={13} /> {t('page.addAProperty')}
          </button>
          {menu && database && (
            <Popover
              anchor={menu}
              onClose={() => setMenu(null)}
              label={t('properties.newProperty')}
              className="db-panel"
            >
              <NewProperty dbId={database.id} database={database.database} onDone={() => setMenu(null)} />
            </Popover>
          )}
        </>
      )}
      {extraMenu && extraMenu.key in page.extra && (
        <Menu
          anchor={extraMenu.anchor}
          label={t('properties.editProperty')}
          onClose={() => setExtraMenu(null)}
          entries={extraMenuEntries(
            extraMenu.key,
            page.extra[extraMenu.key],
            chosenTypes[extraMenu.key],
            (value) => {
              const { key } = extraMenu;
              if (value === undefined) {
                const { [key]: _removed, ...rest } = page.extra;
                setExtra(rest);
              } else setExtra({ ...page.extra, [key]: value });
            },
          )}
        />
      )}
      {database && settings && (
        <PropertySettings
          dbId={database.id}
          database={database.database}
          prop={settings.prop}
          anchor={settings.anchor}
          onClose={() => setSettings(null)}
        />
      )}
    </section>
  );
}

const isTemplate = (page: PageMeta) =>
  page.parentId !== null && page.parentId === findTemplatesPage(getState())?.id;

// the kinds of value a property outside a database can hold. its type is the shape of its value
type ExtraType = 'text' | 'number' | 'select' | 'multiSelect' | 'date' | 'checkbox' | 'url';
const EXTRA_TYPES: ExtraType[] = ['text', 'number', 'select', 'multiSelect', 'date', 'checkbox', 'url'];
const WEB = /^https?:\/\/\S+$/i;

// the shape of the value says most of it, the type picked for the key tells a select or a link from text
function extraType(value: unknown, chosen?: ChosenType): ExtraType | null {
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return 'multiSelect';
  if (typeof value === 'string' || value === null) {
    const text = value ?? '';
    if (DAY.test(text)) return 'date';
    if (chosen === 'select') return 'select';
    if (chosen === 'url' || (chosen !== 'text' && WEB.test(text))) return 'url';
    return 'text';
  }
  return null;
}

// a value turned into another type, keeping what it can of what it held
function convertExtra(value: unknown, type: ExtraType): unknown {
  const text = Array.isArray(value)
    ? value.map(String).join(', ')
    : value === null || value === undefined
      ? ''
      : String(value);
  switch (type) {
    case 'text':
    case 'url':
      return text;
    case 'select':
      return Array.isArray(value) ? String(value[0] ?? '') : text;
    case 'number': {
      const number = typeof value === 'boolean' ? Number(value) : Number(text.replace(/,/g, ''));
      return text.trim() && Number.isFinite(number) ? number : 0;
    }
    case 'checkbox':
      return value === true || /^(true|yes|1|x|✓)$/i.test(text.trim());
    case 'date': {
      if (DAY.test(text)) return text;
      const parsed = text.trim() ? new Date(text) : new Date(NaN);
      const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
    case 'multiSelect':
      return Array.isArray(value)
        ? value
        : text
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
  }
}

// undefined removes the property
function extraMenuEntries(
  key: string,
  value: unknown,
  chosen: ChosenType | undefined,
  change: (value: unknown) => void,
): MenuEntry[] {
  const current = extraType(value, chosen);
  return [
    { heading: t('properties.type') },
    ...EXTRA_TYPES.map((type) => ({
      label: propLabel(type),
      checked: type === current,
      onSelect: () => {
        if (type === current) return;
        // text, a select and a link all hold words, which one it is is kept for the whole vault
        void setPropertyType(key, type === 'select' || type === 'url' || type === 'text' ? type : null);
        change(convertExtra(value, type));
      },
    })),
    { separator: true },
    { label: t('properties.remove'), danger: true, onSelect: () => change(undefined) },
  ];
}

function saveExtra(id: PageId, extra: Record<string, unknown>): boolean {
  return run({ type: 'page.setFields', id, extra, now: Date.now() }).ok;
}

// one frontmatter value, edited in a way that fits what it holds
function ExtraValue({
  propKey,
  type,
  label,
  value,
  editable,
  autoFocus,
  onChange,
}: {
  propKey: string;
  type: ExtraType | null;
  label: string;
  value: unknown;
  editable: boolean;
  autoFocus: boolean;
  onChange: (value: unknown) => void;
}) {
  const [editingLinks, setEditingLinks] = useState(false);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [editingUrl, setEditingUrl] = useState(false);
  useTagColors();
  if (type === 'select' || (type === 'multiSelect' && inferFrontmatterType([value]) !== 'relation')) {
    const chosen = (Array.isArray(value) ? value : value ? [value] : []).map(String).filter(Boolean);
    return (
      <>
        <button
          type="button"
          className="prop-select"
          aria-label={label}
          disabled={!editable}
          autoFocus={autoFocus}
          onClick={(event) => setPicker(event.currentTarget)}
        >
          {chosen.length === 0 && editable && <span className="prop-empty">{t('database.empty')}</span>}
          {chosen.map((name) => (
            <span key={name} className={`chip color-${tagColor(name)}`}>
              {name}
            </span>
          ))}
        </button>
        {picker && (
          <ExtraOptionPicker
            propKey={propKey}
            multi={type === 'multiSelect'}
            selected={chosen}
            anchor={picker}
            onClose={() => setPicker(null)}
            onChange={onChange}
          />
        )}
      </>
    );
  }
  // a link opens in the browser, written without https:// it is taken as a web address
  const openUrl = (address: string) =>
    openExternal(/^[a-z][a-z0-9+.-]*:/i.test(address) ? address : `https://${address}`);
  const openButton = (address: string) => (
    <button
      type="button"
      className="icon-button tiny"
      aria-label={t('editor.openLink')}
      title={t('editor.openLink')}
      onClick={() => openUrl(address)}
    >
      <ExternalLink size={12} />
    </button>
  );
  if (type === 'url' && typeof value === 'string' && value.trim() && (editingUrl || autoFocus))
    return (
      <span className="prop-url">
        <DraftInput
          type="text"
          label={label}
          value={value}
          editable={editable}
          autoFocus
          onCommit={(next) => onChange(next)}
          onDone={() => setEditingUrl(false)}
        />
        {openButton(value.trim())}
      </span>
    );
  if (type === 'url' && typeof value === 'string' && value && !editingUrl && !autoFocus)
    return (
      <span className="prop-url">
        <a
          href={value}
          onClick={(event) => {
            event.preventDefault();
            openUrl(value.trim());
          }}
        >
          {value.replace(/^https?:\/\//i, '')}
        </a>
        {openButton(value.trim())}
        {editable && (
          <button
            type="button"
            className="icon-button tiny"
            aria-label={t('properties.editLink')}
            title={t('properties.editLink')}
            onClick={() => setEditingUrl(true)}
          >
            <Pencil size={12} />
          </button>
        )}
      </span>
    );
  if (typeof value === 'boolean')
    return (
      <input
        type="checkbox"
        className="prop-checkbox"
        aria-label={label}
        checked={value}
        disabled={!editable}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  if (typeof value === 'number')
    return (
      <DraftInput
        type="number"
        label={label}
        value={String(value)}
        editable={editable}
        onCommit={(text) => {
          const number = Number(text);
          onChange(text.trim() && Number.isFinite(number) ? number : text);
        }}
      />
    );
  if (typeof value === 'string' && DAY.test(value))
    return (
      <input
        type="date"
        className="prop-input"
        aria-label={label}
        value={value}
        disabled={!editable}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  // nested values can not be edited here without losing their shape, the markdown view can change them
  if (value !== null && typeof value === 'object' && !Array.isArray(value))
    return (
      <code className="prop-yaml" title={t('properties.editAsMarkdownHint')}>
        {stringify(value, { lineWidth: 0 }).trim()}
      </code>
    );
  const list = Array.isArray(value);
  const items = list ? value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))) : [];
  const text = list ? items.join(', ') : value === null || value === undefined ? '' : String(value);
  const links = inferFrontmatterType([value]) === 'relation' && !editingLinks && !autoFocus;
  if (links)
    return (
      <span
        className="prop-select prop-links"
        role="button"
        tabIndex={editable ? 0 : -1}
        aria-label={label}
        onClick={() => editable && setEditingLinks(true)}
        onKeyDown={(event) => event.key === 'Enter' && editable && setEditingLinks(true)}
      >
        <RelationChips targets={(list ? items : [text]).map((item) => item.replace(/^\[\[|\]\]$/g, ''))} />
      </span>
    );
  return (
    <DraftInput
      type="text"
      label={label}
      value={text}
      editable={editable}
      autoFocus={autoFocus || editingLinks}
      onCommit={(next) => {
        if (!list) return onChange(next);
        onChange(
          next
            .split(/,(?![^[]*\]\])/)
            .map((item) => item.trim())
            .filter(Boolean),
        );
      }}
      onDone={() => {
        setEditingLinks(false);
        setEditingUrl(false);
      }}
    />
  );
}

// the choices for a select outside a database are the values this key already has across the vault
function ExtraOptionPicker({
  propKey,
  multi,
  selected,
  anchor,
  onClose,
  onChange,
}: {
  propKey: string;
  multi: boolean;
  selected: string[];
  anchor: HTMLElement;
  onClose: () => void;
  onChange: (value: unknown) => void;
}) {
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const found = new Set<string>(selected);
    for (const page of Object.values(getState().pages)) {
      const value = page.extra[propKey];
      for (const item of Array.isArray(value) ? value : [value])
        if (typeof item === 'string' && item.trim() && !/^\[\[/.test(item)) found.add(item.trim());
    }
    return [...found].sort((a, b) => a.localeCompare(b));
  }, [propKey, selected]);
  const wanted = query.trim();
  const shown = options.filter((option) => option.toLowerCase().includes(wanted.toLowerCase()));
  const exact = options.some((option) => option.toLowerCase() === wanted.toLowerCase());
  const [colouring, setColouring] = useState<{ name: string; at: HTMLElement } | null>(null);
  useTagColors();
  const choose = (name: string) => {
    if (multi) {
      onChange(selected.includes(name) ? selected.filter((item) => item !== name) : [...selected, name]);
      setQuery('');
    } else {
      onChange(selected[0] === name ? '' : name);
      onClose();
    }
  };
  return (
    <Popover
      anchor={anchor}
      onClose={onClose}
      label={t('database.chooseAria', { name: propKey })}
      className="option-picker"
    >
      <input
        className="text-input small"
        data-autofocus
        placeholder={options.length ? t('database.findOrCreateOption') : t('database.createOption')}
        aria-label={t('database.option')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (wanted && !exact) choose(wanted);
          else if (shown[0]) choose(shown[0]);
        }}
      />
      <ul className="option-list" role="listbox" aria-multiselectable={multi}>
        {shown.map((option) => (
          <li key={option}>
            <button
              type="button"
              role="option"
              aria-selected={selected.includes(option)}
              className="option-row"
              onClick={() => choose(option)}
            >
              <span className={`chip color-${tagColor(option)}`}>{option}</span>
              {selected.includes(option) && <Check size={14} className="option-check" />}
            </button>
            <button
              type="button"
              className="icon-button small option-colour"
              aria-label={t('tags.colour', { tag: option })}
              title={t('tags.colour', { tag: option })}
              onClick={(event) => setColouring({ name: option, at: event.currentTarget })}
            >
              <Palette size={13} />
            </button>
          </li>
        ))}
        {wanted && !exact && (
          <li>
            <button type="button" className="option-row" onClick={() => choose(wanted)}>
              <Plus size={14} /> {t('database.create')}
              <span className={`chip color-${tagColor(wanted)}`}>{wanted}</span>
            </button>
          </li>
        )}
      </ul>
      {colouring && (
        <TagColorMenu name={colouring.name} anchor={colouring.at} onClose={() => setColouring(null)} />
      )}
    </Popover>
  );
}
