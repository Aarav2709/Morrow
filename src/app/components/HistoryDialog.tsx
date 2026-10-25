import { generateHTML } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { findDatabaseOf, formatValue } from '../../core/database';
import { docToPlainText } from '../../core/doc';
import { diffLines } from '../../core/diff';
import type { DiffLine } from '../../core/diff';
import { docToMarkdown } from '../../core/markdown/serialize';
import { displayTitle } from '../../core/model';
import type { PageId, PageMeta, PropValue, Snapshot, WorkspaceState } from '../../core/model';
import { createExtensions } from '../editor/extensions';
import { restoreVersion } from '../operations';
import { fileUrl } from '../platform/attachments';
import { closeDialog } from '../ui';
import { getSession, useWorkspace } from '../workspace';
import { Dialog, relativeTime } from './primitives';
import { dateLocale, t, tp } from '../i18n';

let previewExtensions: ReturnType<typeof createExtensions> | null = null;

// rendering needs the schema only, so the editor callbacks are inert here
function extensionsForPreview() {
  previewExtensions ??= createExtensions({
    getTitle: () => null,
    subscribe: () => () => {},
    open: () => {},
    findPages: () => [],
    createPage: () => null,
    onBlockMenu: () => {},
    resolvePage: () => null,
    resolveTarget: () => null,
    createFromTarget: () => null,
    openTag: () => {},
    createChild: () => null,
    renderEmbed: () => null,
    openDate: () => {},
  });
  return previewExtensions;
}

// a page's properties as lines above its text, so a version that only changed a property shows what changed
function propertyText(
  state: WorkspaceState,
  page: PageMeta,
  properties: Record<string, PropValue>,
  extra: Record<string, unknown>,
): string {
  const lines: string[] = [];
  for (const prop of findDatabaseOf(state, page)?.database?.properties ?? []) {
    const value = properties[prop.id];
    if (value !== undefined && value !== null) lines.push(`${prop.name}: ${formatValue(prop, value)}`);
  }
  for (const [key, value] of Object.entries(extra))
    lines.push(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return lines.length ? `${lines.join('\n')}\n\n` : '';
}

export function HistoryDialog({ pageId }: { pageId: PageId }) {
  const state = useWorkspace();
  const page = state.pages[pageId];
  const [versions, setVersions] = useState<Snapshot[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<'changes' | 'version'>('changes');
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getSession()
      .listSnapshots(pageId)
      .then((list) => !cancelled && setVersions(list))
      .catch(() => !cancelled && setVersions([]));
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  const snapshot = versions?.[selected];
  const current = state.docs[pageId];
  // what changed from that version to the page as it is now
  const changes = useMemo(() => {
    if (!snapshot || !current || !page) return [];
    const now = propertyText(state, page, page.properties, page.extra);
    // versions kept before properties were part of history show them as they are now
    const then =
      snapshot.properties || snapshot.extra
        ? propertyText(state, page, snapshot.properties ?? {}, snapshot.extra ?? {})
        : now;
    return diffLines(then + docToMarkdown(snapshot.doc), now + docToMarkdown(current));
  }, [snapshot, current, page, state]);
  const html = useMemo(() => {
    if (!snapshot) return '';
    try {
      return generateHTML(snapshot.doc as JSONContent, extensionsForPreview());
    } catch {
      return '';
    }
  }, [snapshot]);

  // images in a preview load from local storage like they do in the editor
  useEffect(() => {
    for (const img of previewRef.current?.querySelectorAll<HTMLImageElement>('img[data-file-id]') ?? []) {
      void fileUrl(img.dataset.fileId ?? '').then((url) => url && (img.src = url));
    }
  }, [html]);

  if (!page) return null;

  return (
    <Dialog
      title={t('history.title', { title: displayTitle(page) })}
      size="large"
      className="history-dialog"
      onClose={closeDialog}
    >
      {versions === null ? (
        <p className="muted">{t('history.loadingVersions')}</p>
      ) : versions.length === 0 ? (
        <div className="empty-state compact">
          <History size={24} strokeWidth={1.5} />
          <p>{t('history.empty')}</p>
        </div>
      ) : (
        <div className="history-layout">
          <ul className="history-list" role="listbox" aria-label={t('history.versions')}>
            {versions.map((version, index) => {
              const words = docToPlainText(version.doc).split(/\s+/).filter(Boolean).length;
              return (
                <li key={version.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === selected}
                    className={`history-item${index === selected ? ' is-active' : ''}`}
                    onClick={() => setSelected(index)}
                  >
                    <span>
                      {new Date(version.createdAt).toLocaleString(dateLocale(), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    <span className="muted small">
                      {relativeTime(version.createdAt)} · {tp('history.words', words)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="history-preview">
            <div className="segmented history-mode" role="radiogroup" aria-label={t('common.show')}>
              {(['changes', 'version'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  className={mode === value ? 'is-active' : ''}
                  onClick={() => setMode(value)}
                >
                  {value === 'changes' ? t('history.changesSince') : t('history.thatVersion')}
                </button>
              ))}
            </div>
            {mode === 'changes' ? (
              <DiffView lines={changes} />
            ) : (
              <div ref={previewRef} className="prose preview" dangerouslySetInnerHTML={{ __html: html }} />
            )}
            {snapshot && (
              <div className="history-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => void restoreVersion(snapshot).then((done) => done && closeDialog())}
                >
                  {t('history.restoreThisVersion')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

// shows removed lines in red and added lines in green, long unchanged stretches fold away
function DiffView({ lines }: { lines: DiffLine[] }) {
  if (lines.every((line) => line.kind === 'same'))
    return <p className="muted history-same">{t('history.sameAsNow')}</p>;
  const rows: Array<DiffLine | { kind: 'gap'; count: number }> = [];
  let run: DiffLine[] = [];
  const flush = (end: boolean) => {
    if (run.length > 6) {
      if (rows.length > 0) rows.push(...run.slice(0, 2));
      rows.push({ kind: 'gap', count: run.length - (rows.length > 0 ? 2 : 0) - (end ? 0 : 2) });
      if (!end) rows.push(...run.slice(-2));
    } else rows.push(...run);
    run = [];
  };
  for (const line of lines) {
    if (line.kind === 'same') run.push(line);
    else {
      flush(false);
      rows.push(line);
    }
  }
  flush(true);
  return (
    <div className="diff" role="table" aria-label={t('settings.assistant.changesTitle')}>
      {rows.map((row, index) =>
        row.kind === 'gap' ? (
          <div key={index} className="diff-gap">
            {tp('history.unchangedLines', row.count)}
          </div>
        ) : (
          <div key={index} className={`diff-line diff-${row.kind}`}>
            <span className="diff-sign" aria-hidden="true">
              {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}
            </span>
            <span className="visually-hidden">
              {row.kind === 'added' ? 'Added: ' : row.kind === 'removed' ? 'Removed: ' : ''}
            </span>
            {row.text || ' '}
          </div>
        ),
      )}
    </div>
  );
}
