import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ChevronDown, ChevronUp, Replace, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '../ui';
import { t } from '../i18n';
import { getFindState, replaceAll, replaceCurrent, setFindQuery, stepFind } from './Blocks';

export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [replacing, setReplacing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const find = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = getFindState(current.state);
      return { count: state.matches.length, current: state.current };
    },
  });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const dispatch = editor.view.dispatch;
    return () => {
      if (!editor.isDestroyed) setFindQuery(editor.state, dispatch, '');
    };
  }, [editor]);

  const update = (value: string) => {
    setQuery(value);
    setFindQuery(editor.state, editor.view.dispatch, value);
  };
  const step = (direction: 1 | -1) => stepFind(editor.state, editor.view.dispatch, direction);
  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' && event.currentTarget === inputRef.current) {
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
          {query ? (find.count ? `${find.current + 1} of ${find.count}` : t('editor.noResults')) : ''}
        </span>
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
              const count = replaceAll(editor.state, editor.view.dispatch, replacement);
              toast(
                count === 1
                  ? t('toasts.replacedMatchesSingle')
                  : t('toasts.replacedMatchesPlural', { count }),
                { action: { label: t('toasts.undo'), run: () => editor.commands.undo() } },
              );
            }}
          >
            {t('editor.replaceAll')}
          </button>
        </div>
      )}
    </div>
  );
}
