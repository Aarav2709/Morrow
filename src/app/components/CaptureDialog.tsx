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
      title="Quick note"
      size="small"
      onClose={closeDialog}
      footer={
        <>
          <span className="muted small dialog-hint">{formatShortcut('Mod+Enter')} to save</span>
          <button type="button" className="button" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={save}>
            Add to today
          </button>
        </>
      }
    >
      <textarea
        className="text-input capture-input"
        data-autofocus
        rows={5}
        aria-label="Quick note"
        placeholder="What's on your mind? Start with [ ] to make it a task."
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
