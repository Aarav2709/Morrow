import { Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { closeDialog } from '../ui';
import { Emoji, emojiSrc } from './Emoji';
import { Dialog } from './primitives';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';

export interface EmojiEntry {
  unicode: string;
  label: string;
  group: number;
  order: number;
  tags: string[];
}

const GROUPS: Array<{ id: number; label: TranslationKey; icon: string }> = [
  { id: 0, label: 'emoji.smileys', icon: '😀' },
  { id: 1, label: 'emoji.people', icon: '👋' },
  { id: 3, label: 'emoji.nature', icon: '🌿' },
  { id: 4, label: 'emoji.food', icon: '🍎' },
  { id: 5, label: 'emoji.travel', icon: '✈️' },
  { id: 6, label: 'emoji.activities', icon: '⚽' },
  { id: 7, label: 'emoji.objects', icon: '💡' },
  { id: 8, label: 'emoji.symbols', icon: '❤️' },
  { id: 9, label: 'emoji.flags', icon: '🏳️' },
];

const RECENT_KEY = 'morrow.recentEmoji';

// the full list loads the first time the picker opens, it never weighs down the rest of the app
let cache: Promise<EmojiEntry[]> | null = null;
export function loadEmoji(): Promise<EmojiEntry[]> {
  cache ??= import('emojibase-data/en/compact.json').then((module) =>
    (module.default as Array<Partial<EmojiEntry> & { unicode: string; label: string }>)
      .filter((item) => typeof item.group === 'number' && item.group !== 2 && emojiSrc(item.unicode) !== null)
      .map((item) => ({
        unicode: item.unicode,
        label: item.label,
        group: item.group!,
        order: item.order ?? 0,
        tags: item.tags ?? [],
      }))
      .sort((a, b) => a.order - b.order),
  );
  return cache;
}

export function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string').slice(0, 24)
      : [];
  } catch {
    return [];
  }
}

interface Props {
  title: string;
  // the emoji in use, which can be taken away
  current: string | null;
  onPick: (icon: string | null) => void;
}

export function rememberEmoji(icon: string): void {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([icon, ...readRecent().filter((item) => item !== icon)].slice(0, 24)),
    );
  } catch {
    // remembering recent picks is only a convenience
  }
}

export function EmojiPicker({ title, current, onPick }: Props) {
  const [emoji, setEmoji] = useState<EmojiEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<number | null>(null);
  const [recent] = useState(readRecent);

  useEffect(() => {
    let live = true;
    void loadEmoji().then((list) => live && setEmoji(list));
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(() => {
    if (!emoji) return [];
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      return emoji.filter((item) =>
        words.every((word) => item.label.includes(word) || item.tags.some((tag) => tag.startsWith(word))),
      );
    }
    return group === null ? emoji : emoji.filter((item) => item.group === group);
  }, [emoji, query, group]);

  const pick = (icon: string | null) => {
    if (icon) rememberEmoji(icon);
    onPick(icon);
    closeDialog();
  };

  return (
    <Dialog title={title} onClose={closeDialog} className="emoji-dialog">
      <div className="emoji-top">
        <input
          className="text-input"
          data-autofocus
          placeholder={t('emoji.searchPlaceholder')}
          aria-label={t('emoji.searchEmoji')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && shown[0]) pick(shown[0].unicode);
          }}
        />
        <button
          type="button"
          className="button"
          title={t('emoji.random')}
          disabled={!emoji}
          onClick={() => emoji && pick(emoji[Math.floor(Math.random() * emoji.length)]!.unicode)}
        >
          <Shuffle size={14} /> {t('emoji.random')}
        </button>
        {current && (
          <button type="button" className="button" onClick={() => pick(null)}>
            {t('common.remove')}
          </button>
        )}
      </div>
      {!query && (
        <div className="emoji-groups" role="tablist" aria-label={t('emoji.categories')}>
          <button
            type="button"
            role="tab"
            aria-selected={group === null}
            className={group === null ? 'is-active' : ''}
            onClick={() => setGroup(null)}
          >
            {t('emoji.all')}
          </button>
          {GROUPS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={group === item.id}
              title={t(item.label)}
              aria-label={t(item.label)}
              className={group === item.id ? 'is-active' : ''}
              onClick={() => setGroup(item.id)}
            >
              <Emoji emoji={item.icon} />
            </button>
          ))}
        </div>
      )}
      {!query && group === null && recent.length > 0 && (
        <>
          <p className="emoji-section">{t('actions.groups.recent')}</p>
          <div className="emoji-grid">
            {recent.map((icon) => (
              <button key={icon} type="button" className="emoji-choice" onClick={() => pick(icon)}>
                <Emoji emoji={icon} />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="emoji-grid emoji-all" role="listbox" aria-label={t('emoji.emoji')}>
        {emoji === null && <p className="muted">{t('emoji.loading')}</p>}
        {shown.map((item) => (
          <button
            key={item.unicode}
            type="button"
            role="option"
            aria-selected={current === item.unicode}
            title={item.label}
            aria-label={item.label}
            className={`emoji-choice${current === item.unicode ? ' is-active' : ''}`}
            onClick={() => pick(item.unicode)}
          >
            <Emoji emoji={item.unicode} />
          </button>
        ))}
        {emoji && shown.length === 0 && <p className="muted">{t('emoji.noMatch', { query })}</p>}
      </div>
    </Dialog>
  );
}
