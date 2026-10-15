// templates are the subpages of the templates page, a new page starts as a copy of one
import { cloneDoc } from './doc';
import type { DocNode, PageMeta, WorkspaceState } from './model';
import { childrenOf, livePages } from './tree';

export const TEMPLATES_TITLE = 'Templates';
// a template with this title is used for every new daily note
export const DAILY_TEMPLATE_TITLE = 'Daily note';

export function findTemplatesPage(state: WorkspaceState): PageMeta | null {
  return livePages(state.pages).find((page) => page.kind === 'templates' && page.parentId === null) ?? null;
}

export function listTemplates(state: WorkspaceState): PageMeta[] {
  const container = findTemplatesPage(state);
  return container ? childrenOf(state.pages, container.id) : [];
}

export function dailyTemplate(state: WorkspaceState): PageMeta | null {
  return listTemplates(state).find((page) => page.title.trim().toLowerCase() === DAILY_TEMPLATE_TITLE.toLowerCase()) ?? null;
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

// the moment.js tokens obsidian templates use most, enough for dates like YYYY-MM-DD or dddd, D MMMM
export function formatDate(date: Date, format: string, locale?: string): string {
  const weekday = (style: 'long' | 'short') => date.toLocaleDateString(locale, { weekday: style });
  const month = (style: 'long' | 'short') => date.toLocaleDateString(locale, { month: style });
  const tokens: Record<string, () => string> = {
    YYYY: () => String(date.getFullYear()),
    YY: () => String(date.getFullYear()).slice(-2),
    MMMM: () => month('long'),
    MMM: () => month('short'),
    MM: () => pad(date.getMonth() + 1),
    M: () => String(date.getMonth() + 1),
    DD: () => pad(date.getDate()),
    D: () => String(date.getDate()),
    dddd: () => weekday('long'),
    ddd: () => weekday('short'),
    HH: () => pad(date.getHours()),
    H: () => String(date.getHours()),
    mm: () => pad(date.getMinutes()),
    ss: () => pad(date.getSeconds()),
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|ss/g, (match, literal: string | undefined) =>
    literal !== undefined ? literal : (tokens[match]?.() ?? match),
  );
}

export interface TemplateValues {
  title: string;
  date: Date;
}

// fills {{title}}, {{date}}, {{time}} and {{date:FORMAT}} in every piece of text
export function fillTemplate(text: string, values: TemplateValues): string {
  return text.replace(/\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/gi, (_match, name: string, format?: string) => {
    const key = name.toLowerCase();
    if (key === 'title') return values.title;
    if (key === 'time') return formatDate(values.date, format?.trim() || 'HH:mm');
    return formatDate(values.date, format?.trim() || 'YYYY-MM-DD');
  });
}

export function applyTemplate(doc: DocNode, values: TemplateValues): DocNode {
  const copy = cloneDoc(doc);
  const visit = (node: DocNode) => {
    if (node.type === 'text' && node.text) node.text = fillTemplate(node.text, values);
    if (node.attrs) {
      for (const key of ['latex', 'text', 'title'] as const) {
        const value: unknown = node.attrs[key];
        if (typeof value === 'string') node.attrs = { ...node.attrs, [key]: fillTemplate(value, values) };
      }
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(copy);
  return copy;
}
