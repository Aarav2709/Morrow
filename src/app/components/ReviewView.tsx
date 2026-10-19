import { ArrowUpRight, CalendarClock, GraduationCap, PartyPopper } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { dateKey, parseDateKey } from '../../core/daily';
import { collectCards, dueCards, schedule } from '../../core/flashcards';
import type { Card, Grade, ReviewLog } from '../../core/flashcards';
import { displayTitle } from '../../core/model';
import { gradeCard, useReviewLog } from '../review';
import { openPage } from '../router';
import { useWorkspace } from '../workspace';
import { TopBar } from './TopBar';

const GRADES: Array<{ grade: Grade; label: string; key: string }> = [
  { grade: 'again', label: 'Again', key: '1' },
  { grade: 'hard', label: 'Hard', key: '2' },
  { grade: 'good', label: 'Good', key: '3' },
  { grade: 'easy', label: 'Easy', key: '4' },
];

// how long until the card comes back with each answer, like anki shows it
function nextIn(card: Card, log: ReviewLog, grade: Grade): string {
  if (grade === 'again') return 'This session';
  const days = schedule(log[card.id], grade, new Date()).interval;
  if (days === 1) return 'Tomorrow';
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')} yr`;
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
  if (dateKey(tomorrow) === key) return 'tomorrow';
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function ReviewView() {
  const state = useWorkspace();
  const log = useReviewLog();
  const cards = useMemo(() => collectCards(state), [state]);
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
      const match = GRADES.find((item) => item.key === event.key);
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
        <span className="topbar-title">Review</span>
      </TopBar>
      <div className="page-scroll">
        <div className="review">
          <header className="review-header">
            <div>
              <h1>Review</h1>
              <p className="muted">
                {cards.length === 0
                  ? 'Flashcards from your notes, shown just before you would forget them.'
                  : `${cards.length} card${cards.length === 1 ? '' : 's'} from ${pages} page${pages === 1 ? '' : 's'}`}
              </p>
            </div>
            {current && (
              <div className="review-progress" aria-label={`Card ${done + 1} of ${total}`}>
                <span>
                  {done + 1} <span className="muted">of {total}</span>
                </span>
                <span className="review-progress-bar">
                  <span style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
                </span>
              </div>
            )}
          </header>

          {cards.length === 0 ? (
            <section className="review-empty">
              <GraduationCap size={28} strokeWidth={1.5} />
              <h2>No flashcards yet</h2>
              <p className="muted">
                Write a question and its answer on one line of any page, joined by two colons:
              </p>
              <code className="review-example">Capital of France :: Paris</code>
              <p className="muted small">It shows up here straight away, and comes back as you learn it.</p>
            </section>
          ) : !current ? (
            <section className="review-empty">
              <PartyPopper size={28} strokeWidth={1.5} />
              <h2>
                {done > 0
                  ? `All done, ${done} card${done === 1 ? '' : 's'} reviewed`
                  : 'Nothing due right now'}
              </h2>
              {next ? (
                <p className="muted review-next">
                  <CalendarClock size={15} /> {next.count} card{next.count === 1 ? '' : 's'} due{' '}
                  {describeDay(next.day)}
                </p>
              ) : (
                <p className="muted">New cards show up here as soon as you write them.</p>
              )}
            </section>
          ) : (
            <>
              <article className={`review-card${shown ? ' is-shown' : ''}`}>
                {source && (
                  <button
                    type="button"
                    className="review-source"
                    title="Open the page this card is on"
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
                <div className="review-grades" role="group" aria-label="How well did you remember it?">
                  {GRADES.map((item) => (
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
                    Show answer <kbd className="kbd">Space</kbd>
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
