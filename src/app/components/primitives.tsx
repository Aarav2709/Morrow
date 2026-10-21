import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { dismissToast, useUi } from '../ui';
import { dialogOpened } from '../platform/desktop';
import { getLocale, t } from '../i18n';

// a sun on the horizon, drawn in code so it carries no third party license
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 15a7 7 0 0 1 14 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M2.5 15h19" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 19h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'small' | 'medium' | 'large';
  className?: string;
  hideTitle?: boolean;
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  size = 'medium',
  className,
  hideTitle,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = ref.current;
    const focusable = element?.querySelector<HTMLElement>(
      '[data-autofocus], input, button:not(.dialog-close), [tabindex="0"]',
    );
    (focusable ?? element)?.focus();
    const onKey = (event: KeyboardEvent) => {
      // a menu or dropdown open over the dialog closes first
      if ((event.target as HTMLElement | null)?.closest?.('.floating-layer')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab' && element) {
        const items = Array.from(
          element.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]'),
        ).filter((item) => !item.hasAttribute('disabled'));
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const closed = dialogOpened();
    return () => {
      closed();
      document.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={ref}
        className={`dialog dialog-${size}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={`dialog-header${hideTitle ? ' visually-hidden' : ''}`}>
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button dialog-close"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function Toasts() {
  const { toasts } = useUi();
  return (
    <div className="toasts">
      {toasts.map((entry) => (
        <div
          key={entry.id}
          className={`toast${entry.tone === 'error' ? ' is-error' : ''}`}
          role={entry.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{entry.message}</span>
          {entry.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                entry.action!.run();
                dismissToast(entry.id);
              }}
            >
              {entry.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            aria-label={t('common.dismiss')}
            onClick={() => dismissToast(entry.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

const formatters = new Map<string, Intl.RelativeTimeFormat>();
function getRtf(locale: string): Intl.RelativeTimeFormat | null {
  if (typeof Intl === 'undefined' || !Intl.RelativeTimeFormat) return null;
  let formatter = formatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    formatters.set(locale, formatter);
  }
  return formatter;
}

export function relativeTime(timestamp: number, now = Date.now(), localeOverride?: string): string {
  const locale = localeOverride ?? getLocale();
  const seconds = Math.round((timestamp - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return t('common.justNow');
  const rtf = getRtf(locale);
  if (!rtf) return new Date(timestamp).toLocaleString(locale);
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(seconds / 86400), 'day');
  return new Date(timestamp).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: abs > 86400 * 300 ? 'numeric' : undefined,
  });
}

// long lists start short with the rest a click away, so a big vault never draws thousands of rows at once
export function useShowMore<T>(items: T[], limit: number): { shown: T[]; more: ReactNode } {
  const [count, setCount] = useState(limit);
  const rest = items.length - count;
  return {
    shown: rest > 0 ? items.slice(0, count) : items,
    more:
      rest > 0 ? (
        <button type="button" className="link-button show-more" onClick={() => setCount(count + limit * 4)}>
          {t('common.showMore', { count: Math.min(rest, limit * 4) })}
        </button>
      ) : null,
  };
}
