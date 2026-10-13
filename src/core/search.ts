import { docToPlainText } from './doc';
import { displayTitle } from './model';
import type { DocNode, PageId, PageMeta, WorkspaceState } from './model';
import { ancestorsOf, livePages } from './tree';

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchResult {
  page: PageMeta;
  score: number;
  titleMatch: boolean;
  snippet: SearchSnippet | null;
  // text to highlight when the page opens
  firstMatch: string | null;
  path: string[];
}

// documents are immutable, so cached text stays valid for the life of the object
const textCache = new WeakMap<DocNode, { raw: string; folded: string }>();

export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function textOf(doc: DocNode | undefined): { raw: string; folded: string } {
  if (!doc) return { raw: '', folded: '' };
  let entry = textCache.get(doc);
  if (!entry) {
    const raw = docToPlainText(doc);
    // folding can change string length, so offsets are only trusted when lengths agree
    entry = { raw, folded: foldText(raw) };
    textCache.set(doc, entry);
  }
  return entry;
}

export function tokenize(query: string): string[] {
  return foldText(query)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .slice(0, 12);
}

export function searchWorkspace(state: WorkspaceState, query: string, limit = 50): SearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const phrase = terms.join(' ');
  const results: SearchResult[] = [];

  for (const page of livePages(state.pages)) {
    const title = foldText(displayTitle(page));
    const body = textOf(state.docs[page.id]);
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inBody = body.folded.includes(term);
      if (!inTitle && !inBody) {
        matchedAll = false;
        break;
      }
      if (inTitle) score += title.startsWith(term) ? 12 : 8;
      if (inBody) score += Math.min(5, countOccurrences(body.folded, term));
    }
    if (!matchedAll) continue;
    const titleMatch = terms.every((term) => title.includes(term));
    if (title === phrase) score += 30;
    else if (title.startsWith(phrase)) score += 15;
    if (body.folded.includes(phrase)) score += 6;
    // small recency bonus so fresh notes win ties
    score += Math.max(0, 2 - (Date.now() - page.updatedAt) / (1000 * 60 * 60 * 24 * 30));
    const bodyTerm = body.folded.includes(phrase) ? phrase : terms.find((term) => body.folded.includes(term));
    const snippet = bodyTerm ? makeSnippet(body, bodyTerm) : null;
    results.push({
      page,
      score,
      titleMatch,
      snippet,
      firstMatch: snippet?.match ?? null,
      path: ancestorsOf(state.pages, page.id)
        .reverse()
        .map((ancestor) => displayTitle(ancestor)),
    });
  }

  return results.sort((a, b) => b.score - a.score || b.page.updatedAt - a.page.updatedAt).slice(0, limit);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1 && count < 50) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function makeSnippet(body: { raw: string; folded: string }, term: string, radius = 60): SearchSnippet {
  const aligned = body.raw.length === body.folded.length;
  const source = aligned ? body.raw : body.folded;
  const index = body.folded.indexOf(term);
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const lineEndRaw = source.indexOf('\n', index + term.length);
  const lineEnd = lineEndRaw === -1 ? source.length : lineEndRaw;
  const start = Math.max(lineStart, index - radius);
  const end = Math.min(lineEnd, index + term.length + radius);
  return {
    before: (start > lineStart ? '…' : '') + source.slice(start, index).trimStart(),
    match: source.slice(index, index + term.length),
    after: source.slice(index + term.length, end).trimEnd() + (end < lineEnd ? '…' : ''),
  };
}

export function findPagesByTitle(state: WorkspaceState, query: string, limit = 8): PageMeta[] {
  const folded = foldText(query.trim());
  const pages = livePages(state.pages);
  if (!folded) {
    return pages
      .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt))
      .slice(0, limit);
  }
  return pages
    .map((page) => ({ page, title: foldText(displayTitle(page)) }))
    .filter((entry) => entry.title.includes(folded))
    .sort(
      (a, b) =>
        Number(b.title.startsWith(folded)) - Number(a.title.startsWith(folded)) ||
        a.title.length - b.title.length,
    )
    .slice(0, limit)
    .map((entry) => entry.page);
}

export function pageIdByTitle(state: WorkspaceState, title: string): PageId | null {
  const folded = foldText(title.trim());
  const match = livePages(state.pages).find((page) => foldText(displayTitle(page)) === folded);
  return match?.id ?? null;
}
