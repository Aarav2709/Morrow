import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ChevronDown, ChevronUp, Regex, Replace, X, CaseSensitive } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '../ui';
import { t } from '../i18n';
import { getFindState, replaceAll, replaceCurrent, setFindQuery, setFindRange, stepFind } from './Blocks';

interface Props {
  editor: Editor;
  // the words picked on the page when ctrl f was pressed, n tells each press apart
  seed: { text: string; n: number };
  onClose: () => void;
}

export function FindBar({ editor, seed, onClose }: Props) {
  const [query, setQuery] = useState(seed.text);
  const [seeded, setSeeded] = useState(seed);
  // every press of ctrl f fills in what is picked on the page, or keeps the last search when nothing is
  if (seeded !== seed) {
    setSeeded(seed);
    if (seed.text) setQuery(seed.text);
  }
  const [replacement, setReplacement] = useState('');
  const [replacing, setReplacing] = useState(false);
  // matches from one number to another, the way the count shows them, for replacing only some
  const [range, setRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const inputRef = useRef<HTMLInputElement>(null);
  const find = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = getFindState(current.state);
      return {
        count: state.matches.length,
        current: state.current,
        regex: state.regex,
        caseSensitive: state.caseSensitive ?? false,
        range: state.range ?? null,
      };
    },
  });

  useEffect(() => {
    const dispatch = editor.view.dispatch;
    return () => {
      if (!editor.isDestroyed) setFindQuery(editor.state, dispatch, '');
    };
  }, [editor]);

  useEffect(() => {
    if (seed.text) {
      setFindQuery(editor.state, editor.view.dispatch, seed.text);
      requestAnimationFrame(() =>
        editor.view.dom.querySelector('.find-match.is-current')?.scrollIntoView({ block: 'center' }),
      );
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editor, seed]);

  // the match being looked at is brought into view, also while the cursor stays in the find bar
  const reveal = () =>
    requestAnimationFrame(() =>
      editor.view.dom
        .querySelector('.find-match.is-current')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  // the numbers typed for the range narrow the search as they are typed, an empty one means the first or
  // the last match
  const narrow = (next: { from: string; to: string }) => {
    setRange(next);
    const count = getFindState(editor.state).matches.length;
    if (!next.from.trim() && !next.to.trim()) {
      setFindRange(editor.state, editor.view.dispatch, null);
      return;
    }
    const first = Math.max(1, Math.floor(Number(next.from) || 1));
    const last = Math.min(count, Math.floor(Number(next.to) || count));
    if (last < first) return;
    setFindRange(editor.state, editor.view.dispatch, { first, last });
    reveal();
  };
  const update = (value: string, regex = find.regex, caseSensitive = find.caseSensitive) => {
    setQuery(value);
    setRange({ from: '', to: '' });
    setFindQuery(editor.state, editor.view.dispatch, value, regex, caseSensitive);
    reveal();
  };
  const step = (direction: 1 | -1) => {
    stepFind(editor.state, editor.view.dispatch, direction);
    reveal();
  };
  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' && event.target === inputRef.current) {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  };

  return (
    <div className="find-bar popover" role="search" aria-label={t('editor.findAndReplace')} onKeyDown={keys}>
      <div className="find-row">
        <input
          ref={inputRef}
          className="find-input"
          placeholder={t('editor.findInPage')}
          aria-label={t('editor.findInPage')}
          value={query}
          onChange={(event) => update(event.target.value)}
        />
        <span className="find-count" aria-live="polite">
          {query
            ? find.count
              ? find.range
                ? t('editor.matchInRange', {
                    current: find.current + 1,
                    count: find.count,
                    first: find.range.first,
                    last: find.range.last,
                  })
                : `${find.current + 1} of ${find.count}`
              : t('editor.noResults')
            : ''}
        </span>
        <button
          type="button"
          className={`icon-button small${find.caseSensitive ? ' is-active' : ''}`}
          aria-label={t('editor.matchCase')}
          title={t('editor.matchCase')}
          aria-pressed={find.caseSensitive}
          onClick={() => update(query, find.regex, !find.caseSensitive)}
        >
          <CaseSensitive size={15} />
        </button>
        <button
          type="button"
          className={`icon-button small${find.regex ? ' is-active' : ''}`}
          aria-label={t('editor.useRegex')}
          title={t('editor.useRegex')}
          aria-pressed={find.regex}
          onClick={() => update(query, !find.regex)}
        >
          <Regex size={15} />
        </button>
        <button
          type="button"
          className="icon-button small"
          aria-label={t('editor.previousMatch')}
          onClick={() => step(-1)}
        >
          <ChevronUp size={15} />
        </button>
        <button
          type="button"
          className="icon-button small"
          aria-label={t('editor.nextMatch')}
          onClick={() => step(1)}
        >
          <ChevronDown size={15} />
        </button>
        <button
          type="button"
          className={`icon-button small${replacing ? ' is-active' : ''}`}
          aria-label={t('editor.replace')}
          aria-pressed={replacing}
          onClick={() => setReplacing((value) => !value)}
        >
          <Replace size={15} />
        </button>
        <button
          type="button"
          className="icon-button small"
          aria-label={t('editor.closeFind')}
          onClick={close}
        >
          <X size={15} />
        </button>
      </div>
      {replacing && (
        <div className="find-row">
          <input
            className="find-input"
            placeholder={t('editor.replaceWith')}
            aria-label={t('editor.replaceWith')}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                replaceCurrent(editor.state, editor.view.dispatch, replacement);
              }
            }}
          />
          <button
            type="button"
            className="button small"
            disabled={!find.count}
            onClick={() => replaceCurrent(editor.state, editor.view.dispatch, replacement)}
          >
            {t('editor.replace')}
          </button>
          <button
            type="button"
            className="button small"
            disabled={!find.count}
            onClick={() => {
              // with a range, only the matches in it, the way they are lit
              const count = replaceAll(editor.state, editor.view.dispatch, replacement);
              setRange({ from: '', to: '' });
              toast(
                count === 1
                  ? t('toasts.replacedMatchesSingle')
                  : t('toasts.replacedMatchesPlural', { count }),
                { action: { label: t('toasts.undo'), run: () => editor.commands.undo() } },
              );
            }}
          >
            {find.range ? t('editor.replaceThese') : t('editor.replaceAll')}
          </button>
        </div>
      )}
      {replacing && find.count > 1 && (
        <div className="find-row find-range">
          <span className="find-range-label">{t('editor.replaceMatches')}</span>
          <input
            className="find-input find-number"
            type="number"
            inputMode="numeric"
            min={1}
            max={find.count}
            placeholder="1"
            aria-label={t('editor.replaceFrom')}
            value={range.from}
            onChange={(event) => narrow({ ...range, from: event.target.value })}
          />
          <span className="find-range-label">{t('editor.replaceTo')}</span>
          <input
            className="find-input find-number"
            type="number"
            inputMode="numeric"
            min={1}
            max={find.count}
            placeholder={String(find.count)}
            aria-label={t('editor.replaceUntil')}
            value={range.to}
            onChange={(event) => narrow({ ...range, to: event.target.value })}
          />
          {find.range && (
            <button
              type="button"
              className="icon-button small"
              aria-label={t('editor.replaceEveryMatch')}
              title={t('editor.replaceEveryMatch')}
              onClick={() => narrow({ from: '', to: '' })}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
