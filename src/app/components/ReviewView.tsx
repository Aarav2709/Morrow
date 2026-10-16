import { GraduationCap, PartyPopper } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { collectCards, dueCards } from '../../core/flashcards';
import type { Grade } from '../../core/flashcards';
import { displayTitle } from '../../core/model';
import { gradeCard, useReviewLog } from '../review';
import { openPage } from '../router';
import { useWorkspace } from '../workspace';
import { TopBar } from './TopBar';

const GRADES: Array<{ grade: Grade; label: string; key: string; hint: string }> = [
  { grade: 'again', label: 'Again', key: '1', hint: 'Forgot it' },
  { grade: 'hard', label: 'Hard', key: '2', hint: 'Barely' },
  { grade: 'good', label: 'Good', key: '3', hint: 'Remembered' },
  { grade: 'easy', label: 'Easy', key: '4', hint: 'Instantly' },
];

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

  const grade = (value: Grade) => {
    if (!current) return;
    const queue = active;
    gradeCard(current, value);
    setDone((count) => count + 1);
    setShown(false);
    // a forgotten card comes back at the end of today's session
    setQueue(value === 'again' ? [...queue.slice(1), current.id] : queue.slice(1));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
      if (!current) return;
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

  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">Review</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection review">
          <header className="collection-header">
            <h1>Review</h1>
            <p className="muted">
              Write <code>question :: answer</code> on its own line in any page and it becomes a flashcard.
              Cards come back just before you would forget them.
            </p>
            <p className="review-counts">
              <span className="chip color-blue">{active.length} due</span>
              <span className="chip color-green">{done} reviewed</span>
              <span className="chip">
                {cards.length} card{cards.length === 1 ? '' : 's'}
              </span>
            </p>
          </header>
          {cards.length === 0 ? (
            <div className="empty-state compact">
              <GraduationCap size={26} strokeWidth={1.5} />
              <p>No flashcards yet. Add a line like “Capital of France :: Paris” to any page.</p>
            </div>
          ) : !current ? (
            <div className="empty-state compact">
              <PartyPopper size={26} strokeWidth={1.5} />
              <p>All done for today. New cards and reviews show up here when they are due.</p>
            </div>
          ) : (
            <div className="review-card">
              <p className="review-front">{current.front}</p>
              {shown ? (
                <>
                  <hr />
                  <p className="review-back">{current.back}</p>
                  <div className="review-grades">
                    {GRADES.map((item) => (
                      <button
                        key={item.grade}
                        type="button"
                        className={`button review-${item.grade}`}
                        onClick={() => grade(item.grade)}
                      >
                        <strong>{item.label}</strong>
                        <span className="muted small">
                          {item.hint} · {item.key}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <button type="button" className="button primary review-show" onClick={() => setShown(true)}>
                  Show answer <kbd className="kbd">Space</kbd>
                </button>
              )}
              {source && (
                <button
                  type="button"
                  className="link-button review-source"
                  onClick={() => openPage(source.id, current.front)}
                >
                  From {displayTitle(source)}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
