import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import type { Placement } from '@floating-ui/dom';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type MenuEntry =
  | {
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect: () => void;
    }
  | { separator: true }
  | { heading: string };

interface MenuProps {
  anchor: HTMLElement | DOMRect;
  entries: MenuEntry[];
  onClose: () => void;
  placement?: Placement;
  label: string;
}

export function Menu({ anchor, entries, onClose, placement = 'bottom-start', label }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reference = anchor instanceof HTMLElement ? anchor : { getBoundingClientRect: () => anchor };
    void computePosition(reference, element, {
      placement,
      strategy: 'fixed',
      middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.visibility = 'visible';
    });
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [anchor, placement]);

  useEffect(() => {
    const trigger = anchor instanceof HTMLElement ? anchor : null;
    const onPointer = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      if (trigger?.contains(event.target as Node)) return;
      closeRef.current();
    };
    const onBlurWindow = () => closeRef.current();
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('blur', onBlurWindow);
    window.addEventListener('resize', onBlurWindow);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('blur', onBlurWindow);
      window.removeEventListener('resize', onBlurWindow);
      // give focus back to whatever opened the menu
      if (trigger?.isConnected && document.activeElement === document.body) trigger.focus({ preventScroll: true });
    };
  }, [anchor]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      buttons[(index + 1) % buttons.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      buttons[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      buttons[buttons.length - 1]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="menu popover floating-layer"
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ visibility: 'hidden' }}
    >
      {entries.map((entry, index) => {
        if ('separator' in entry) return <div key={index} className="menu-separator" role="separator" />;
        if ('heading' in entry)
          return (
            <div key={index} className="menu-section">
              {entry.heading}
            </div>
          );
        const Icon = entry.icon;
        return (
          <button
            key={index}
            type="button"
            role={entry.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={entry.checked}
            className={`menu-item${entry.danger ? ' is-danger' : ''}`}
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
          >
            <span className="menu-icon">{Icon && <Icon size={15} strokeWidth={1.75} />}</span>
            <span className="menu-label">{entry.label}</span>
            {entry.checked && <span className="menu-check">✓</span>}
            {entry.shortcut && <kbd className="menu-shortcut">{entry.shortcut}</kbd>}
          </button>
        );
      })}
    </div>,
    // inside the main landmark so assistive tech finds the menu where the page lives
    document.querySelector('main') ?? document.body,
  );
}
