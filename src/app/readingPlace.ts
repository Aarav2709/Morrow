import type { PageId } from '../core/model';

// where each page was left, how far down it was scrolled and where the cursor was, so reopening a page or
// morrow itself carries on from there
export interface ReadingPlace {
  scroll: number;
  from: number;
  to: number;
}

const KEY = 'morrow.readingPlaces';
const MAX_PAGES = 300;
let places: Map<PageId, ReadingPlace> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function load(): Map<PageId, ReadingPlace> {
  if (places) return places;
  places = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Partial<ReadingPlace>>;
    for (const [id, place] of Object.entries(raw)) {
      const { scroll, from, to } = place;
      if (
        [scroll, from, to].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      )
        places.set(id, { scroll: scroll!, from: from!, to: to! });
    }
  } catch {
    // a broken entry only means pages open at the top
  }
  return places;
}

function save(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(load())));
  } catch {
    // storage can be unavailable, places are kept for this session
  }
}

export function readingPlace(id: PageId): ReadingPlace | null {
  return load().get(id) ?? null;
}

export function rememberPlace(id: PageId, change: Partial<ReadingPlace>): void {
  const all = load();
  const next = { scroll: 0, from: 0, to: 0, ...all.get(id), ...change };
  // the most recent page goes last, the oldest are forgotten first
  all.delete(id);
  all.set(id, next);
  while (all.size > MAX_PAGES) all.delete(all.keys().next().value!);
  timer ??= setTimeout(save, 400);
}

// writes what is still waiting, morrow calls this as it closes
export function flushPlaces(): void {
  if (timer) save();
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushPlaces);
