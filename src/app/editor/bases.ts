// a ```base block drawn as its views: a table, cards or a list of the pages it finds, kept up to date as
// pages change. the yaml stays in the block, so the page is still plain markdown obsidian reads too
import { BaseError, display, runBase } from '../../core/bases';
import type { BaseView, Value } from '../../core/bases';
import { displayTitle } from '../../core/model';
import { t } from '../i18n';
import { getSession, getState } from '../workspace';

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

function link(pageId: string, label: string): string {
  const id = escape(encodeURIComponent(pageId));
  return `<a class="base-link" href="#/page/${id}" data-page-id="${escape(pageId)}">${escape(label)}</a>`;
}

function cell(value: Value): string {
  if (typeof value === 'boolean') return value ? '✓' : '';
  return escape(display(value));
}

function viewHtml(view: BaseView): string {
  const title = (pageId: string) => {
    const page = getState().pages[pageId];
    return page ? displayTitle(page) : pageId;
  };
  const head = `<div class="base-view-name">${escape(view.name)} <span>${view.rows.length}</span></div>`;
  if (view.error) return `${head}<div class="base-error">${escape(view.error)}</div>`;
  if (view.rows.length === 0) return `${head}<div class="base-empty">${escape(t('editor.baseEmpty'))}</div>`;
  const named = (column: string) => column === 'file.name' || column === 'file.basename';
  if (view.type === 'list')
    return `${head}<ul class="base-list">${view.rows
      .map((row) => `<li>${link(row.pageId, title(row.pageId))}</li>`)
      .join('')}</ul>`;
  if (view.type === 'cards')
    return `${head}<div class="base-cards">${view.rows
      .map((row) => {
        const fields = view.columns
          .filter((column) => !named(column.id) && display(row.values[column.id] ?? null))
          .map(
            (column) =>
              `<div><span>${escape(column.label)}</span>${cell(row.values[column.id] ?? null)}</div>`,
          )
          .join('');
        return `<div class="base-card">${link(row.pageId, title(row.pageId))}${fields}</div>`;
      })
      .join('')}</div>`;
  const header = view.columns.map((column) => `<th>${escape(column.label)}</th>`).join('');
  const body = view.rows
    .map(
      (row) =>
        `<tr>${view.columns
          .map((column) => {
            const value = row.values[column.id] ?? null;
            return `<td>${named(column.id) ? link(row.pageId, display(value) || title(row.pageId)) : cell(value)}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `${head}<div class="base-table"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderBase(source: string): { html: string; error: boolean } {
  if (!source.trim()) return { html: '', error: false };
  try {
    const session = getSession();
    const views = runBase(source, getState(), { pathOf: (id) => session.pathOf(id) });
    return { html: views.map(viewHtml).join(''), error: false };
  } catch (error) {
    return {
      html: escape(error instanceof BaseError || error instanceof Error ? error.message : String(error)),
      error: true,
    };
  }
}

// redraws when pages change, a moment after the last change, so typing elsewhere stays quick
export function onPagesChange(redraw: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = getState();
  const stop = getSession().subscribe(() => {
    const next = getState();
    if (next.pages === last.pages && next.docs === last.docs) return;
    last = next;
    if (timer) clearTimeout(timer);
    timer = setTimeout(redraw, 400);
  });
  return () => {
    if (timer) clearTimeout(timer);
    stop();
  };
}

export const SAMPLE_BASE = `filters:
  and:
    - file.hasTag("book")
formulas:
  short: 'if(pages < 300, "yes", "")'
views:
  - type: table
    name: Books
    order: [file.name, author, rating, formula.short]
    sort:
      - property: rating
        direction: DESC
`;
