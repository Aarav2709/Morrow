import type { Editor } from '@tiptap/core';
import { ArrowUpRight, FileWarning, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { docToPlainText, findUnknownTypes } from '../../core/doc';
import { backlinksTo } from '../../core/links';
import { displayTitle, emptyDoc } from '../../core/model';
import type { PageId, PageMeta } from '../../core/model';
import { childrenOf, isEffectivelyTrashed } from '../../core/tree';
import { PageEditor } from '../editor/PageEditor';
import { deleteForever, restorePage } from '../operations';
import { usePreferences } from '../platform/preferences';
import { navigate, openPage } from '../router';
import { getUi, setUi, useUi } from '../ui';
import { getSession, run, useWorkspace } from '../workspace';
import type { MenuEntry } from './Menu';
import { pageMenuEntries } from './pageMenu';
import { relativeTime } from './primitives';
import { PageIcon } from './Sidebar';
import { TopBar } from './TopBar';

const EMPTY_DOC = emptyDoc();

export function PageView({ id, find }: { id: PageId; find: string | null }) {
  const state = useWorkspace();
  const page = state.pages[id];
  const [editing, setEditing] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<Editor | null>(null);
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
        <article className={`page font-${prefs.font} width-${prefs.width}`}>
          <TitleField
            page={page}
            readOnly={trashed}
            inputRef={titleRef}
            onEnter={() => editorRef.current?.chain().focus('start').run()}
          />
          {unreadable ? (
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
              onReady={(editor) => (editorRef.current = editor)}
            />
          )}
          <Subpages parentId={id} />
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
  if (backlinks.length === 0) return null;
  return (
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
  );
}
