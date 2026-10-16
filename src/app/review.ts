// flashcard progress for the open vault, kept in .morrow/review.json
import { useSyncExternalStore } from 'react';
import { readReviewLog, schedule, writeReviewLog } from '../core/flashcards';
import type { Card, Grade, ReviewLog } from '../core/flashcards';
import { toast } from './ui';
import { getSession } from './workspace';

const FILE = 'review.json';
let log: ReviewLog = {};
let loaded = false;
let saving: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export async function loadReviews(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const text = await getSession().readMeta(FILE);
    log = readReviewLog(text ? (JSON.parse(text) as unknown) : null);
  } catch {
    log = {};
  }
  emit();
}

export function gradeCard(card: Card, grade: Grade): void {
  log = { ...log, [card.id]: schedule(log[card.id], grade, new Date()) };
  emit();
  if (saving) clearTimeout(saving);
  saving = setTimeout(() => {
    saving = null;
    void getSession()
      .writeMeta(FILE, writeReviewLog(log))
      .catch((error: unknown) =>
        toast(`Review progress could not be saved: ${String(error)}`, { tone: 'error' }),
      );
  }, 800);
}

export function useReviewLog(): ReviewLog {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      void loadReviews();
      return () => listeners.delete(listener);
    },
    () => log,
  );
}
