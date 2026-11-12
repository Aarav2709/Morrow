import {
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Music,
  Paperclip,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fileIdsInDoc } from '../../core/doc';
import { displayTitle } from '../../core/model';
import type { FileMeta, PageMeta } from '../../core/model';
import { livePages } from '../../core/tree';
import { t } from '../i18n';
import { fileUrl, formatBytes } from '../platform/attachments';
import { desktop } from '../platform/desktop';
import { openPage } from '../router';
import { getSession, useWorkspace } from '../workspace';
import { relativeTime, useShowMore } from './primitives';
import { TopBar } from './TopBar';

type Kind = 'all' | 'pictures' | 'media' | 'documents' | 'unused';

const kindOf = (file: FileMeta): Exclude<Kind, 'all' | 'unused'> =>
  file.type.startsWith('image/')
    ? 'pictures'
    : file.type.startsWith('audio/') || file.type.startsWith('video/')
      ? 'media'
      : 'documents';

// every file in the vault's attachments folder, with the pages that use it
export function FilesView() {
  const state = useWorkspace();
  const [files, setFiles] = useState<FileMeta[] | null>(null);
  const [kind, setKind] = useState<Kind>('all');
  useEffect(() => {
    let live = true;
    void getSession()
      .listFiles()
      .catch(() => [])
      .then((list) => live && setFiles([...list].sort((a, b) => b.createdAt - a.createdAt)));
    return () => {
      live = false;
    };
  }, [state.docs]);
  const usedBy = useMemo(() => {
    const map = new Map<string, PageMeta[]>();
    for (const page of livePages(state.pages)) {
      const doc = state.docs[page.id];
      if (!doc) continue;
      for (const id of new Set(fileIdsInDoc(doc))) map.set(id, [...(map.get(id) ?? []), page]);
    }
    return map;
  }, [state]);
  const shownFiles = useMemo(
    () =>
      (files ?? []).filter((file) =>
        kind === 'all' ? true : kind === 'unused' ? !usedBy.has(file.id) : kindOf(file) === kind,
      ),
    [files, kind, usedBy],
  );
  const { shown, more } = useShowMore(shownFiles, 60);
  const kinds: Array<[Kind, string]> = [
    ['all', t('files.all')],
    ['pictures', t('files.pictures')],
    ['media', t('files.media')],
    ['documents', t('files.documents')],
    ['unused', t('files.unused')],
  ];
  return (
    <div className="view">
      <TopBar>
        <span className="topbar-title">{t('files.title')}</span>
      </TopBar>
      <div className="page-scroll">
        <div className="collection">
          <header className="collection-header">
            <h1>{t('files.title')}</h1>
            <p className="muted">{t('files.subtitle')}</p>
            <div className="segmented" role="radiogroup" aria-label={t('files.title')}>
              {kinds.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  className={kind === value ? 'is-active' : ''}
                  onClick={() => setKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </header>
          {files !== null && shownFiles.length === 0 ? (
            <div className="empty-state compact">
              <Paperclip size={24} strokeWidth={1.5} />
              <p>{t('files.empty')}</p>
            </div>
          ) : (
            <ul className="file-grid">
              {shown.map((file) => (
                <FileCard key={file.id} file={file} pages={usedBy.get(file.id) ?? []} />
              ))}
            </ul>
          )}
          {more}
        </div>
      </div>
    </div>
  );
}

function FileCard({ file, pages }: { file: FileMeta; pages: PageMeta[] }) {
  const [url, setUrl] = useState<string | null>(null);
  const picture = file.type.startsWith('image/');
  useEffect(() => {
    if (picture) void fileUrl(file.id).then(setUrl);
  }, [file.id, picture]);
  const vault = desktop?.vault;
  return (
    <li className="file-card">
      <button
        type="button"
        className="file-card-preview"
        title={t('editor.openInDefaultApp')}
        onClick={() => void vault?.openFile(file.id)}
        disabled={!vault}
      >
        {picture && url ? <img src={url} alt="" loading="lazy" /> : <FileKindIcon file={file} />}
      </button>
      <div className="file-card-body">
        <span className="file-card-name" title={file.name}>
          {file.name}
        </span>
        <span className="muted small">
          {formatBytes(file.size)} · {relativeTime(file.createdAt)}
        </span>
        <span className="file-card-pages">
          {pages.length === 0 ? (
            <span className="muted small">{t('files.notUsed')}</span>
          ) : (
            pages.slice(0, 3).map((page) => (
              <button
                key={page.id}
                type="button"
                className="link-button small"
                data-page-id={page.id}
                onClick={() => openPage(page.id)}
              >
                {displayTitle(page)}
              </button>
            ))
          )}
        </span>
      </div>
      {vault && (
        <div className="file-card-actions">
          <button
            type="button"
            className="icon-button small"
            aria-label={t('editor.openInDefaultApp')}
            title={t('editor.openInDefaultApp')}
            onClick={() => void vault.openFile(file.id)}
          >
            <ExternalLink size={14} />
          </button>
          <button
            type="button"
            className="icon-button small"
            aria-label={t('pageMenu.showInFolder')}
            title={t('pageMenu.showInFolder')}
            onClick={() => void vault.reveal(file.id)}
          >
            <FolderOpen size={14} />
          </button>
        </div>
      )}
    </li>
  );
}

function FileKindIcon({ file }: { file: FileMeta }) {
  const props = { size: 28, strokeWidth: 1.5 };
  if (file.type.startsWith('image/')) return <ImageIcon {...props} />;
  if (file.type.startsWith('audio/')) return <Music {...props} />;
  if (file.type.startsWith('video/')) return <Video {...props} />;
  if (file.type === 'application/pdf' || file.type.startsWith('text/')) return <FileText {...props} />;
  return <Paperclip {...props} />;
}
