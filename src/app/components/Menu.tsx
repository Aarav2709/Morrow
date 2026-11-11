import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import type { Placement } from '@floating-ui/dom';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  // a row that opens more choices beside the menu, the way nested menus work everywhere
  | { label: string; icon?: LucideIcon; checked?: boolean; submenu: MenuEntry[] }
  | { separator: true }
  | { heading: string; title?: string };

interface MenuProps {
  anchor: HTMLElement | DOMRect;
  entries: MenuEntry[];
  onClose: () => void;
  placement?: Placement;
  label: string;
  // set on a submenu: picking in it closes the whole menu, not only the submenu
  onPicked?: () => void;
}

export function Menu({ anchor, entries, onClose, placement = 'bottom-start', label, onPicked }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ index: number; button: HTMLButtonElement; focus: boolean } | null>(
    null,
  );
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
      // shifted on both axes, so a tall menu opened near an edge is moved back in rather than cut off
      middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8, crossAxis: true })],
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
      // a submenu opened from this one is part of it
      if (!onPicked && (event.target as Element | null)?.closest?.('[data-submenu]')) return;
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
      if (trigger?.isConnected && document.activeElement === document.body)
        trigger.focus({ preventScroll: true });
    };
  }, [anchor]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    // keys pressed in a submenu reach this menu too through react, they belong to the submenu
    if (!ref.current?.contains(event.target as Node)) return;
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
    } else if (event.key === 'ArrowRight') {
      const button = document.activeElement as HTMLButtonElement;
      const index = Number(button?.dataset.submenuIndex);
      if (button && Number.isInteger(index)) {
        event.preventDefault();
        setOpen({ index, button, focus: true });
      }
    } else if (event.key === 'ArrowLeft' && onPicked) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
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
      data-submenu={onPicked ? '' : undefined}
    >
      {entries.map((entry, index) => {
        if ('separator' in entry) return <div key={index} className="menu-separator" role="separator" />;
        if ('heading' in entry)
          return (
            <div key={index} className="menu-section" title={entry.title}>
              {entry.heading}
            </div>
          );
        const Icon = entry.icon;
        if ('submenu' in entry)
          return (
            <button
              key={index}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open?.index === index}
              data-submenu-index={index}
              className={`menu-item${open?.index === index ? ' is-open' : ''}`}
              onMouseEnter={(event) => setOpen({ index, button: event.currentTarget, focus: false })}
              onClick={(event) => setOpen({ index, button: event.currentTarget, focus: true })}
            >
              <span className="menu-icon">{Icon && <Icon size={15} strokeWidth={1.75} />}</span>
              <span className="menu-label">{entry.label}</span>
              {entry.checked && <span className="menu-check">✓</span>}
              <span className="menu-arrow">
                <ChevronRight size={14} strokeWidth={1.75} />
              </span>
            </button>
          );
        return (
          <button
            key={index}
            type="button"
            role={entry.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={entry.checked}
            className={`menu-item${entry.danger ? ' is-danger' : ''}`}
            disabled={entry.disabled}
            onMouseEnter={() => setOpen(null)}
            onClick={() => {
              (onPicked ?? onClose)();
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
      {open && 'submenu' in (entries[open.index] ?? {}) && (
        <Submenu
          key={open.index}
          anchor={open.button}
          entries={(entries[open.index] as { submenu: MenuEntry[] }).submenu}
          label={(entries[open.index] as { label: string }).label}
          focus={open.focus}
          onClose={() => {
            setOpen(null);
            open.button.focus({ preventScroll: true });
          }}
          onPicked={onPicked ?? onClose}
        />
      )}
    </div>,
    // inside the main landmark so assistive tech finds the menu where the page lives
    document.querySelector('main') ?? document.body,
  );
}

// a submenu takes focus only when opened from the keyboard or a click, hovering leaves it on the row
function Submenu({
  focus,
  ...props
}: Omit<MenuProps, 'placement'> & { anchor: HTMLElement; focus: boolean; onPicked: () => void }) {
  useLayoutEffect(() => {
    if (!focus) props.anchor.focus({ preventScroll: true });
  }, [focus, props.anchor]);
  return <Menu {...props} placement="right-start" />;
}
