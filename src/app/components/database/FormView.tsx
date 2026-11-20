import { Check } from 'lucide-react';
import { useState } from 'react';
import type { DatabaseDef, PageId, PropDef, PropValue } from '../../../core/model';
import { t } from '../../i18n';
import { toast } from '../../ui';
import { DateField } from '../MonthPicker';
import { Switch } from '../primitives';
import { createRow } from './data';

// the properties a form asks for: all but those worked out by themselves
export function formFields(database: DatabaseDef, hidden: string[]): PropDef[] {
  return database.properties.filter((prop) => prop.type !== 'formula' && !hidden.includes(prop.id));
}

// a filled in form as a row's values, the empty answers left out
export function formValues(fields: PropDef[], answers: Record<string, PropValue>): Record<string, PropValue> {
  const values: Record<string, PropValue> = {};
  for (const prop of fields) {
    const value = answers[prop.id];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))
      continue;
    if (prop.type === 'number') {
      const number = Number(value);
      if (Number.isFinite(number)) values[prop.id] = number;
      continue;
    }
    if (prop.type === 'relation' && typeof value === 'string') {
      const names = value
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      if (names.length) values[prop.id] = names;
      continue;
    }
    values[prop.id] = value;
  }
  return values;
}

// a new row asked for one question at a time, the way a form is filled in: its name and each property the
// view shows. sending it adds the row and leaves the form empty for the next one
export function FormView({
  dbId,
  database,
  hidden,
  editable,
}: {
  dbId: PageId;
  database: DatabaseDef;
  hidden: string[];
  editable: boolean;
}) {
  const fields = formFields(database, hidden);
  const [title, setTitle] = useState('');
  const [answers, setAnswers] = useState<Record<string, PropValue>>({});
  const answer = (id: string, value: PropValue) => setAnswers((current) => ({ ...current, [id]: value }));
  const send = () => {
    if (!title.trim()) {
      toast(t('database.formNeedsName'), { tone: 'error' });
      return;
    }
    if (createRow(dbId, formValues(fields, answers), title.trim())) {
      setTitle('');
      setAnswers({});
      toast(t('database.formSent'), { durationMs: 2500 });
    }
  };
  return (
    <form
      className="db-form"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <label className="db-form-field">
        <span className="db-form-label">
          {t('database.name')} <span className="db-form-required">*</span>
        </span>
        <input
          className="text-input"
          value={title}
          disabled={!editable}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      {fields.map((prop) => (
        <div key={prop.id} className="db-form-field">
          <span className="db-form-label">{prop.name}</span>
          <FormInput
            prop={prop}
            value={answers[prop.id] ?? null}
            editable={editable}
            onChange={(value) => answer(prop.id, value)}
          />
        </div>
      ))}
      <button type="submit" className="button primary" disabled={!editable}>
        <Check size={14} /> {t('database.formSend')}
      </button>
    </form>
  );
}

function FormInput({
  prop,
  value,
  editable,
  onChange,
}: {
  prop: PropDef;
  value: PropValue;
  editable: boolean;
  onChange: (value: PropValue) => void;
}) {
  switch (prop.type) {
    case 'checkbox':
      return <Switch label={prop.name} checked={value === true} disabled={!editable} onChange={onChange} />;
    case 'date':
      return (
        <DateField
          label={prop.name}
          value={typeof value === 'string' ? value : null}
          disabled={!editable}
          placeholder={t('database.formPickDate')}
          onChange={onChange}
        />
      );
    case 'select':
      return (
        <div className="db-form-options" role="radiogroup" aria-label={prop.name}>
          {prop.options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={value === option.id}
              disabled={!editable}
              className={`chip color-${option.color}${value === option.id ? ' is-on' : ''}`}
              onClick={() => onChange(value === option.id ? null : option.id)}
            >
              {option.name}
            </button>
          ))}
        </div>
      );
    case 'multiSelect': {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <div className="db-form-options" role="group" aria-label={prop.name}>
          {prop.options.map((option) => {
            const on = chosen.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={on}
                disabled={!editable}
                className={`chip color-${option.color}${on ? ' is-on' : ''}`}
                onClick={() =>
                  onChange(on ? chosen.filter((id) => id !== option.id) : [...chosen, option.id])
                }
              >
                {option.name}
              </button>
            );
          })}
        </div>
      );
    }
    default:
      return (
        <input
          className="text-input"
          type={prop.type === 'number' ? 'number' : prop.type === 'url' ? 'url' : 'text'}
          placeholder={prop.type === 'relation' ? t('database.formRelationHint') : undefined}
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          disabled={!editable}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}
