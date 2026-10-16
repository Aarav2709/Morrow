import { Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageId } from '../../core/model';
import { closeDialog } from '../ui';
import { useWorkspace } from '../workspace';
import { Emoji, emojiSrc } from './Emoji';
import { Dialog } from './primitives';

interface Emoji {
  unicode: string;
  label: string;
  group: number;
  order: number;
  tags: string[];
}

const GROUPS: Array<{ id: number; label: string; icon: string }> = [
  { id: 0, label: 'Smileys', icon: '😀' },
  { id: 1, label: 'People', icon: '👋' },
  { id: 3, label: 'Nature', icon: '🌿' },
  { id: 4, label: 'Food', icon: '🍎' },
  { id: 5, label: 'Travel', icon: '✈️' },
  { id: 6, label: 'Activities', icon: '⚽' },
  { id: 7, label: 'Objects', icon: '💡' },
  { id: 8, label: 'Symbols', icon: '❤️' },
  { id: 9, label: 'Flags', icon: '🏳️' },
];

const RECENT_KEY = 'morrow.recentEmoji';

// the full list loads the first time the picker opens, it never weighs down the rest of the app
let cache: Promise<Emoji[]> | null = null;
function loadEmoji(): Promise<Emoji[]> {
  cache ??= import('emojibase-data/en/compact.json').then((module) =>
    (module.default as Array<Partial<Emoji> & { unicode: string; label: string }>)
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

function readRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string').slice(0, 24)
      : [];
  } catch {
    return [];
  }
}

export function EmojiPicker({ pageId, onPick }: { pageId: PageId; onPick: (icon: string | null) => void }) {
  const state = useWorkspace();
  const page = state.pages[pageId];
  const [emoji, setEmoji] = useState<Emoji[] | null>(null);
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

  if (!page) return null;
  const pick = (icon: string | null) => {
    if (icon) {
      try {
        localStorage.setItem(
          RECENT_KEY,
          JSON.stringify([icon, ...recent.filter((item) => item !== icon)].slice(0, 24)),
        );
      } catch {
        // remembering recent picks is only a convenience
      }
    }
    onPick(icon);
    closeDialog();
  };

  return (
    <Dialog title={`Icon for “${displayTitle(page)}”`} onClose={closeDialog} className="emoji-dialog">
      <div className="emoji-top">
        <input
          className="text-input"
          data-autofocus
          placeholder="Search emoji, like rocket or book"
          aria-label="Search emoji"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && shown[0]) pick(shown[0].unicode);
          }}
        />
        <button
          type="button"
          className="button"
          title="Random"
          disabled={!emoji}
          onClick={() => emoji && pick(emoji[Math.floor(Math.random() * emoji.length)]!.unicode)}
        >
          <Shuffle size={14} /> Random
        </button>
        {page.icon && (
          <button type="button" className="button" onClick={() => pick(null)}>
            Remove
          </button>
        )}
      </div>
      {!query && (
        <div className="emoji-groups" role="tablist" aria-label="Categories">
          <button
            type="button"
            role="tab"
            aria-selected={group === null}
            className={group === null ? 'is-active' : ''}
            onClick={() => setGroup(null)}
          >
            All
          </button>
          {GROUPS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={group === item.id}
              title={item.label}
              aria-label={item.label}
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
          <p className="emoji-section">Recent</p>
          <div className="emoji-grid">
            {recent.map((icon) => (
              <button key={icon} type="button" className="emoji-choice" onClick={() => pick(icon)}>
                <Emoji emoji={icon} />
              </button>
            ))}
          </div>
        </>
      )}
      <div className="emoji-grid emoji-all" role="listbox" aria-label="Emoji">
        {emoji === null && <p className="muted">Loading…</p>}
        {shown.map((item) => (
          <button
            key={item.unicode}
            type="button"
            role="option"
            aria-selected={page.icon === item.unicode}
            title={item.label}
            aria-label={item.label}
            className={`emoji-choice${page.icon === item.unicode ? ' is-active' : ''}`}
            onClick={() => pick(item.unicode)}
          >
            <Emoji emoji={item.unicode} />
          </button>
        ))}
        {emoji && shown.length === 0 && <p className="muted">No emoji match “{query}”.</p>}
      </div>
    </Dialog>
  );
}
