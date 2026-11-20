import { ArrowRight, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { TODAY } from '../../../core/automations';
import type { Automation } from '../../../core/automations';
import type { DatabaseDef, PageId, PropDef, PropValue } from '../../../core/model';
import { t } from '../../i18n';
import { newId } from '../../platform/files';
import { updateDatabase } from './data';

// the values a property can be watched for or set to, in words
function valueChoices(
  prop: PropDef | undefined,
  forSetting: boolean,
): Array<{ value: string; label: string }> {
  if (!prop) return [];
  switch (prop.type) {
    case 'select':
    case 'multiSelect':
      return prop.options.map((option) => ({ value: option.id, label: option.name }));
    case 'checkbox':
      return [
        { value: 'true', label: t('database.autoTicked') },
        { value: 'false', label: t('database.autoUnticked') },
      ];
    case 'date':
      return forSetting ? [{ value: TODAY, label: t('database.autoToday') }] : [];
    default:
      return [];
  }
}

function readValue(prop: PropDef | undefined, text: string): PropValue {
  if (!prop) return null;
  if (prop.type === 'checkbox') return text === 'true';
  if (prop.type === 'number') return Number(text);
  return text;
}

function describe(prop: PropDef | undefined, value: PropValue): string {
  if (!prop) return '?';
  if (value === TODAY) return t('database.autoToday');
  if (prop.type === 'checkbox') return value === true ? t('database.autoTicked') : t('database.autoUnticked');
  if (prop.type === 'select' || prop.type === 'multiSelect')
    return prop.options.find((option) => option.id === value)?.name ?? '?';
  return String(value ?? '');
}

// the database's automations as sentences, and a sentence to make a new one
export function AutomationsPanel({ dbId, database }: { dbId: PageId; database: DatabaseDef }) {
  const watchable = database.properties.filter((prop) =>
    ['select', 'multiSelect', 'checkbox'].includes(prop.type),
  );
  const settable = database.properties.filter((prop) =>
    ['select', 'multiSelect', 'checkbox', 'date', 'text', 'number'].includes(prop.type),
  );
  const [whenProp, setWhenProp] = useState(watchable[0]?.id ?? '');
  const [whenValue, setWhenValue] = useState('');
  const [thenProp, setThenProp] = useState('');
  const [thenValue, setThenValue] = useState('');
  const byId = (id: string) => database.properties.find((prop) => prop.id === id);
  const automations = database.automations ?? [];
  const whenChoices = valueChoices(byId(whenProp), false);
  const thenChoices = valueChoices(byId(thenProp), true);
  const save = (next: Automation[]) => updateDatabase(dbId, (current) => ({ ...current, automations: next }));
  const add = () => {
    const wantedWhen = whenValue || whenChoices[0]?.value;
    const thenDef = byId(thenProp);
    const wantedThen = thenValue || thenChoices[0]?.value;
    if (!wantedWhen || !thenDef || wantedThen === undefined || wantedThen === '') return;
    save([
      ...automations,
      {
        id: newId(),
        when: { prop: whenProp, value: readValue(byId(whenProp), wantedWhen) },
        then: { prop: thenProp, value: wantedThen === TODAY ? TODAY : readValue(thenDef, wantedThen) },
      },
    ]);
    setThenValue('');
  };
  if (watchable.length === 0) return <p className="muted small">{t('database.autoNeedsSelect')}</p>;
  return (
    <div className="db-automations">
      {automations.length === 0 ? (
        <p className="muted small">{t('database.autoNone')}</p>
      ) : (
        <ul className="db-automation-list">
          {automations.map((automation) => {
            const when = byId(automation.when.prop);
            const then = byId(automation.then.prop);
            return (
              <li key={automation.id}>
                <span>
                  {t('database.autoSentence', {
                    when: when?.name ?? '?',
                    whenValue: describe(when, automation.when.value),
                    then: then?.name ?? '?',
                    thenValue: describe(then, automation.then.value),
                  })}
                </span>
                <button
                  type="button"
                  className="icon-button tiny"
                  aria-label={t('common.remove')}
                  onClick={() => save(automations.filter((item) => item.id !== automation.id))}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="db-automation-new">
        <span>{t('database.autoWhen')}</span>
        <select
          className="text-input small"
          value={whenProp}
          onChange={(event) => setWhenProp(event.target.value)}
        >
          {watchable.map((prop) => (
            <option key={prop.id} value={prop.id}>
              {prop.name}
            </option>
          ))}
        </select>
        <span>{t('database.autoBecomes')}</span>
        <select
          className="text-input small"
          value={whenValue}
          onChange={(event) => setWhenValue(event.target.value)}
        >
          {whenChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <ArrowRight size={14} />
        <span>{t('database.autoSet')}</span>
        <select
          className="text-input small"
          value={thenProp}
          onChange={(event) => {
            setThenProp(event.target.value);
            setThenValue('');
          }}
        >
          <option value="">—</option>
          {settable
            .filter((prop) => prop.id !== whenProp)
            .map((prop) => (
              <option key={prop.id} value={prop.id}>
                {prop.name}
              </option>
            ))}
        </select>
        <span>{t('database.autoTo')}</span>
        {thenChoices.length ? (
          <select
            className="text-input small"
            value={thenValue}
            onChange={(event) => setThenValue(event.target.value)}
          >
            {thenChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="text-input small"
            value={thenValue}
            disabled={!thenProp}
            onChange={(event) => setThenValue(event.target.value)}
          />
        )}
        <button type="button" className="button small primary" disabled={!thenProp} onClick={add}>
          {t('common.add')}
        </button>
      </div>
    </div>
  );
}
