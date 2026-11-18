import { ImagePlus, Shuffle, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { closeDialog, toast } from '../ui';
import { addCustomEmoji, CUSTOM_PREFIX, emojiName, removeCustomEmoji, useCustomEmoji } from '../customEmoji';
import { pickFiles } from '../platform/files';
import { Emoji, emojiSrc } from './Emoji';
import { FLAT_ICON_GROUPS, FLAT_ICONS, FlatIcon, flatIconValue, parseFlatIcon } from './flatIcons';
import type { FlatIconGroup } from './flatIcons';
import { COLORS } from '../../core/model';
import type { ColorName } from '../../core/model';
import { colorLabel } from '../i18n/labels';
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
  // flat icons sit beside the emoji, outlined or filled
  const [tab, setTab] = useState<'emoji' | 'icons' | 'mine'>(() =>
    current?.startsWith('icon:') ? 'icons' : current?.startsWith(CUSTOM_PREFIX) ? 'mine' : 'emoji',
  );
  const picked = current ? parseFlatIcon(current) : null;
  const [filled, setFilled] = useState(() => picked?.filled ?? false);
  const [colour, setColour] = useState<ColorName | null>(() => picked?.color ?? null);

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
      <div className="segmented emoji-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'emoji'}
          className={tab === 'emoji' ? 'is-active' : ''}
          onClick={() => setTab('emoji')}
        >
          {t('emoji.emoji')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'icons'}
          className={tab === 'icons' ? 'is-active' : ''}
          onClick={() => setTab('icons')}
        >
          {t('emoji.icons')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mine'}
          className={tab === 'mine' ? 'is-active' : ''}
          onClick={() => setTab('mine')}
        >
          {t('emoji.mine')}
        </button>
      </div>
      {tab === 'mine' ? (
        <MineGrid current={current} onPick={pick} />
      ) : tab === 'icons' ? (
        <IconGrid
          current={current}
          filled={filled}
          setFilled={setFilled}
          colour={colour}
          setColour={setColour}
          onPick={pick}
        />
      ) : (
        <>
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
        </>
      )}
    </Dialog>
  );
}

