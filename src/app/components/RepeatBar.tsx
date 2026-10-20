import { Repeat as RepeatIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageId, PageMeta } from '../../core/model';
import {
  INTO_KEY,
  LAST_KEY,
  pagePath,
  recurrenceOf,
  REPEAT_KEY,
  REPEATS,
  withRecurrence,
} from '../../core/recurring';
import type { Repeat } from '../../core/recurring';
import { foldText } from '../../core/search';
import { findTemplatesPage } from '../../core/templates';
import { flattenTree, isDescendantOf } from '../../core/tree';
import { run, useWorkspace } from '../workspace';
import { Popover } from './Popover';
import { Select } from './Select';

const REPEAT_LABELS: Record<Repeat | 'off', string> = {
  off: 'Never',
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
};

// on a template: how often it makes a page by itself, and where those pages go
export function RepeatBar({ page, editable }: { page: PageMeta; editable: boolean }) {
  const state = useWorkspace();
  const recurrence = recurrenceOf(state, page);
  const [picking, setPicking] = useState<HTMLElement | null>(null);
  const save = (changes: Parameters<typeof withRecurrence>[1]) =>
    run({ type: 'page.setFields', id: page.id, extra: withRecurrence(page.extra, changes), now: Date.now() });
  const into = recurrence?.into ? state.pages[recurrence.into] : null;
  return (
    <div className="repeat-bar">
      <RepeatIcon size={14} aria-hidden="true" />
      <Select<Repeat | 'off'>
        label="Repeat"
        value={recurrence?.repeat ?? 'off'}
        options={(['off', ...REPEATS] as const).map((value) => ({ value, label: REPEAT_LABELS[value] }))}
        disabled={!editable}
        onChange={(value) =>
          save(
            value === 'off'
              ? { [REPEAT_KEY]: null, [INTO_KEY]: null, [LAST_KEY]: null }
              : { [REPEAT_KEY]: value },
          )
        }
      />
      {recurrence && (
        <>
          <span className="muted">makes a new page in</span>
          <button
            type="button"
            className="button small"
            disabled={!editable}
            onClick={(event) => setPicking(event.currentTarget)}
          >
            {into ? displayTitle(into) : 'Top level'}
          </button>
        </>
      )}
      {picking && (
        <Popover
          anchor={picking}
          onClose={() => setPicking(null)}
          label="Where new pages go"
          className="repeat-picker"
        >
          <DestinationList
            exclude={findTemplatesPage(state)?.id ?? null}
            onPick={(id) => {
              save({ [INTO_KEY]: id ? `[[${pagePath(state, id)}]]` : null });
              setPicking(null);
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function DestinationList({
  exclude,
  onPick,
}: {
  exclude: PageId | null;
  onPick: (id: PageId | null) => void;
}) {
  const state = useWorkspace();
  const [query, setQuery] = useState('');
  const targets = useMemo(() => {
    const folded = foldText(query.trim());
    return flattenTree(state.pages)
      .filter(
        ({ page }) => !exclude || (page.id !== exclude && !isDescendantOf(state.pages, page.id, exclude)),
      )
      .filter(({ page }) => !folded || foldText(displayTitle(page)).includes(folded))
      .slice(0, 200);
  }, [state.pages, exclude, query]);
  return (
    <>
      <input
        className="text-input small"
        placeholder="Find a page"
        aria-label="Find a page"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      <ul className="move-list" role="listbox" aria-label="Destinations">
        {!query && (
          <li>
            <button type="button" className="move-target" onClick={() => onPick(null)}>
              Top level
            </button>
          </li>
        )}
        {targets.map(({ page, depth }) => (
          <li key={page.id}>
            <button
              type="button"
              className="move-target"
              style={{ paddingLeft: `${12 + (query ? 0 : depth * 16)}px` }}
              onClick={() => onPick(page.id)}
            >
              {displayTitle(page)}
            </button>
          </li>
        ))}
        {targets.length === 0 && <li className="muted move-empty">No matching pages.</li>}
      </ul>
    </>
  );
}
