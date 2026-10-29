// flashcards from your notes: any line written as question :: answer, reviewed with spaced repetition
import { dateKey, parseDateKey } from './daily';
import { inlineText } from './doc';
import { displayTitle } from './model';
import type { DocNode, PageId, WorkspaceState } from './model';
import { ancestorsOf, descendantsOf, livePages } from './tree';

type Pages = WorkspaceState['pages'];

export interface Card {
  id: string;
  pageId: PageId;
  front: string;
  back: string;
}

export interface CardState {
  // the next day the card is due, yyyy-mm-dd
  due: string;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
}

export type Grade = 'again' | 'hard' | 'good' | 'easy';
export type ReviewLog = Record<string, CardState>;

const SEPARATOR = /\s::\s/;

function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = (b * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

export function cardsInDoc(pageId: PageId, doc: DocNode): Card[] {
  const cards: Card[] = [];
  const visit = (node: DocNode) => {
    if (node.type === 'codeBlock' || node.type === 'rawBlock') return;
    if (node.type === 'paragraph') {
      const text = inlineText(node).trim();
      const match = SEPARATOR.exec(text);
      if (match) {
        const front = text.slice(0, match.index).trim();
        const back = text.slice(match.index + match[0].length).trim();
        // the card keeps its progress while its answer is reworded
        if (front && back) cards.push({ id: hash(`${pageId}\n${front}`), pageId, front, back });
      }
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return cards;
}

export function collectCards(state: WorkspaceState): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const page of livePages(state.pages)) {
    const doc = state.docs[page.id];
    if (!doc || page.encrypted) continue;
    for (const card of cardsInDoc(page.id, doc)) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      cards.push(card);
    }
  }
  return cards;
}

// the cards of one page and every page inside it, studied on their own the way a deck is in anki
export function cardsInDeck(cards: Card[], pages: Pages, deck: PageId): Card[] {
  const ids = new Set([deck, ...descendantsOf(pages, deck).map((page) => page.id)]);
  return cards.filter((card) => ids.has(card.pageId));
}

export interface Deck {
  id: PageId;
  // the page's place in the tree, such as Biology / Cells
  path: string;
  cards: number;
}

// every page with cards on it or inside it, in the order of their paths
export function decksOf(cards: Card[], pages: Pages): Deck[] {
  const counts = new Map<PageId, number>();
  for (const card of cards) {
    for (const id of [card.pageId, ...ancestorsOf(pages, card.pageId).map((page) => page.id)])
      counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts]
    .filter(([id]) => pages[id])
    .map(([id, count]) => ({
      id,
      path: [...ancestorsOf(pages, id).reverse(), pages[id]!].map((page) => displayTitle(page)).join(' / '),
      cards: count,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function isDue(card: Card, log: ReviewLog, today: Date): boolean {
  const entry = log[card.id];
  return !entry || entry.due <= dateKey(today);
}

export function dueCards(cards: Card[], log: ReviewLog, today: Date): Card[] {
  // cards seen before come first, new ones after, so reviews never pile up behind new cards
  return cards
    .filter((card) => isDue(card, log, today))
    .sort(
      (a, b) =>
        Number(!log[a.id]) - Number(!log[b.id]) || (log[a.id]?.due ?? '').localeCompare(log[b.id]?.due ?? ''),
    );
}

function addDays(today: Date, days: number): string {
  return dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
}

// the sm-2 schedule anki made familiar: a forgotten card starts over, a remembered one waits longer each time
export function schedule(previous: CardState | undefined, grade: Grade, today: Date): CardState {
  const state: CardState = previous
    ? { ...previous }
    : { due: dateKey(today), interval: 0, ease: 2.5, reps: 0, lapses: 0 };
  if (grade === 'again') {
    state.lapses += 1;
    state.reps = 0;
    state.interval = 1;
    state.ease = Math.max(1.3, state.ease - 0.2);
  } else {
    const quality = grade === 'hard' ? 3 : grade === 'good' ? 4 : 5;
    state.ease = Math.max(1.3, state.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    if (state.reps === 0) state.interval = grade === 'easy' ? 4 : 1;
    else if (state.reps === 1) state.interval = grade === 'hard' ? 3 : grade === 'easy' ? 8 : 6;
    else
      state.interval = Math.round(
        state.interval * (grade === 'hard' ? 1.2 : state.ease) * (grade === 'easy' ? 1.3 : 1),
      );
    state.reps += 1;
  }
  state.interval = Math.min(3650, Math.max(1, state.interval));
  state.due = addDays(today, state.interval);
  return state;
}

export function readReviewLog(raw: unknown): ReviewLog {
  const log: ReviewLog = {};
  const cards = raw && typeof raw === 'object' ? (raw as { cards?: unknown }).cards : null;
  if (!cards || typeof cards !== 'object') return log;
  for (const [id, value] of Object.entries(cards as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Partial<CardState>;
    if (typeof entry.due !== 'string' || !parseDateKey(entry.due)) continue;
    log[id] = {
      due: entry.due,
      interval: typeof entry.interval === 'number' ? entry.interval : 1,
      ease: typeof entry.ease === 'number' ? Math.max(1.3, entry.ease) : 2.5,
      reps: typeof entry.reps === 'number' ? entry.reps : 0,
      lapses: typeof entry.lapses === 'number' ? entry.lapses : 0,
    };
  }
  return log;
}

export function writeReviewLog(log: ReviewLog): string {
  return `${JSON.stringify({ version: 1, cards: log })}\n`;
}
