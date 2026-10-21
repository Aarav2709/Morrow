import { useState } from 'react';
import { formatShortcut } from '../actions';
import { captureToToday } from '../operations';
import { useTranslation } from '../i18n';
import { closeDialog, toast } from '../ui';
import { Dialog } from './primitives';

// jot something down from anywhere, it lands at the end of today's note
export function CaptureDialog() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const save = () => {
    if (!text.trim()) return closeDialog();
    if (captureToToday(text)) {
      closeDialog();
      toast(t('toasts.addedToToday'));
    }
  };
  return (
    <Dialog
      title={t('dialogs.quickNote')}
      size="small"
      onClose={closeDialog}
      footer={
        <>
          <span className="muted small dialog-hint">
            {t('common.toSave', { shortcut: formatShortcut('Mod+Enter') })}
          </span>
          <button type="button" className="button" onClick={closeDialog}>
            {t('common.cancel')}
          </button>
          <button type="button" className="button primary" onClick={save}>
            {t('dialogs.addToToday')}
          </button>
        </>
      }
    >
      <textarea
        className="text-input capture-input"
        data-autofocus
        rows={5}
        aria-label={t('dialogs.quickNote')}
        placeholder={t('dialogs.quickNotePlaceholder')}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
    </Dialog>
  );
}
