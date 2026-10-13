import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ChevronDown, ChevronUp, Replace, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '../ui';
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
    <div className="find-bar popover" role="search" aria-label="Find and replace" onKeyDown={keys}>
      <div className="find-row">
        <input
          ref={inputRef}
          className="find-input"
          placeholder="Find in page"
          aria-label="Find in page"
          value={query}
          onChange={(event) => update(event.target.value)}
        />
        <span className="find-count" aria-live="polite">
          {query ? (find.count ? `${find.current + 1} of ${find.count}` : 'No results') : ''}
        </span>
        <button
          type="button"
          className="icon-button small"
          aria-label="Previous match"
          onClick={() => step(-1)}
        >
          <ChevronUp size={15} />
        </button>
        <button type="button" className="icon-button small" aria-label="Next match" onClick={() => step(1)}>
          <ChevronDown size={15} />
        </button>
        <button
          type="button"
          className={`icon-button small${replacing ? ' is-active' : ''}`}
          aria-label="Replace"
          aria-pressed={replacing}
          onClick={() => setReplacing((value) => !value)}
        >
          <Replace size={15} />
        </button>
        <button type="button" className="icon-button small" aria-label="Close find" onClick={close}>
          <X size={15} />
        </button>
      </div>
      {replacing && (
        <div className="find-row">
          <input
            className="find-input"
            placeholder="Replace with"
            aria-label="Replace with"
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
            Replace
          </button>
          <button
            type="button"
            className="button small"
            disabled={!find.count}
            onClick={() => {
              const count = replaceAll(editor.state, editor.view.dispatch, replacement);
              toast(`Replaced ${count} match${count === 1 ? '' : 'es'}.`, {
                action: { label: 'Undo', run: () => editor.commands.undo() },
              });
            }}
          >
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}
