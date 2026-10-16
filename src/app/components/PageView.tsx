import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { ArrowUpRight, FileWarning, Image as ImageIcon, RotateCcw, Smile, Trash2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { docToPlainText, findUnknownTypes, inlineText } from '../../core/doc';
import { backlinksTo, unlinkedMentions } from '../../core/links';
import { displayTitle, emptyDoc } from '../../core/model';
import type { DocNode, PageId, PageMeta } from '../../core/model';
import { childrenOf, isEffectivelyTrashed } from '../../core/tree';
import { findDatabaseOf } from '../../core/database';
import { PageEditor } from '../editor/PageEditor';
import { CoverBanner, CoverPicker } from './Cover';
import { LockedPage } from './EncryptDialog';
import { RowProperties } from './database/RowProperties';
import { PageTags } from './TagsView';
import { deleteForever, restorePage } from '../operations';
import { usePreferences } from '../platform/preferences';
import { navigate, openPage } from '../router';
import { getUi, openDialog, setUi, useUi } from '../ui';
import { getSession, run, useWorkspace } from '../workspace';
import type { MenuEntry } from './Menu';
import { pageMenuEntries } from './pageMenu';
import { relativeTime } from './primitives';
import { PageIcon } from './Sidebar';
import { TopBar } from './TopBar';

const EMPTY_DOC = emptyDoc();

// canvases and database views load the first time one is opened
const CanvasView = lazy(() => import('./CanvasView').then((module) => ({ default: module.CanvasView })));
const DatabaseView = lazy(() =>
  import('./database/DatabaseView').then((module) => ({ default: module.DatabaseView })),
);

// focuses right away, tiptap's own focus waits a frame and fast typing would land in the title
function focusStart(editor: Editor) {
  if (editor.isDestroyed) return;
  const { state, view } = editor;
  view.dispatch(state.tr.setSelection(TextSelection.atStart(state.doc)));
  view.focus();
}

export function PageView({ id, find }: { id: PageId; find: string | null }) {
  const state = useWorkspace();
  const page = state.pages[id];
  const [editing, setEditing] = useState(false);
  const [coverPicker, setCoverPicker] = useState<HTMLElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<Editor | null>(null);
  // enter in the title can arrive before the editor exists, focus it once it does
  const focusWhenReady = useRef(false);
  const prefs = usePreferences();

  useEffect(() => {
    if (state.pages[id]) run({ type: 'page.markOpened', id, now: Date.now() });
    // only when a different page opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!page) {
    return (
      <div className="view">
        <TopBar />
        <div className="empty-state">
          <FileWarning size={28} strokeWidth={1.5} />
          <h1>This page does not exist</h1>
          <p>It may have been deleted forever.</p>
          <button type="button" className="button" onClick={() => navigate({ name: 'home' })}>
            Go home
          </button>
        </div>
      </div>
    );
  }

  const trashed = isEffectivelyTrashed(state.pages, id);
  const unreadable = getSession().unreadable.has(id);
  const doc = state.docs[id] ?? EMPTY_DOC;

  const menu = (): MenuEntry[] => {
    const words = docToPlainText(doc).split(/\s+/).filter(Boolean).length;
    const info: MenuEntry = {
      heading: `${words.toLocaleString()} word${words === 1 ? '' : 's'} · created ${relativeTime(page.createdAt)}`,
    };
    if (trashed) return [info];
    return [info, ...pageMenuEntries(id, () => titleRef.current?.focus())];
  };

  const database = findDatabaseOf(state, page);

  if (page.kind === 'canvas') {
    return (
      <div className="view">
        <TopBar page={page} editing={editing} menu={menu} />
        {trashed && (
          <div className="banner" role="note">
            <span>This canvas is in the trash.</span>
            <button
              type="button"
              className="button small"
              onClick={() => restorePage(findTrashedAncestor(state.pages, id) ?? id)}
            >
              <RotateCcw size={14} /> Restore
            </button>
          </div>
        )}
        {unreadable ? (
          <div className="banner is-error" role="alert">
            This canvas file could not be read. It has been left untouched on disk.
          </div>
        ) : (
          <Suspense fallback={<div className="canvas-view" aria-busy="true" />}>
            <CanvasView pageId={id} doc={state.docs[id]} editable={!trashed} />
          </Suspense>
        )}
      </div>
    );
  }

  return (
    <div className="view">
      <TopBar page={page} editing={editing} menu={menu} />
      <div className="page-scroll">
        {trashed && (
          <div className="banner" role="note">
            <span>This page is in the trash.</span>
            <button
              type="button"
              className="button small"
              onClick={() => restorePage(findTrashedAncestor(state.pages, id) ?? id)}
            >
              <RotateCcw size={14} /> Restore
            </button>
            <button
              type="button"
              className="button small danger"
              onClick={() => deleteForever(findTrashedAncestor(state.pages, id) ?? id)}
            >
              <Trash2 size={14} /> Delete forever
            </button>
          </div>
        )}
        {page.kind !== 'database' && !unreadable && <Outline doc={doc} />}
        <CoverBanner page={page} editable={!trashed} />
        <article className={`page font-${prefs.font} width-${prefs.width}${page.cover ? ' has-cover' : ''}`}>
          <div className="page-icon-row">
            {page.icon ? (
              <button
                type="button"
                className="page-icon"
                aria-label="Change icon"
                disabled={trashed}
                onClick={() => openDialog({ kind: 'icon', pageId: id })}
              >
                {page.icon}
              </button>
            ) : (
              !trashed && (
                <button
                  type="button"
                  className="add-icon"
                  onClick={() => openDialog({ kind: 'icon', pageId: id })}
                >
                  <Smile size={14} /> Add icon
                </button>
              )
            )}
            {!page.cover && !trashed && (
              <button
                type="button"
                className="add-icon"
                onClick={(event) => setCoverPicker(event.currentTarget)}
              >
                <ImageIcon size={14} /> Add cover
              </button>
            )}
            {coverPicker && (
              <CoverPicker page={page} anchor={coverPicker} onClose={() => setCoverPicker(null)} />
            )}
          </div>
          <h1 className="page-title-heading">
            <TitleField
              page={page}
              readOnly={trashed}
              inputRef={titleRef}
              onEnter={() => {
                if (editorRef.current) focusStart(editorRef.current);
                else focusWhenReady.current = true;
              }}
            />
          </h1>
          {page.kind !== 'database' && <PageTags page={page} editable={!trashed && !unreadable} />}
          {database?.database && (
            <RowProperties row={page} database={database.database} dbId={database.id} editable={!trashed} />
          )}
          {page.kind === 'database' ? (
            <Suspense fallback={<div className="database" aria-busy="true" />}>
              <DatabaseView page={page} editable={!trashed && !unreadable} />
            </Suspense>
          ) : unreadable && page.encrypted ? (
            <LockedPage page={page} />
          ) : unreadable ? (
            <div className="banner is-error" role="alert">
              The content of this page could not be read. It has been left untouched in storage and is
              protected from changes. Saving a backup will not include it.
            </div>
          ) : (
            <PageBody
              id={id}
              doc={doc}
              editable={!trashed}
              find={find}
              onDirty={setEditing}
              onExitTop={() => {
                const title = titleRef.current;
                if (!title) return;
                title.focus();
                title.setSelectionRange(title.value.length, title.value.length);
              }}
              onReady={(editor) => {
                editorRef.current = editor;
                if (!focusWhenReady.current) return;
                focusWhenReady.current = false;
                requestAnimationFrame(() => focusStart(editor));
              }}
            />
          )}
          {page.kind !== 'database' && <Subpages parentId={id} />}
          <Backlinks id={id} />
        </article>
      </div>
    </div>
  );
}

function findTrashedAncestor(pages: Record<PageId, PageMeta>, id: PageId): PageId | null {
  let current = pages[id];
  for (let guard = 0; current && guard < 256; guard++) {
    if (current.trashedAt !== null) return current.id;
    current = current.parentId ? pages[current.parentId] : undefined;
  }
  return null;
}

function PageBody(props: {
  id: PageId;
  doc: typeof EMPTY_DOC;
  editable: boolean;
  find: string | null;
  onDirty: (dirty: boolean) => void;
  onExitTop: () => void;
  onReady: (editor: Editor) => void;
}) {
  const unknown = useMemo(() => findUnknownTypes(props.doc), [props.doc]);
  if (unknown.length > 0) {
    return (
      <>
        <div className="banner" role="note">
          This page contains content from a newer version of Morrow ({unknown.join(', ')}). It is shown as
          plain text and protected from changes so nothing is lost.
        </div>
        <pre className="readonly-text">{docToPlainText(props.doc)}</pre>
      </>
    );
  }
  return (
    <PageEditor
      pageId={props.id}
      doc={props.doc}
      editable={props.editable}
      find={props.find}
      onDirty={props.onDirty}
      onExitTop={props.onExitTop}
      onReady={props.onReady}
    />
  );
}

function TitleField({
  page,
  readOnly,
  inputRef,
  onEnter,
}: {
  page: PageMeta;
  readOnly: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onEnter: () => void;
}) {
  const ui = useUi();

  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  });

  useEffect(() => {
    if (ui.focusTitle !== page.id) return;
    inputRef.current?.focus();
    if (getUi().focusTitle === page.id) setUi({ focusTitle: null });
  }, [ui.focusTitle, page.id, inputRef]);

  return (
    <textarea
      ref={inputRef}
      className="page-title"
      rows={1}
      placeholder="Untitled"
      aria-label="Page title"
      value={page.title}
      readOnly={readOnly}
      spellCheck
      onChange={(event) =>
        run({ type: 'page.rename', id: page.id, title: event.target.value, now: Date.now() })
      }
      onKeyDown={(event) => {
        const target = event.currentTarget;
        const atEnd =
          target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
        if (event.key === 'Enter' || (event.key === 'ArrowDown' && atEnd)) {
          event.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

function Subpages({ parentId }: { parentId: PageId }) {
  const state = useWorkspace();
  const children = useMemo(() => childrenOf(state.pages, parentId), [state.pages, parentId]);
  if (children.length === 0) return null;
  return (
    <section className="page-section" aria-label="Subpages">
      <h2 className="section-label">Subpages</h2>
      <ul className="link-list">
        {children.map((child) => {
          return (
            <li key={child.id}>
              <button type="button" className="link-row" onClick={() => openPage(child.id)}>
                <span className="tree-icon">
                  <PageIcon page={child} />
                </span>
                <span className="link-row-title">{displayTitle(child)}</span>
                <span className="link-row-meta">{relativeTime(child.updatedAt)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Backlinks({ id }: { id: PageId }) {
  const state = useWorkspace();
  const backlinks = useMemo(() => backlinksTo(state, id), [state, id]);
  const [showMentions, setShowMentions] = useState(false);
  const mentions = useMemo(
    () => (showMentions ? unlinkedMentions(state, id) : []),
    [state, id, showMentions],
  );
  const title = displayTitle(state.pages[id]);
  const mentionsSection = (
    <section className="page-section" aria-label="Unlinked mentions">
      <button
        type="button"
        className="section-label link-button mentions-toggle"
        aria-expanded={showMentions}
        onClick={() => setShowMentions((open) => !open)}
      >
        {showMentions ? 'Hide' : 'Find'} pages that mention “{title}” without linking
      </button>
      {showMentions &&
        (mentions.length === 0 ? (
          <p className="muted small">No other page mentions it.</p>
        ) : (
          <ul className="link-list">
            {mentions.map(({ source, context }) => (
              <li key={source.id}>
                <button
                  type="button"
                  className="link-row backlink"
                  onClick={() => openPage(source.id, title)}
                >
                  <span className="link-row-title">
                    {displayTitle(source)} <ArrowUpRight size={13} />
                  </span>
                  <span className="backlink-context">{context}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
  if (backlinks.length === 0) return mentionsSection;
  return (
    <>
      <section className="page-section" aria-label="Backlinks">
        <h2 className="section-label">
          Linked from {backlinks.length} page{backlinks.length === 1 ? '' : 's'}
        </h2>
        <ul className="link-list">
          {backlinks.map(({ source, contexts }) => (
            <li key={source.id}>
              <button type="button" className="link-row backlink" onClick={() => openPage(source.id)}>
                <span className="link-row-title">
                  {displayTitle(source)} <ArrowUpRight size={13} />
                </span>
                {contexts[0] && <span className="backlink-context">{contexts[0]}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {mentionsSection}
    </>
  );
}

interface Heading {
  level: number;
  text: string;
}

function headingsOf(doc: DocNode): Heading[] {
  return (doc.content ?? [])
    .filter((node) => node.type === 'heading')
    .map((node) => ({ level: Number(node.attrs?.level ?? 1), text: inlineText(node).trim() }))
    .filter((heading) => heading.text);
}

// a list of the page's headings beside long pages, click one to jump to it
function Outline({ doc }: { doc: DocNode }) {
  const headings = useMemo(() => headingsOf(doc), [doc]);
  if (headings.length < 3) return null;
  const jump = (index: number) => {
    const elements = document.querySelectorAll<HTMLElement>(
      '.editor-surface .prose > h1, .editor-surface .prose > h2, .editor-surface .prose > h3',
    );
    elements[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <nav className="page-outline" aria-label="Outline">
      <p className="page-outline-title">On this page</p>
      <ul>
        {headings.map((heading, index) => (
          <li key={index} style={{ '--level': heading.level } as React.CSSProperties}>
            <button type="button" onClick={() => jump(index)}>
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
