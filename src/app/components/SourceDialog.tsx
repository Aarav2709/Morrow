import katex from 'katex';
import { useMemo, useState } from 'react';
import { closeDialog } from '../ui';
import { formatShortcut } from '../actions';
import { Dialog } from './primitives';

// edits a formula with a live preview, or markdown that morrow keeps exactly as written
export function SourceDialog({
  title,
  value,
  language,
  displayMode,
  onSave,
}: {
  title: string;
  value: string;
  language: 'latex' | 'markdown';
  displayMode?: boolean;
  onSave: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const preview = useMemo(() => {
    if (language !== 'latex' || !text.trim()) return null;
    // katex output is plain markup, it never runs scripts or loads anything
    return katex.renderToString(text, {
      throwOnError: false,
      displayMode: displayMode ?? false,
      strict: false,
      trust: false,
    });
  }, [text, language, displayMode]);
  const save = () => {
    closeDialog();
    onSave(text);
  };
  return (
    <Dialog
      title={title}
      onClose={closeDialog}
      footer={
        <>
          <span className="muted small dialog-hint">{formatShortcut('Mod+Enter')} to save</span>
          <button type="button" className="button" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <textarea
        className="text-input source-input"
        data-autofocus
        spellCheck={false}
        rows={language === 'latex' ? 4 : 10}
        aria-label={language === 'latex' ? 'Formula in LaTeX' : 'Markdown'}
        placeholder={language === 'latex' ? 'e = mc^2' : ''}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      {preview && (
        <div className="math-preview" aria-label="Preview" dangerouslySetInnerHTML={{ __html: preview }} />
      )}
    </Dialog>
  );
}