function IconGrid({
  current,
  filled,
  setFilled,
  colour,
  setColour,
  onPick,
}: {
  current: string | null;
  filled: boolean;
  setFilled: (filled: boolean) => void;
  colour: ColorName | null;
  setColour: (colour: ColorName | null) => void;
  onPick: (icon: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const names = Object.keys(FLAT_ICONS).filter((name) => name.includes(query.trim().toLowerCase()));
  const value = (name: string) => flatIconValue(name, filled, colour);
  const searching = query.trim() !== '';
  const choice = (name: string) => (
    <button
      key={name}
      type="button"
      role="option"
      aria-selected={current === value(name)}
      title={name}
      aria-label={name}
      className={`emoji-choice${current === value(name) ? ' is-active' : ''}`}
      onClick={() => onPick(value(name))}
    >
      <FlatIcon name={name} filled={filled} color={colour} />
    </button>
  );
  return (
    <>
      <div className="emoji-top">
        <input
          className="text-input"
          data-autofocus
          placeholder={t('emoji.searchIcons')}
          aria-label={t('emoji.searchIcons')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && names[0]) onPick(value(names[0]));
          }}
        />
        <div className="segmented" role="radiogroup" aria-label={t('emoji.iconStyle')}>
          <button
            type="button"
            role="radio"
            aria-checked={!filled}
            className={!filled ? 'is-active' : ''}
            onClick={() => setFilled(false)}
          >
            {t('emoji.outline')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={filled}
            className={filled ? 'is-active' : ''}
            onClick={() => setFilled(true)}
          >
            {t('emoji.filled')}
          </button>
        </div>
        {current && (
          <button type="button" className="button" onClick={() => onPick(null)}>
            {t('common.remove')}
          </button>
        )}
      </div>
      {/* the icons are drawn in the colour picked here, the page's icon too */}
      <div className="icon-colours" role="radiogroup" aria-label={t('editor.colour')}>
        {[null, ...COLORS].map((color) => (
          <button
            key={color ?? 'default'}
            type="button"
            role="radio"
            aria-checked={colour === color}
            aria-label={color ? colorLabel(color) : t('emoji.defaultColour')}
            title={color ? colorLabel(color) : t('emoji.defaultColour')}
            className={`icon-colour${colour === color ? ' is-active' : ''}`}
            onClick={() => setColour(color)}
          >
            <span className={color ? `icon-colour-dot flat-icon-${color}` : 'icon-colour-dot'} />
          </button>
        ))}
      </div>
      {/* in groups with a heading each, a search shows every match in one grid */}
      <div className="emoji-all" role="listbox" aria-label={t('emoji.icons')}>
        {searching ? (
          <div className="emoji-grid">{names.map(choice)}</div>
        ) : (
          (Object.keys(FLAT_ICON_GROUPS) as FlatIconGroup[]).map((group) => (
            <section key={group} aria-label={t(`emoji.iconGroups.${group}`)}>
              <p className="emoji-section">{t(`emoji.iconGroups.${group}`)}</p>
              <div className="emoji-grid">{FLAT_ICON_GROUPS[group].map(choice)}</div>
            </section>
          ))
        )}
        {names.length === 0 && <p className="muted">{t('emoji.noMatch', { query })}</p>}
      </div>
    </>
  );
}

// pictures of your own, kept in the vault. one can be a page's icon, or written in a page as :name:
function MineGrid({ current, onPick }: { current: string | null; onPick: (icon: string | null) => void }) {
  const mine = useCustomEmoji();
  const [query, setQuery] = useState('');
  const shown = mine.filter((item) => item.name.includes(emojiName(query) || query.trim().toLowerCase()));
  const add = async () => {
    const files = await pickFiles('image/png,image/jpeg,image/gif,image/webp,image/svg+xml', true);
    let added = 0;
    for (const file of files) if (await addCustomEmoji(file)) added++;
    if (added < files.length) toast(t('emoji.mineTooLarge'), { tone: 'error' });
  };
  return (
    <>
      <div className="emoji-top">
        <input
          className="text-input"
          data-autofocus
          placeholder={t('emoji.searchMine')}
          aria-label={t('emoji.searchMine')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && shown[0]) onPick(`${CUSTOM_PREFIX}${shown[0].name}`);
          }}
        />
        <button type="button" className="button" onClick={() => void add()}>
          <ImagePlus size={14} /> {t('emoji.addMine')}
        </button>
        {current && (
          <button type="button" className="button" onClick={() => onPick(null)}>
            {t('common.remove')}
          </button>
        )}
      </div>
      <p className="muted small emoji-mine-help">{t('emoji.mineHelp')}</p>
      <div className="emoji-grid emoji-all" role="listbox" aria-label={t('emoji.mine')}>
        {shown.map((item) => {
          const value = `${CUSTOM_PREFIX}${item.name}`;
          return (
            <span key={item.name} className="emoji-mine">
              <button
                type="button"
                role="option"
                aria-selected={current === value}
                title={`:${item.name}:`}
                aria-label={`:${item.name}:`}
                className={`emoji-choice${current === value ? ' is-active' : ''}`}
                onClick={() => onPick(value)}
              >
                <img className="emoji-img custom-emoji-img" src={item.url} alt="" draggable={false} />
              </button>
              <button
                type="button"
                className="emoji-mine-remove"
                aria-label={t('emoji.removeMine', { name: item.name })}
                title={t('emoji.removeMine', { name: item.name })}
                onClick={() => void removeCustomEmoji(item.name)}
              >
                <X size={10} />
              </button>
            </span>
          );
        })}
        {mine.length === 0 && <p className="muted">{t('emoji.mineEmpty')}</p>}
      </div>
    </>
  );
}
