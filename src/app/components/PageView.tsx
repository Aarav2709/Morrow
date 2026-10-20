import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import {
  ArrowUpRight,
  Columns2,
  FileWarning,
  Image as ImageIcon,
  ListPlus,
  RotateCcw,
  Smile,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { docToPlainText, findUnknownTypes, inlineText, isDocEmpty } from '../../core/doc';
import { backlinksTo, unlinkedMentions } from '../../core/links';
import { displayTitle, emptyDoc } from '../../core/model';
import type { DocNode, PageId, PageMeta } from '../../core/model';
import { childrenOf, isEffectivelyTrashed } from '../../core/tree';
import { findTemplatesPage } from '../../core/templates';
import { RepeatBar } from './RepeatBar';
import { findDatabaseOf } from '../../core/database';
import { basename, conflictOriginal, stripExtension } from '../../core/vault/paths';
import { PageEditor } from '../editor/PageEditor';
import { SourceEditor } from './SourceEditor';
import { CoverBanner, CoverPicker } from './Cover';
import { DailyNav, MadeThisDay } from './DailyNav';
import { Emoji } from './Emoji';
import { LockedPage } from './EncryptDialog';
import { PageProperties } from './PageProperties';
import { PageTags } from './TagsView';
import { deleteForever, restorePage, trashPage } from '../operations';
import { usePreferences } from '../platform/preferences';
import { navigate, openPage, routeHash } from '../router';
import { openSide } from '../tabs';
import { getUi, openDialog, setUi, useUi } from '../ui';
import { getSession, run, useWorkspace } from '../workspace';
import type { MenuEntry } from './Menu';
import { pageMenuEntries } from './pageMenu';
import { relativeTime, useShowMore } from './primitives';
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

// enter in the title starts a new line at the top of the page, taking any title text after the cursor
function openFirstLine(editor: Editor, text: string) {
  if (editor.isDestroyed) return;
  const { state, view } = editor;
  const first = state.doc.firstChild;
  if (!text && first?.type.name === 'paragraph' && first.content.size === 0) return focusStart(editor);
  const paragraph = state.schema.nodes.paragraph!.create(null, text ? state.schema.text(text) : null);
  const tr = state.tr.insert(0, paragraph);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1)).scrollIntoView());
  view.focus();
}

