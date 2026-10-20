import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { foldText } from '../../core/search';
import { desktop } from '../platform/desktop';
import type { SpellingLanguages } from '../platform/desktop';
import { Popover } from './Popover';
import { SettingRow } from './SettingsRows';

const names = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' });
  } catch {
    return null;
  }
})();
const nameOf = (code: string) => names?.of(code) ?? code;

// the languages spelling is checked in, several at once for people who write in more than one
export function SpellingSetting() {
  const [spelling, setSpelling] = useState<SpellingLanguages | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    void desktop?.spelling
      .get()
      .then(setSpelling)
      .catch(() => undefined);
  }, []);
  const shown = useMemo(() => {
    const folded = foldText(query.trim());
    return (spelling?.available ?? [])
      .map((code) => ({ code, name: nameOf(code) }))
      .filter((item) => !folded || foldText(`${item.name} ${item.code}`).includes(folded))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [spelling, query]);
  if (!spelling || spelling.available.length === 0) return null;
  const save = (languages: string[] | null) =>
    void desktop?.spelling
      .set(languages)
      .then(setSpelling)
      .catch(() => undefined);
  const toggle = (code: string) => {
    const current = spelling.active;
    save(current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  };
  return (
    <SettingRow
      label="Spelling"
      help={spelling.chosen ? 'Checked in every language picked.' : 'Follows the languages of this computer.'}
    >
      <button type="button" className="select-button" onClick={(event) => setAnchor(event.currentTarget)}>
        <span className="select-value">{spelling.active.map(nameOf).join(', ') || 'Off'}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} label="Spelling" className="spelling-picker">
          <input
            className="text-input small"
            placeholder="Find a language"
            aria-label="Find a language"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <ul className="spelling-list" role="listbox" aria-multiselectable="true" aria-label="Spelling">
            {!query && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={spelling.chosen === null}
                  className="spelling-option"
                  onClick={() => save(null)}
                >
                  <span className="spelling-check">{spelling.chosen === null && <Check size={13} />}</span>
                  Languages of this computer
                </button>
              </li>
            )}
            {shown.map((item) => {
              const on = spelling.chosen !== null && spelling.active.includes(item.code);
              return (
                <li key={item.code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    className="spelling-option"
                    onClick={() => toggle(item.code)}
                  >
                    <span className="spelling-check">{on && <Check size={13} />}</span>
                    {item.name}
                    <span className="muted small">{item.code}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Popover>
      )}
    </SettingRow>
  );
}
