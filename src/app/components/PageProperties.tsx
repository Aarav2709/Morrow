import { Columns3, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { stringify } from 'yaml';
import type { DatabaseDef, PageId, PageMeta } from '../../core/model';
import { inferFrontmatterType } from '../../core/properties';
import { findKey, MANAGED_KEYS } from '../../core/vault/frontmatter';
import { toast } from '../ui';
import { run } from '../workspace';
import { addColumnsFromPages } from './database/data';
import { DraftInput, NewProperty, PropertyInput, RelationChips } from './database/PropertyValue';
import { Popover } from './Popover';
import { t } from '../i18n';

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
  const extraKeys = Object.keys(page.extra);
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
    <section className="row-props" aria-label="Properties">
      {database &&
        props.map((prop) => (
          <div key={prop.id} className="row-prop">
            <span className="row-prop-name">{prop.name}</span>
            <span className="row-prop-value">
              <PropertyInput dbId={database.id} prop={prop} row={page} editable={editable} />
            </span>
          </div>
        ))}
      {extraKeys.map((key) => (
        <div key={key} className="row-prop is-extra">
          <span className="row-prop-name" title={key}>
            {key}
          </span>
          <span className="row-prop-value">
            <ExtraValue
              label={`${key} of ${page.title || 'Untitled'}`}
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
                  aria-label={`Make ${key} a column of the database`}
                  title="Make this a column of the database"
                  onClick={() => addColumnsFromPages(database.id, [key])}
                >
                  <Columns3 size={13} />
                </button>
              )}
              <button
                type="button"
                className="icon-button tiny"
                aria-label={`Remove ${key}`}
                title="Remove this property"
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
            <Popover anchor={menu} onClose={() => setMenu(null)} label="New property" className="db-panel">
              <NewProperty dbId={database.id} database={database.database} onDone={() => setMenu(null)} />
            </Popover>
          )}
        </>
      )}
    </section>
  );
}

function saveExtra(id: PageId, extra: Record<string, unknown>): boolean {
  return run({ type: 'page.setFields', id, extra, now: Date.now() }).ok;
}

// one frontmatter value, edited in a way that fits what it holds
function ExtraValue({
  label,
  value,
  editable,
  autoFocus,
  onChange,
}: {
  label: string;
  value: unknown;
  editable: boolean;
  autoFocus: boolean;
  onChange: (value: unknown) => void;
}) {
  const [editingLinks, setEditingLinks] = useState(false);
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
      <code className="prop-yaml" title="Edit the page as Markdown to change this value">
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
      onDone={() => setEditingLinks(false)}
    />
  );
}
