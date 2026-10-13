import { generateHTML } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { docToPlainText } from '../../core/doc';
import { displayTitle } from '../../core/model';
import type { PageId, Snapshot } from '../../core/model';
import { createExtensions } from '../editor/extensions';
import { restoreVersion } from '../operations';
import { fileUrl } from '../platform/attachments';
import { closeDialog } from '../ui';
import { getSession, useWorkspace } from '../workspace';
import { Dialog, relativeTime } from './primitives';

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
  });
  return previewExtensions;
}

export function HistoryDialog({ pageId }: { pageId: PageId }) {
  const state = useWorkspace();
  const page = state.pages[pageId];
  const [versions, setVersions] = useState<Snapshot[] | null>(null);
  const [selected, setSelected] = useState(0);
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
      title={`History of “${displayTitle(page)}”`}
      size="large"
      className="history-dialog"
      onClose={closeDialog}
    >
      {versions === null ? (
        <p className="muted">Loading versions…</p>
      ) : versions.length === 0 ? (
        <div className="empty-state compact">
          <History size={24} strokeWidth={1.5} />
          <p>No versions yet. Morrow keeps a version of a page every ten minutes while you edit it.</p>
        </div>
      ) : (
        <div className="history-layout">
          <ul className="history-list" role="listbox" aria-label="Versions">
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
                      {new Date(version.createdAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    <span className="muted small">
                      {relativeTime(version.createdAt)} · {words.toLocaleString()} words
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="history-preview">
            <div ref={previewRef} className="prose preview" dangerouslySetInnerHTML={{ __html: html }} />
            {snapshot && (
              <div className="history-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => void restoreVersion(snapshot).then((done) => done && closeDialog())}
                >
                  Restore this version
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

const ICONS = [
  '📝',
  '📄',
  '📚',
  '📖',
  '🗒️',
  '📌',
  '📎',
  '🔖',
  '🗂️',
  '📁',
  '📅',
  '🗓️',
  '⏰',
  '✅',
  '☑️',
  '⭐',
  '💡',
  '🔥',
  '🎯',
  '🚀',
  '🧭',
  '🧪',
  '🔬',
  '🧠',
  '💬',
  '✉️',
  '📞',
  '🏠',
  '🏡',
  '🌱',
  '🌿',
  '🌳',
  '🌸',
  '🌻',
  '🍂',
  '❄️',
  '☀️',
  '🌙',
  '🌊',
  '⛰️',
  '🏕️',
  '✈️',
  '🚲',
  '🚗',
  '🗺️',
  '🍳',
  '🥗',
  '☕',
  '🍷',
  '🎵',
  '🎨',
  '📷',
  '🎬',
  '🎮',
  '⚽',
  '🏃',
  '🧘',
  '💪',
  '❤️',
  '💼',
  '💰',
  '📈',
  '🛒',
  '🧾',
  '🔧',
  '🛠️',
  '💻',
  '🖥️',
  '📱',
  '🔒',
  '🔑',
  '⚙️',
  '🧩',
  '🎁',
  '🐶',
  '🐱',
  '👶',
  '👥',
  '🙂',
  '✨',
];

export function IconDialog({ pageId, onPick }: { pageId: PageId; onPick: (icon: string | null) => void }) {
  const state = useWorkspace();
  const page = state.pages[pageId];
  if (!page) return null;
  const pick = (icon: string | null) => {
    onPick(icon);
    closeDialog();
  };
  return (
    <Dialog title="Choose an icon" size="small" onClose={closeDialog}>
      <div className="icon-grid" role="listbox" aria-label="Icons">
        {ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            role="option"
            aria-selected={page.icon === icon}
            className={`icon-choice${page.icon === icon ? ' is-active' : ''}`}
            onClick={() => pick(icon)}
          >
            {icon}
          </button>
        ))}
      </div>
      {page.icon && (
        <button type="button" className="button small icon-remove" onClick={() => pick(null)}>
          Remove icon
        </button>
      )}
    </Dialog>
  );
}