export function PageView({ id, find, anchor }: { id: PageId; find: string | null; anchor?: string | null }) {
  const state = useWorkspace();
  const page = state.pages[id];
  const [editing, setEditing] = useState(false);
  const [coverPicker, setCoverPicker] = useState<HTMLElement | null>(null);
  // the page whose header asked for a first property, so the request does not follow to another page
  const [addingFor, setAddingFor] = useState<PageId | null>(null);
  // a database with text of its own keeps showing it above its views, even once that text is cleared
  const [databaseTextFor, setDatabaseTextFor] = useState<PageId | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<Editor | null>(null);
  // enter in the title can arrive before the editor exists, focus it once it does
  const focusWhenReady = useRef(false);
  const prefs = usePreferences();
  const ui = useUi();

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
  const isTemplate = page.parentId !== null && page.parentId === findTemplatesPage(state)?.id;
  const doc = state.docs[id] ?? EMPTY_DOC;

  const menu = (): MenuEntry[] => {
    const words = docToPlainText(doc).split(/\s+/).filter(Boolean).length;
    const info: MenuEntry = {
      heading: `${words.toLocaleString()} word${words === 1 ? '' : 's'} · created ${relativeTime(page.createdAt)}`,
    };
    if (trashed) return [info];
    return [info, ...pageMenuEntries(id, () => titleRef.current?.focus())];
  };

  const hasText = page.kind === 'database' && !isDocEmpty(doc);
  if (hasText && databaseTextFor !== id) setDatabaseTextFor(id);
  const showText = page.kind !== 'database' || hasText || databaseTextFor === id;

  const database = findDatabaseOf(state, page);
  // rows and pages that already show properties add more from that list instead
  const canAddProperty =
    page.kind === 'page' &&
    !database &&
    !unreadable &&
    Object.keys(page.extra).length === 0 &&
    addingFor !== id;

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
          {!trashed && <ConflictBanner id={id} />}
          {page.icon && (
            <div className="page-icon-row">
              <button
                type="button"
                className="page-icon"
                aria-label="Change icon"
                disabled={trashed}
                onClick={() => openDialog({ kind: 'icon', pageId: id })}
              >
                <Emoji emoji={page.icon} />
              </button>
            </div>
          )}
          {!trashed && (!page.icon || !page.cover || canAddProperty) && (
            <div className="page-header-actions">
              {!page.icon && (
                <button
                  type="button"
                  className="add-icon"
                  onClick={() => openDialog({ kind: 'icon', pageId: id })}
                >
                  <Smile size={14} /> Add icon
                </button>
              )}
              {!page.cover && (
                <button
                  type="button"
                  className="add-icon"
                  onClick={(event) => setCoverPicker(event.currentTarget)}
                >
                  <ImageIcon size={14} /> Add cover
                </button>
              )}
              {canAddProperty && (
                <button type="button" className="add-icon" onClick={() => setAddingFor(id)}>
                  <ListPlus size={14} /> Add property
                </button>
              )}
            </div>
          )}
          {coverPicker && (
            <CoverPicker page={page} anchor={coverPicker} onClose={() => setCoverPicker(null)} />
          )}
          {page.dailyDate && <DailyNav page={page} />}
          <h1 className="page-title-heading">
            <TitleField
              page={page}
              readOnly={trashed}
              inputRef={titleRef}
              onEnter={(rest) => {
                const editor = editorRef.current;
                if (!editor) focusWhenReady.current = true;
                else if (rest === null || !editor.isEditable) focusStart(editor);
                else openFirstLine(editor, rest);
              }}
            />
          </h1>
          {page.kind !== 'database' && <PageTags page={page} editable={!trashed && !unreadable} />}
          {isTemplate && <RepeatBar page={page} editable={!trashed && !unreadable} />}
          {!unreadable && (
            <PageProperties
              page={page}
              database={database?.database ? { id: database.id, database: database.database } : null}
              editable={!trashed}
              adding={addingFor === id}
              onAdded={() => setAddingFor(null)}
            />
          )}
          {unreadable && page.encrypted ? (
            <LockedPage page={page} />
          ) : unreadable ? (
            <div className="banner is-error" role="alert">
              The content of this page could not be read. It has been left untouched in storage and is
              protected from changes. Saving a backup will not include it.
            </div>
          ) : ui.sourceMode === id && page.kind === 'page' ? (
            <>
              <div className="banner source-banner" role="note">
                <span>You are editing this page as Markdown.</span>
                <button type="button" className="button small" onClick={() => setUi({ sourceMode: null })}>
                  Back to the editor
                </button>
              </div>
              <SourceEditor pageId={id} doc={doc} editable={!trashed} />
            </>
          ) : (
            showText && (
              <PageBody
                id={id}
                doc={doc}
                editable={!trashed}
                find={find}
                anchor={anchor ?? null}
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
            )
          )}
          {page.kind === 'database' && (
            <Suspense fallback={<div className="database" aria-busy="true" />}>
              <DatabaseView page={page} editable={!trashed && !unreadable} />
            </Suspense>
          )}
          {page.kind !== 'database' && <Subpages parentId={id} />}
          {page.dailyDate && <MadeThisDay dailyDate={page.dailyDate} />}
          <Backlinks id={id} />
        </article>
      </div>
    </div>
  );
}

