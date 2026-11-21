import { dateKey } from '../../core/daily';
import { linksInDoc } from '../../core/links';
import { docToMarkdown } from '../../core/markdown/serialize';
import { displayTitle } from '../../core/model';
import type { PageId, PageMeta, WorkspaceState } from '../../core/model';
import { foldText } from '../../core/search';
import { ancestorsOf, livePages } from '../../core/tree';
import { placePages } from '../../core/vault/layout';
import type { Layout } from '../../core/vault/layout';
import type { AcpPromptPart } from '../platform/desktop';
import type { Preferences } from '../platform/preferences';
import { assistantRules } from './rules';
import type { AttachedSelection } from './selection';

export interface MentionCandidate {
  kind: 'page' | 'selection';
  id: string;
  title: string;
  pathLabel: string;
  aliases: string[];
}

export interface AcpAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: 'image' | 'audio';
  base64: string;
  previewUrl: string;
}

function pageAliases(page: PageMeta): string[] {
  const raw = page.extra?.aliases ?? page.extra?.alias ?? page.properties?.aliases ?? page.properties?.alias;
  if (typeof raw === 'string') return raw ? [raw] : [];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return [];
}

function pageBreadcrumb(state: WorkspaceState, page: PageMeta): string {
  const chain = ancestorsOf(state.pages, page.id).map((p) => displayTitle(p));
  return chain.length > 0 ? `${chain.join(' / ')} / ${displayTitle(page)}` : displayTitle(page);
}

