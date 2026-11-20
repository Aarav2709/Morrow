import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { desktop } from '../platform/desktop';

// the small box the shortcut brings up over any app. what is written goes to today's note, written by the
// main window, which stays where it was. enter saves, shift and enter starts a new line, escape closes
export function QuickCaptureWindow() {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const focus = () => requestAnimationFrame(() => input.current?.focus());
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);

  const save = () => {
    const note = text.trim();
    if (!note) return void desktop?.hideCapture?.();
    void desktop?.captureSubmit?.(note);
    setText('');
  };

  return (
    <div className="quick-capture-window">
      <textarea
        ref={input}
        className="quick-capture-input"
        placeholder={t('dialogs.quickNotePlaceholder')}
        aria-label={t('dialogs.quickNotePlaceholder')}
        value={text}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            void desktop?.hideCapture?.();
          }
        }}
      />
      <div className="quick-capture-hint">{t('dialogs.captureWindowHint')}</div>
    </div>
  );
}
