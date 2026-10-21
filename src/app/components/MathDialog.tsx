import katex from 'katex';
import { useMemo, useState } from 'react';
import { formatShortcut } from '../actions';
import { openHref } from '../editor/EditorMenus';
import { useTranslation } from '../i18n';
import { closeDialog } from '../ui';
import { Dialog } from './primitives';

// edits a formula with a live preview, drawn the way it shows in the page
export function MathDialog({
  value,
  block,
  onSave,
  onCancel,
}: {
  value: string;
  block: boolean;
  onSave: (latex: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  // katex output is plain markup, it never runs scripts or loads anything. a mistake shows in red in place
  const preview = useMemo(
    () =>
      text.trim()
        ? katex.renderToString(text, {
            throwOnError: false,
            displayMode: block,
            strict: false,
            trust: false,
          })
        : null,
    [text, block],
  );

  const cancel = () => {
    closeDialog();
    onCancel?.();
  };
  const save = () => {
    closeDialog();
    onSave(text);
  };

  return (
    <Dialog
      title={t('math.editTitle')}
      onClose={cancel}
      className="math-dialog"
      footer={
        <>
          <button
            type="button"
            className="link-button dialog-hint"
            onClick={() => openHref('https://katex.org/docs/supported')}
          >
            {t('math.learnMore')}
          </button>
          <span className="muted small">{t('math.saveHint', { shortcut: formatShortcut('Mod+Enter') })}</span>
          <button type="button" className="button" onClick={cancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="button primary" onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <textarea
        className="text-input math-input"
        data-autofocus
        spellCheck={false}
        rows={3}
        aria-label={t('math.latexLabel')}
        placeholder="e = mc^2"
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
        <div
          className="math-preview"
          aria-label={t('math.previewLabel')}
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      )}
    </Dialog>
  );
}