export function searchMentionCandidates(
  state: WorkspaceState,
  query: string,
  selection: AttachedSelection | null,
  limit = 14,
): MentionCandidate[] {
  const needle = foldText(query.trim());
  const out: Array<{ item: MentionCandidate; score: number }> = [];

  if (selection && (!needle || 'selection'.includes(needle) || 'highlighted'.includes(needle))) {
    out.push({
      item: {
        kind: 'selection',
        id: '__selection__',
        title: 'selection',
        pathLabel: selection.text.slice(0, 60).replace(/\s+/g, ' '),
        aliases: [],
      },
      score: 1000,
    });
  }

  for (const page of livePages(state.pages)) {
    if (page.encrypted) continue;
    const title = displayTitle(page);
    const breadcrumb = pageBreadcrumb(state, page);
    const aliases = pageAliases(page);
    const fTitle = foldText(title);
    const fPath = foldText(breadcrumb);
    const fAliases = aliases.map((a) => foldText(a));

    let score: number;
    if (!needle) {
      score = page.updatedAt / 1e12;
    } else if (fTitle === needle || fAliases.includes(needle)) {
      score = 900;
    } else if (fTitle.startsWith(needle)) {
      score = 700;
    } else if (fAliases.some((a) => a.startsWith(needle))) {
      score = 650;
    } else if (fTitle.includes(needle)) {
      score = 500;
    } else if (fAliases.some((a) => a.includes(needle))) {
      score = 450;
    } else if (fPath.includes(needle)) {
      score = 300;
    } else {
      continue;
    }

    out.push({
      item: {
        kind: 'page',
        id: page.id,
        title,
        pathLabel: breadcrumb,
        aliases,
      },
      score,
    });
  }

  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function computeVaultLayout(state: WorkspaceState): Layout {
  return placePages(state, new Map(), new Set());
}

export function extractInlineMentionIds(text: string, state: WorkspaceState): PageId[] {
  const found: PageId[] = [];
  const seen = new Set<PageId>();
  const byFoldedTitle = new Map<string, PageId>();
  for (const page of livePages(state.pages)) {
    if (page.encrypted) continue;
    const title = foldText(displayTitle(page));
    if (title && !byFoldedTitle.has(title)) byFoldedTitle.set(title, page.id);
    for (const alias of pageAliases(page)) {
      const f = foldText(alias);
      if (f && !byFoldedTitle.has(f)) byFoldedTitle.set(f, page.id);
    }
  }

  for (const match of text.matchAll(/@\[\[([^\]\n]+)\]\]/g)) {
    const id = byFoldedTitle.get(foldText(match[1]!.trim()));
    if (id && !seen.has(id)) {
      seen.add(id);
      found.push(id);
    }
  }

  for (const match of text.matchAll(/(?:^|\s)@([^\s@#[\]]+)/g)) {
    const token = foldText(match[1]!.trim());
    const id = byFoldedTitle.get(token);
    if (id && !seen.has(id)) {
      seen.add(id);
      found.push(id);
    }
  }

  return found;
}

export function truncateContext(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n\n...[truncated at ${maxLength} characters]`;
}

export function buildPromptInjection(prefs: Preferences, today = new Date()): string {
  const parts: string[] = [];
  if (prefs.acpInjectMarkdownRules) {
    parts.push(
      `You are assisting inside Morrow, a local-first Markdown notes workspace. Today is ${dateKey(today)}.`,
      assistantRules(today),
    );
  }
  if (prefs.acpInjectTableSpacing) {
    parts.push(
      'Markdown table spacing: Always leave a blank line immediately before and after Markdown pipe tables so Morrow renders them cleanly.',
    );
  }
  if (prefs.acpInjectLatexRules) {
    parts.push(
      'LaTeX math formatting: Use $...$ delimiters for inline math expressions and $$...$$ on its own lines for display math blocks.',
    );
  }
  if (parts.length === 0) return '';
  return `<morrow_instructions>\n${parts.join('\n\n')}\n</morrow_instructions>`;
}

export function expandWikilinkPaths(
  state: WorkspaceState,
  sourcePageIds: PageId[],
  layout: Layout,
): Array<{ title: string; filePath: string }> {
  const seen = new Set<PageId>(sourcePageIds);
  const results: Array<{ title: string; filePath: string }> = [];
  for (const id of sourcePageIds) {
    const doc = state.docs[id];
    if (!doc) continue;
    for (const occ of linksInDoc(doc)) {
      if (seen.has(occ.targetId)) continue;
      seen.add(occ.targetId);
      const target = state.pages[occ.targetId];
      if (!target || target.encrypted || target.trashedAt !== null) continue;
      const filePath = layout.get(occ.targetId)?.file;
      if (filePath) results.push({ title: displayTitle(target), filePath });
    }
  }
  return results;
}

export function buildAcpPromptParts(options: {
  text: string;
  state: WorkspaceState;
  explicitPageIds: PageId[];
  activePageId: PageId | null;
  selection: AttachedSelection | null;
  attachments: AcpAttachment[];
  prefs: Preferences;
  isFirstTurn: boolean;
}): { prompt: AcpPromptPart[]; mentionedTitles: string[] } {
  const { text, state, explicitPageIds, activePageId, selection, attachments, prefs, isFirstTurn } = options;
  const layout = computeVaultLayout(state);

  const inlineIds = extractInlineMentionIds(text, state);
  const mentionIds: PageId[] = [];
  const seen = new Set<PageId>();
  const addId = (id: PageId | null | undefined) => {
    if (!id || seen.has(id)) return;
    const page = state.pages[id];
    if (!page || page.encrypted || page.trashedAt !== null) return;
    seen.add(id);
    mentionIds.push(id);
  };

  for (const id of explicitPageIds) addId(id);
  for (const id of inlineIds) addId(id);
  if (prefs.acpAutoMentionActive && activePageId) addId(activePageId);

  const contextSections: string[] = [];
  if (isFirstTurn) {
    const injected = buildPromptInjection(prefs);
    if (injected) contextSections.push(injected);
  }

  const mentionedTitles: string[] = [];
  for (const id of mentionIds) {
    const page = state.pages[id]!;
    const title = displayTitle(page);
    mentionedTitles.push(title);
    const filePath = layout.get(id)?.file ?? `${title}.md`;
    const doc = state.docs[id];
    const body = doc ? docToMarkdown(doc).trim() : '';
    const content = truncateContext(body, prefs.acpMaxNoteLength);
    contextSections.push(`<note title="${title}" path="${filePath}">\n${content}\n</note>`);
  }

  if (prefs.acpExpandWikilinks && mentionIds.length > 0) {
    const linked = expandWikilinkPaths(state, mentionIds, layout);
    if (linked.length > 0) {
      const list = linked.map((item) => `- [[${item.title}]] (${item.filePath})`).join('\n');
      contextSections.push(
        `<linked_notes_context>\nReferenced [[wikilinks]] found in the notes above (read these files if needed):\n${list}\n</linked_notes_context>`,
      );
    }
  }

  const mentionsSelection = /@selection\b/i.test(text);
  if (selection && (mentionsSelection || prefs.acpAutoMentionActive)) {
    const selPage = state.pages[selection.pageId];
    const selTitle = selPage ? displayTitle(selPage) : selection.pageId;
    const selBody = truncateContext(selection.markdown || selection.text, prefs.acpMaxSelectionLength);
    contextSections.push(`<selection note="${selTitle}">\n${selBody}\n</selection>`);
  }

  const prompt: AcpPromptPart[] = [];
  const combinedText = contextSections.length > 0 ? `${contextSections.join('\n\n')}\n\n${text}` : text;
  prompt.push({ type: 'text', text: combinedText });

  for (const att of attachments) {
    if (att.kind === 'image') {
      prompt.push({ type: 'image', data: att.base64, mimeType: att.mimeType });
    } else if (att.kind === 'audio') {
      prompt.push({ type: 'audio', data: att.base64, mimeType: att.mimeType });
    }
  }

  return { prompt, mentionedTitles };
}
