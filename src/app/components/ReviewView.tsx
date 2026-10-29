import { ArrowUpRight, CalendarClock, GraduationCap, PartyPopper } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { dateKey, parseDateKey } from '../../core/daily';
import { cardsInDeck, collectCards, decksOf, dueCards, schedule } from '../../core/flashcards';
import type { Card, Grade, ReviewLog } from '../../core/flashcards';
import { displayTitle } from '../../core/model';
import { gradeCard, useReviewLog } from '../review';
import type { PageId } from '../../core/model';
import { navigate, openPage } from '../router';
import { Select } from './Select';
import { useWorkspace } from '../workspace';
import { TopBar } from './TopBar';
import { getLocale, t, tp } from '../i18n';

const getGrades = (): Array<{ grade: Grade; label: string; key: string }> => [
  { grade: 'again', label: t('review.grades.again'), key: '1' },
  { grade: 'hard', label: t('review.grades.hard'), key: '2' },
  { grade: 'good', label: t('review.grades.good'), key: '3' },
  { grade: 'easy', label: t('review.grades.easy'), key: '4' },
];

// how long until the card comes back with each answer, like anki shows it
function nextIn(card: Card, log: ReviewLog, grade: Grade): string {
  if (grade === 'again') return t('review.intervals.thisSession');
  const days = schedule(log[card.id], grade, new Date()).interval;
  if (days === 1) return t('review.intervals.tomorrow');
  if (days < 30) return t('review.intervals.days', { count: days });
  if (days < 365) return t('review.intervals.months', { count: Math.round(days / 30) });
  return t('review.intervals.years', { count: (days / 365).toFixed(1).replace(/\.0$/, '') });
}

// when the next cards are due once today's are done
function upcoming(cards: Card[], log: ReviewLog): { day: string; count: number } | null {
  const today = dateKey(new Date());
  let day: string | null = null;
  let count = 0;
  for (const card of cards) {
    const due = log[card.id]?.due;
    if (!due || due <= today) continue;
    if (!day || due < day) {
      day = due;
      count = 1;
    } else if (due === day) count++;
  }
  return day ? { day, count } : null;
}

function describeDay(key: string): string {
  const date = parseDateKey(key);
  if (!date) return key;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateKey(tomorrow) === key) return t('review.intervals.tomorrow').toLowerCase();
  return date.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

export function ReviewView({ deck }: { deck: PageId | null }) {
  const state = useWorkspace();
  const log = useReviewLog();
  const everyCard = useMemo(() => collectCards(state), [state]);
  const decks = useMemo(() => decksOf(everyCard, state.pages), [everyCard, state.pages]);
  const cards = useMemo(
    () => (deck ? cardsInDeck(everyCard, state.pages, deck) : everyCard),
    [everyCard, state.pages, deck],
  );
  // the queue is fixed when the session starts, so grading a card does not reshuffle the rest
  const [queue, setQueue] = useState<string[] | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);

  const due = useMemo(() => dueCards(cards, log, new Date()).map((card) => card.id), [cards, log]);
  const active = queue ?? due;
  const current = active.length > 0 ? cards.find((card) => card.id === active[0]) : undefined;
  const total = done + active.length;
  const pages = useMemo(() => new Set(cards.map((card) => card.pageId)).size, [cards]);

  const grade = (value: Grade) => {
    if (!current) return;
    const rest = active;
    gradeCard(current, value);
    setDone((count) => count + 1);
    setShown(false);
    // a forgotten card comes back at the end of today's session
    setQueue(value === 'again' ? [...rest.slice(1), current.id] : rest.slice(1));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
      if (!current || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!shown && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        setShown(true);
        return;
      }
      const match = getGrades().find((item) => item.key === event.key);
      if (shown && match) {
        event.preventDefault();
        grade(match.grade);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const source = current ? state.pages[current.pageId] : undefined;
  const next = !current ? upcoming(cards, log) : null;

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{t('review.title')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className="review">
          <header className="review-header">
            <div>
              <h1>{t('review.heading')}</h1>
              <p className="muted">
                {cards.length === 0
                  ? t('review.subtitleEmpty')
                  : t('review.subtitleCards', {
                      cards: cards.length,
                      cardsPlural:
                        cards.length === 1 ? t('review.cardsPluralSingle') : t('review.cardsPluralMultiple'),
                      pages,
                      pagesPlural:
                        pages === 1 ? t('review.pagesPluralSingle') : t('review.pagesPluralMultiple'),
                    })}
              </p>
              {decks.length > 1 && (
                <div className="review-deck">
                  <Select<string>
                    label={t('review.deck')}
                    value={deck ?? ''}
                    options={[
                      {
                        value: '',
                        label: t('review.allPages'),
                        detail: tp('review.deckCards', everyCard.length),
                      },
                      ...decks.map((item) => ({
                        value: item.id,
                        label: item.path,
                        detail: tp('review.deckCards', item.cards),
                      })),
                    ]}
                    onChange={(value) => navigate({ name: 'review', deck: value || null }, { replace: true })}
                  />
                </div>
              )}
            </div>
            {current && (
              <div
                className="review-progress"
                aria-label={t('review.cardProgressAria', { current: done + 1, total })}
              >
                <span>{t('review.cardProgress', { current: done + 1, total })}</span>
                <span className="review-progress-bar">
                  <span style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
                </span>
              </div>
            )}
          </header>

          {cards.length === 0 ? (
            <section className="review-empty">
              <GraduationCap size={28} strokeWidth={1.5} />
              <h2>{t('review.emptyTitle')}</h2>
              <p className="muted">{t('review.emptyHelp')}</p>
              <code className="review-example">{t('review.emptyExample')}</code>
              <p className="muted small">{t('review.emptyFooter')}</p>
            </section>
          ) : !current ? (
            <section className="review-empty">
              <PartyPopper size={28} strokeWidth={1.5} />
              <h2>{done > 0 ? tp('review.allDone', done) : t('review.nothingDue')}</h2>
              {next ? (
                <p className="muted review-next">
                  <CalendarClock size={15} />{' '}
                  {describeDay(next.day) === t('review.intervals.tomorrow').toLowerCase()
                    ? tp('review.cardsDueTomorrow', next.count)
                    : tp('review.cardsDueDay', next.count, { day: describeDay(next.day) })}
                </p>
              ) : (
                <p className="muted">{t('review.newCardsHelp')}</p>
              )}
            </section>
          ) : (
            <>
              <article className={`review-card${shown ? ' is-shown' : ''}`}>
                {source && (
                  <button
                    type="button"
                    className="review-source"
                    title={t('review.openCardPage')}
                    onClick={() => openPage(source.id, current.front)}
                  >
                    {displayTitle(source)} <ArrowUpRight size={13} />
                  </button>
                )}
                <p className="review-front">{current.front}</p>
                {shown && (
                  <>
                    <div className="review-divider" />
                    <p className="review-back">{current.back}</p>
                  </>
                )}
              </article>
              {shown ? (
                <div className="review-grades" role="group" aria-label={t('review.gradesAria')}>
                  {getGrades().map((item) => (
                    <button
                      key={item.grade}
                      type="button"
                      className={`review-grade is-${item.grade}`}
                      onClick={() => grade(item.grade)}
                    >
                      <kbd>{item.key}</kbd>
                      <strong>{item.label}</strong>
                      <span>{nextIn(current, log, item.grade)}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="review-actions">
                  <button type="button" className="button primary review-show" onClick={() => setShown(true)}>
                    {t('review.showAnswer')} <kbd className="kbd">Space</kbd>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
