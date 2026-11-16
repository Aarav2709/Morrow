import { BookOpen, CalendarDays, ChevronRight, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dateKey, findJournal, journalGroups, parseDateKey } from '../../core/daily';
import type { JournalGroup } from '../../core/daily';
import { inlineText } from '../../core/doc';
import { displayTitle } from '../../core/model';
import type { DocNode, PageMeta } from '../../core/model';
import { foldText } from '../../core/search';
import { tagClass, tagsOf } from '../../core/tags';
import { livePages } from '../../core/tree';
import { dateLocale, t } from '../i18n';
import { openToday } from '../operations';
import { openPage } from '../router';
import { usePreferences } from '../platform/preferences';
import { useTagColors } from '../tagColors';
import { useWorkspace } from '../workspace';
import { DailyCalendar } from './DailyNav';
import { Popover } from './Popover';
import { relativeTime } from './primitives';
import { PageIcon } from './Sidebar';
import { TopBar } from './TopBar';

// what a daily note starts with, a line of it under its date
function opening(doc: DocNode | undefined): string {
  for (const block of doc?.content ?? []) {
    const text = inlineText(block).trim();
    if (text) return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  }
  return '';
}

// every daily note in one place rather than in the sidebar, folded into this week, last week and so on.
// the search matches a note's date and words, #tag its tags, and the calendar opens any day
export function JournalView() {
  const state = useWorkspace();
  const { weekStart } = usePreferences();
  useTagColors();
  const [query, setQuery] = useState('');
  const [calendar, setCalendar] = useState<HTMLElement | null>(null);
  // older notes start folded, the recent ones open
  const [folded, setFolded] = useState<Set<JournalGroup>>(() => new Set(['older']));
  const notes = useMemo(() => livePages(state.pages).filter((page) => page.dailyDate), [state.pages]);
  const matching = useMemo(() => {
    const words = foldText(query).split(/\s+/).filter(Boolean);
    if (!words.length) return notes;
    return notes.filter((page) => {
      const tags = tagsOf(page, state.docs[page.id]).map((tag) => foldText(tag));
      const text = foldText(`${displayTitle(page)} ${page.dailyDate} ${opening(state.docs[page.id])}`);
      return words.every((word) =>
        word.startsWith('#') ? tags.some((tag) => tag.startsWith(word.slice(1))) : text.includes(word),
      );
    });
  }, [notes, query, state.docs]);
  const groups = useMemo(() => journalGroups(matching, new Date(), weekStart), [matching, weekStart]);
  const today = dateKey(new Date());
  const hasToday = notes.some((page) => page.dailyDate === today);
  const searching = query.trim() !== '';
  const journal = findJournal(state);

  const toggle = (group: JournalGroup) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{t('journal.title')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection journal-view">
          <header className="collection-header">
            <h1>{t('journal.title')}</h1>
            <p className="muted">{t('journal.subtitle')}</p>
            <div className="templates-view-bar">
              <label className="search-field">
                <Search size={18} strokeWidth={1.75} />
                <input
                  type="search"
                  placeholder={t('journal.search')}
                  aria-label={t('journal.search')}
                  value={query}
                  spellCheck={false}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setQuery('');
                  }}
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={t('journal.pickDay')}
                title={t('journal.pickDay')}
                aria-haspopup="dialog"
                onClick={(event) => setCalendar(calendar ? null : event.currentTarget)}
              >
                <CalendarDays size={17} />
              </button>
              <button type="button" className="button primary" onClick={() => openToday()}>
                {hasToday ? t('journal.openToday') : t('journal.writeToday')}
              </button>
            </div>
          </header>
          {calendar && (
            <Popover
              anchor={calendar}
              onClose={() => setCalendar(null)}
              label={t('daily.dailyNotesCalendar')}
            >
              <DailyCalendar
                selected={null}
                onPick={(date) => {
                  setCalendar(null);
                  openToday(date);
                }}
              />
            </Popover>
          )}
          {notes.length === 0 ? (
            <div className="empty-state compact">
              <BookOpen size={24} strokeWidth={1.5} />
              <p>{t('journal.empty')}</p>
            </div>
          ) : groups.length === 0 ? (
            <div className="empty-state compact">
              <Search size={24} strokeWidth={1.5} />
              <p>{t('journal.noMatch')}</p>
            </div>
          ) : (
            groups.map(({ group, notes: entries }) => {
              const open = searching || !folded.has(group);
              return (
                <section key={group} className="journal-group">
                  <button
                    type="button"
                    className={`journal-group-head${open ? ' is-open' : ''}`}
                    aria-expanded={open}
                    onClick={() => toggle(group)}
                  >
                    <ChevronRight size={14} className="journal-group-chevron" />
                    {t(`journal.groups.${group}`)}
                    <span className="section-count">{entries.length}</span>
                  </button>
                  {open && (
                    <ul className="link-list">
                      {entries.slice(0, group === 'older' && !searching ? 200 : undefined).map((page) => (
                        <JournalRow key={page.id} page={page} doc={state.docs[page.id]} today={today} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}
          {journal && (
            <button
              type="button"
              className="link-button small journal-folder"
              onClick={() => openPage(journal.id)}
            >
              {t('journal.openFolder')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function JournalRow({ page, doc, today }: { page: PageMeta; doc: DocNode | undefined; today: string }) {
  const date = parseDateKey(page.dailyDate!);
  const line = opening(doc);
  const tags = tagsOf(page, doc);
  return (
    <li>
      <button
        type="button"
        className="link-row journal-row"
        data-page-id={page.id}
        onClick={() => openPage(page.id)}
      >
        <span className="tree-icon">
          <PageIcon page={page} />
        </span>
        <span className="link-row-title">
          {page.dailyDate === today
            ? t('daily.today')
            : (date?.toLocaleDateString(dateLocale(), {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }) ?? displayTitle(page))}
          {line && <span className="link-row-path">{line}</span>}
          {tags.length > 0 && (
            <span className="templates-view-tags">
              {tags.slice(0, 6).map((tag) => (
                <span key={tag} className={`tag-chip ${tagClass(tag)}`}>
                  #{tag}
                </span>
              ))}
            </span>
          )}
        </span>
        <span className="link-row-meta">{relativeTime(page.updatedAt)}</span>
      </button>
    </li>
  );
}