// a copy a sync app kept because this page changed on two computers at once, next to the page it copies
function ConflictBanner({ id }: { id: PageId }) {
  const state = useWorkspace();
  const session = getSession();
  const path = session.pathOf(id);
  const conflict = path ? conflictOriginal(path) : null;
  if (!conflict) return null;
  const wanted = conflict.original.toLowerCase();
  const original = Object.keys(state.pages).find(
    (other) => other !== id && session.pathOf(other)?.toLowerCase() === wanted,
  );
  const title = original ? displayTitle(state.pages[original]) : basename(stripExtension(conflict.original));
  return (
    <div className="banner conflict-banner" role="note">
      <span>
        This is a copy {conflict.app} kept because “{title}” changed on two computers at the same time.
        Compare them, keep what you need in “{title}”, then move this copy to the trash.
      </span>
      {original && (
        <button
          type="button"
          className="button small"
          onClick={() => openSide(routeHash({ name: 'page', id: original, find: null }))}
        >
          <Columns2 size={14} /> Compare side by side
        </button>
      )}
      <button type="button" className="button small" onClick={() => trashPage(id)}>
        <Trash2 size={14} /> Move copy to trash
      </button>
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
  anchor: string | null;
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
      anchor={props.anchor}
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
  // the title text after the cursor when enter was pressed, null when the cursor only moves down
  onEnter: (rest: string | null) => void;
}) {
  const ui = useUi();

  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  });

  // a narrower side of a split wraps the title onto more lines, so it is measured again
  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      element.style.height = '0px';
      element.style.height = `${element.scrollHeight}px`;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [inputRef]);

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
        if (event.key === 'ArrowDown' && atEnd) {
          event.preventDefault();
          onEnter(null);
        } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (readOnly) return onEnter(null);
          const rest = target.value.slice(target.selectionEnd).trim();
          if (rest)
            run({
              type: 'page.rename',
              id: page.id,
              title: target.value.slice(0, target.selectionStart).trimEnd(),
              now: Date.now(),
            });
          onEnter(rest);
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
  const linked = useShowMore(backlinks, 30);
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
          {linked.shown.map(({ source, contexts }) => (
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
        {linked.more}
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

// the room a view needs before the outline fits beside the page
const OUTLINE_ROOM = 1090;

// a list of the page's headings beside long pages, click one to jump to it. it starts below the cover,
// marks the section being read, and a heading with smaller ones under it can fold them away
function Outline({ doc }: { doc: DocNode }) {
  const headings = useMemo(() => headingsOf(doc), [doc]);
  const ref = useRef<HTMLElement>(null);
  const [roomy, setRoomy] = useState(false);
  const [active, setActive] = useState(-1);
  const [top, setTop] = useState<number | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<number>>(new Set());
  const enough = headings.length >= 3;
  const elements = () =>
    ref.current
      ?.closest('.view')
      ?.querySelectorAll<HTMLElement>('.editor-surface .prose > :is(h1, h2, h3, h4, h5, h6)') ?? [];
  // measured on the view it sits in, so a narrow side of a split hides it
  useEffect(() => {
    const view = ref.current?.closest('.view');
    if (!view) return;
    const observer = new ResizeObserver(([entry]) =>
      setRoomy((entry?.contentRect.width ?? 0) >= OUTLINE_ROOM),
    );
    observer.observe(view);
    return () => observer.disconnect();
  }, [enough]);
  useEffect(() => {
    const view = ref.current?.closest('.view');
    const scroller = view?.querySelector('.page-scroll');
    if (!view || !scroller || !enough) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const viewTop = view.getBoundingClientRect().top;
      const cover = view.querySelector('.page-cover');
      const below = cover ? cover.getBoundingClientRect().bottom - viewTop + 24 : 0;
      setTop(below > 64 ? below : null);
      let current = -1;
      elements().forEach((element, index) => {
        if (element.getBoundingClientRect().top - viewTop < 120) current = index;
      });
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', schedule, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enough, doc]);
  if (!enough) return null;
  const jump = (index: number) => elements()[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // a heading owns the smaller headings after it, up to the next one of its size or bigger
  const hasChildren = (index: number) => (headings[index + 1]?.level ?? 0) > headings[index]!.level;
  const hidden = new Set<number>();
  for (const index of folded) {
    for (
      let next = index + 1;
      next < headings.length && headings[next]!.level > headings[index]!.level;
      next++
    )
      hidden.add(next);
  }
  // a section folded away shows as reading the heading it is folded under
  let marked = active;
  while (marked > 0 && hidden.has(marked)) marked--;
  const toggle = (index: number) =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  return (
    <nav
      ref={ref}
      className={`page-outline${roomy ? ' is-roomy' : ''}`}
      style={top === null ? undefined : { top, maxHeight: `calc(100% - ${top + 46}px)` }}
      aria-label="Outline"
    >
      <p className="page-outline-title">On this page</p>
      <ul>
        {headings.map((heading, index) =>
          hidden.has(index) ? null : (
            <li
              key={index}
              className={index === marked ? 'is-active' : undefined}
              style={{ '--level': heading.level } as React.CSSProperties}
            >
              {hasChildren(index) && (
                <button
                  type="button"
                  className="outline-fold"
                  aria-expanded={!folded.has(index)}
                  aria-label={folded.has(index) ? 'Expand' : 'Collapse'}
                  onClick={() => toggle(index)}
                >
                  <ChevronRight size={12} />
                </button>
              )}
              <button type="button" className="outline-link" onClick={() => jump(index)}>
                {heading.text}
              </button>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
