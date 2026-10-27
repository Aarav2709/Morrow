import { computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import { ReactRenderer } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { LucideIcon } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Emoji } from '../components/Emoji';
import { t } from '../i18n';

export interface MenuItem {
  id: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  // drawn in place of the icon
  emoji?: string;
  hint?: string;
  section?: string;
}

interface Props {
  items: MenuItem[];
  emptyText: string;
  label: string;
  // what enter does, shown in the hint along the bottom
  action: string;
  onSelect: (item: MenuItem) => void;
}

export interface SuggestionMenuHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SuggestionMenu = forwardRef<SuggestionMenuHandle, Props>(function SuggestionMenu(
  { items, emptyText, label, action, onSelect },
  ref,
) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [lastItems, setLastItems] = useState(items);

  // reset the highlight whenever the result list changes
  if (items !== lastItems) {
    setLastItems(items);
    setActive(0);
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const actionLabel =
    action === 'insert'
      ? t('editor.suggestion.actionInsert')
      : action === 'link'
        ? t('editor.suggestion.actionLink')
        : action === 'choose'
          ? t('editor.suggestion.actionChoose')
          : action;

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (items.length === 0) return false;
      if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
        setActive((index) => (index + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
        setActive((index) => (index - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[active];
        if (item) onSelect(item);
        return true;
      }
      return false;
    },
  }));

  // a menu with nothing to say when nothing matches stays out of the way, like the emoji one
  if (items.length === 0 && !emptyText) return null;

  return (
    <div className="suggestion-menu popover" role="listbox" aria-label={label}>
      <div className="suggestion-list" ref={listRef}>
        {items.length === 0 ? (
          <div className="suggestion-empty">{emptyText}</div>
        ) : (
          items.map((item, index) => {
            const Icon = item.icon;
            const showSection = item.section && item.section !== items[index - 1]?.section;
            return (
              <div key={item.id}>
                {showSection && <div className="suggestion-section">{item.section}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className="suggestion-item"
                  onMouseMove={() => index !== active && setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelect(item)}
                >
                  {item.emoji ? (
                    <span className="suggestion-icon">
                      <Emoji emoji={item.emoji} />
                    </span>
                  ) : (
                    Icon && (
                      <span className="suggestion-icon">
                        <Icon size={16} strokeWidth={1.75} />
                      </span>
                    )
                  )}
                  <span className="suggestion-text">
                    <span className="suggestion-title">{item.title}</span>
                    {item.description && <span className="suggestion-description">{item.description}</span>}
                  </span>
                  {item.hint && <kbd className="suggestion-hint">{item.hint}</kbd>}
                </button>
              </div>
            );
          })
        )}
      </div>
      {items.length > 0 && (
        <div className="suggestion-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('editor.suggestion.toChoose')}
          </span>
          <span>
            <kbd>↵</kbd> {t('editor.suggestion.toAction', { action: actionLabel })}
          </span>
          <span>
            <kbd>esc</kbd> {t('editor.suggestion.toClose')}
          </span>
        </div>
      )}
    </div>
  );
});

// lifecycle glue between tiptap suggestion and the floating react list
export function renderSuggestion(
  label: string | (() => string),
  emptyText: string | (() => string),
  action: string | (() => string) = 'choose',
) {
  return () => {
    let renderer: ReactRenderer<SuggestionMenuHandle, Props> | null = null;
    let latest: SuggestionProps<MenuItem, MenuItem> | null = null;

    const place = () => {
      const rect = latest?.clientRect?.();
      if (!renderer || !rect) return;
      const element = renderer.element as HTMLElement;
      void computePosition({ getBoundingClientRect: () => rect }, element, {
        placement: 'bottom-start',
        strategy: 'fixed',
        middleware: [
          offset(6),
          // opens above the line when there is more room there, and never runs off the window
          flip({ padding: 8, fallbackPlacements: ['top-start'] }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableHeight, elements }) {
              elements.floating.style.maxHeight = `${Math.max(140, Math.min(420, availableHeight))}px`;
            },
          }),
        ],
      }).then(({ x, y }) => {
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
      });
    };

    const resolveText = (val: string | (() => string)) => (typeof val === 'function' ? val() : val);

    const props = (suggestion: SuggestionProps<MenuItem, MenuItem>): Props => ({
      items: suggestion.items,
      emptyText: resolveText(emptyText),
      label: resolveText(label),
      action: resolveText(action),
      onSelect: (item) => suggestion.command(item),
    });

    const destroy = () => {
      renderer?.element.remove();
      renderer?.destroy();
      renderer = null;
    };

    return {
      onStart(suggestion: SuggestionProps<MenuItem, MenuItem>) {
        latest = suggestion;
        renderer = new ReactRenderer(SuggestionMenu, {
          props: props(suggestion),
          editor: suggestion.editor as Editor,
        });
        const element = renderer.element as HTMLElement;
        element.classList.add('floating-layer');
        element.style.position = 'fixed';
        document.body.appendChild(element);
        place();
        // placed again once the list is drawn, its real height decides above or below
        requestAnimationFrame(place);
      },
      onUpdate(suggestion: SuggestionProps<MenuItem, MenuItem>) {
        latest = suggestion;
        renderer?.updateProps(props(suggestion));
        requestAnimationFrame(place);
      },
      onKeyDown({ event }: SuggestionKeyDownProps) {
        if (event.key === 'Escape') {
          destroy();
          return true;
        }
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit() {
        destroy();
      },
    };
  };
}
