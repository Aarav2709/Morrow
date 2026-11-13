// sections of your own in the sidebar, each a list of pages under a name like favourites. kept for the
// vault in .morrow/sidebar-sections.json, pages are put in one from their menu
import { useSyncExternalStore } from 'react';
import type { PageId } from '../core/model';
import { desktop } from './platform/desktop';
import { newId } from './platform/files';

export interface SidebarSection {
  id: string;
  name: string;
  hidden: boolean;
  pages: PageId[];
}

const FILE = '.morrow/sidebar-sections.json';
let sections: SidebarSection[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function read(raw: unknown): SidebarSection[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as { sections?: unknown }).sections;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).flatMap((item: Partial<SidebarSection>) =>
    item && typeof item.id === 'string' && typeof item.name === 'string'
      ? [
          {
            id: item.id,
            name: item.name.slice(0, 60),
            hidden: item.hidden === true,
            pages: Array.isArray(item.pages)
              ? item.pages.filter((id): id is string => typeof id === 'string').slice(0, 500)
              : [],
          },
        ]
      : [],
  );
}

export function loadSidebarSections(): Promise<void> {
  loaded ??= (async () => {
    try {
      const text = await desktop?.vault?.readText(FILE);
      sections = text ? read(JSON.parse(text)) : [];
      listeners.forEach((listener) => listener());
    } catch {
      // no sections made yet
    }
  })();
  return loaded;
}

export function useSidebarSections(): SidebarSection[] {
  void loadSidebarSections();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => sections,
  );
}

export function getSidebarSections(): SidebarSection[] {
  return sections;
}

async function save(next: SidebarSection[]): Promise<void> {
  await loadSidebarSections();
  sections = next;
  listeners.forEach((listener) => listener());
  await desktop?.vault?.apply([
    { op: 'write', path: FILE, text: `${JSON.stringify({ sections: next }, null, 2)}\n` },
  ]);
}

export function addSection(name: string, pageId?: PageId): Promise<void> {
  const section: SidebarSection = {
    id: newId(),
    name: name.trim().slice(0, 60) || 'Section',
    hidden: false,
    pages: pageId ? [pageId] : [],
  };
  return save([...sections, section]);
}

export function updateSection(id: string, change: Partial<Omit<SidebarSection, 'id'>>): Promise<void> {
  return save(sections.map((section) => (section.id === id ? { ...section, ...change } : section)));
}

export function removeSection(id: string): Promise<void> {
  return save(sections.filter((section) => section.id !== id));
}

export function moveSection(id: string, by: -1 | 1): Promise<void> {
  const index = sections.findIndex((section) => section.id === id);
  const to = index + by;
  if (index < 0 || to < 0 || to >= sections.length) return Promise.resolve();
  const next = [...sections];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item!);
  return save(next);
}

// a page goes into a section, or out of it when it is already there
export function togglePageInSection(id: string, pageId: PageId): Promise<void> {
  return save(
    sections.map((section) =>
      section.id !== id
        ? section
        : {
            ...section,
            pages: section.pages.includes(pageId)
              ? section.pages.filter((page) => page !== pageId)
              : [...section.pages, pageId],
          },
    ),
  );
}
