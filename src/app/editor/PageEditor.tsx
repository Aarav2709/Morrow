import { Editor, Extension } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { Node as ProseNode, Slice } from '@tiptap/pm/model';
import { EditorContent } from '@tiptap/react';
import katex from 'katex';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { docToMarkdown } from '../../core/markdown/serialize';
import { docToHtml } from '../../core/site';
import { displayTitle } from '../../core/model';
import type { DocNode, PageId } from '../../core/model';
import { findPagesByTitle, foldText, pageIdByTitle, resolveLinkTarget } from '../../core/search';
import { ancestorsOf, isEffectivelyTrashed } from '../../core/tree';
import { createPage, openToday } from '../operations';
import { navigate, openPage } from '../router';
import { targetPane, usePane } from '../tabs';
import { getSession, getState, run } from '../workspace';
import type { BlockMenuRequest } from './BlockHandle';
import { registerCommit, setFocusedEditor } from './commits';
import { BlockMenu, FormattingMenu, LinkMenu, openHref, TableMenu } from './EditorMenus';
import { FindBar } from './FindBar';
import { createExtensions } from './extensions';
import { anchorSlice, isBlockAnchor } from '../../core/anchors';

interface Props {
  pageId: PageId;
  doc: DocNode;
  editable: boolean;
  find: string | null;
  // a heading or ^block id to scroll to once the page opens
  anchor?: string | null;
  // leaves the page's text for its title, with any text the first line hands up to it
  onExitTop: (text?: string) => void;
  onDirty: (dirty: boolean) => void;
  onReady?: (editor: Editor) => void;
}

const COMMIT_DELAY_MS = 250;

const EmbeddedDatabase = lazy(() =>
  import('../components/database/EmbeddedDatabase').then((module) => ({ default: module.EmbeddedDatabase })),
);

const EmbeddedCanvas = lazy(() =>
  import('../components/EmbeddedCanvas').then((module) => ({ default: module.EmbeddedCanvas })),
);

// databases and canvases embed as the real thing, a database with its views, a canvas you can draw on
function mountEmbed(
  id: PageId,
  hostId: PageId,
  element: HTMLElement,
  editable: boolean,
): (() => void) | null {
  const state = getState();
  const page = state.pages[id];
  if (!page || id === hostId) return null;
  const canvas = page.kind === 'canvas' && !page.encrypted && !isEffectivelyTrashed(state.pages, id);
  if (!page.database && !canvas) return null;
  // react gets a box of its own inside the embed, so when the embed is emptied before the deferred unmount
  // below runs, react still finds its nodes where it left them
  const host = document.createElement('div');
  host.style.display = 'contents';
  element.append(host);
  const root = createRoot(host);
  root.render(
    <Suspense fallback={null}>
      {page.database ? (
        <EmbeddedDatabase pageId={id} editable={editable} />
      ) : (
        <EmbeddedCanvas pageId={id} editable={editable} />
      )}
    </Suspense>,
  );
  // react cannot unmount a root in the middle of rendering another one
  return () => setTimeout(() => root.unmount());
}

// the html of a page shown inside another, never the page itself so embeds cannot loop. with an anchor
// only that heading's section or that block is shown
const embedCache = new WeakMap<object, Map<string, string>>();
function embedHtml(id: PageId, hostId: PageId, anchor: string | null): string | null {
  const state = getState();
  const page = state.pages[id];
  const whole = state.docs[id];
  if (!page || !whole || id === hostId || page.encrypted || isEffectivelyTrashed(state.pages, id))
    return null;
  const byAnchor = embedCache.get(whole) ?? new Map<string, string>();
  embedCache.set(whole, byAnchor);
  const cached = byAnchor.get(anchor ?? '');
  if (cached !== undefined) return cached;
  const doc = anchor ? anchorSlice(whole, anchor) : whole;
  if (!doc) return null;
  const html = docToHtml(doc, {
    href: (target) => (state.pages[target] ? `#/page/${target}` : null),
    assetPath: (fileId) => getSession().fileUrl(fileId) ?? '',
    titleOf: (target) => (state.pages[target] ? displayTitle(state.pages[target]) : null),
    renderMath: (latex, display) =>
      katex.renderToString(latex, { throwOnError: false, displayMode: display }),
  });
  byAnchor.set(anchor ?? '', html);
  return html;
}

// the editor adds an empty line after a list or table that ends a page, so there is somewhere to type.
// that line is never saved, so on its own it is not an edit
function withoutTrailingEmpty(doc: ProseNode): ProseNode {
  let count = doc.childCount;
  while (
    count > 0 &&
    doc.child(count - 1).type.name === 'paragraph' &&
    doc.child(count - 1).content.size === 0
  )
    count--;
  if (count === doc.childCount) return doc;
  const children: ProseNode[] = [];
  for (let i = 0; i < count; i++) children.push(doc.child(i));
  return doc.copy(Fragment.from(children));
}

function sameContent(editor: Editor, saved: DocNode): boolean {
  try {
    return withoutTrailingEmpty(editor.schema.nodeFromJSON(saved)).eq(withoutTrailingEmpty(editor.state.doc));
  } catch {
    return false;
  }
}

// what other apps get as plain text. words from inside one block copy as they read, more than one block
// copies as markdown, so a list pastes as a list rather than lines with gaps between them
function plainTextOf(slice: Slice): string {
  let node: ProseNode | Fragment = slice.content;
  while (node.childCount === 1 && !node.firstChild!.isTextblock) node = node.firstChild!;
  if (node.childCount === 1 && node.firstChild!.isTextblock) return node.firstChild!.textContent;
  const state = getState();
  return docToMarkdown(
    { type: 'doc', content: (slice.content.toJSON() ?? []) as DocNode[] },
    {
      titleOf: (id) => (state.pages[id] ? displayTitle(state.pages[id]) : null),
      filePath: (fileId) => fileId,
    },
  ).trimEnd();
}

// keeps one editor instance per page and writes changes back through commands
export function PageEditor({ pageId, doc, editable, find, anchor, onExitTop, onDirty, onReady }: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [blockMenu, setBlockMenu] = useState<BlockMenuRequest | null>(null);
  // the find bar opens with the words picked on the page, n changes so pressing it again refills it
  const [finding, setFinding] = useState<{ text: string; n: number } | null>(null);
  const pane = usePane();
  const committed = useRef<DocNode>(doc);
  const callbacks = useRef({ onExitTop, onDirty, onReady });
  useEffect(() => {
    callbacks.current = { onExitTop, onDirty, onReady };
  });

  useEffect(() => {
    let dirty = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const commit = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!dirty || instance.isDestroyed) return;
      dirty = false;
      callbacks.current.onDirty(false);
      if (sameContent(instance, committed.current)) return;
      const next = instance.getJSON() as DocNode;
      committed.current = next;
      run({ type: 'page.setDoc', id: pageId, doc: next, now: Date.now() });
    };

    const shortcuts = Extension.create({
      name: 'morrowShortcuts',
      addKeyboardShortcuts() {
        return {
          'Mod-k': ({ editor: current }) => {
            if (current.state.selection.empty) return false;
            current.view.dom.dispatchEvent(new Event('morrow:edit-link'));
            return true;
          },
          'Mod-f': () => {
            window.dispatchEvent(new Event('morrow:find'));
            return true;
          },
          // the first press selects the line being written, the next one the whole page
          'Mod-a': ({ editor: current }) => {
            const { selection, doc, tr } = current.state;
            const { $from, $to } = selection;
            if (!$from.parent.isTextblock || !$from.sameParent($to) || $from.parent.content.size === 0)
              return false;
            const start = $from.start();
            const end = $from.end();
            if (selection.from === start && selection.to === end) return false;
            current.view.dispatch(tr.setSelection(TextSelection.create(doc, start, end)));
            return true;
          },
          'Mod-s': () => {
            commit();
            void getSession().flush();
            return true;
          },
          // backspace at the start of the first line goes back up into the title, the way enter there
          // came down. the line goes with it, its words joining the end of the title
          Backspace: ({ editor: current }) => {
            const { selection, doc, tr } = current.state;
            const first = doc.firstChild;
            if (!selection.empty || selection.from !== 1 || first?.type.name !== 'paragraph') return false;
            let plain = true;
            first.forEach((child) => {
              if (!child.isText) plain = false;
            });
            if (!plain) {
              callbacks.current.onExitTop();
              return true;
            }
            current.view.dispatch(tr.delete(0, first.nodeSize));
            callbacks.current.onExitTop(first.textContent);
            return true;
          },
          ArrowUp: ({ editor: current }) => {
            const { selection } = current.state;
            if (!selection.empty || selection.from > 1) return false;
            callbacks.current.onExitTop();
            return true;
          },
        };
      },
    });

    const titleOf = (id: PageId) => {
      const pages = getState().pages;
      return pages[id] && !isEffectivelyTrashed(pages, id) ? displayTitle(pages[id]) : null;
    };

    const instance = new Editor({
      extensions: [
        ...createExtensions({
          getTitle: titleOf,
          getIcon: (id) => getState().pages[id]?.icon ?? null,
          subscribe: (listener) => getSession().subscribe(listener),
          open: (id, target) => openPage(id, null, target),
          findPages: (query) =>
            findPagesByTitle(getState(), query, 8)
              .filter((page) => page.id !== pageId)
              .map((page) => ({
                id: page.id,
                title: displayTitle(page),
                path: ancestorsOf(getState().pages, page.id)
                  .reverse()
                  .map((ancestor) => displayTitle(ancestor))
                  .join(' / '),
              })),
          createPage: (title) => createPage({ parentId: pageId, title, open: false }),
          resolveTarget: (target) => resolveLinkTarget(getState(), target),
          // obsidian makes a missing linked page at the top of the vault, so does morrow
          createFromTarget: (target) => createPage({ title: target.split('/').pop() || target, open: false }),
          openTag: (tag) => navigate({ name: 'tag', tag }),
          renderEmbed: (id, target) => embedHtml(id, pageId, target),
          mountEmbed: (id, element, canEdit) => mountEmbed(id, pageId, element, canEdit),
          createChild: (kind) => createPage({ parentId: pageId, kind, open: false }),
          openDate: (date) => openToday(date),
          onBlockMenu: setBlockMenu,
          resolvePage: (title) => pageIdByTitle(getState(), title),
        }),
        shortcuts,
      ],
      content: doc as JSONContent,
      editable,
      editorProps: {
        attributes: { class: 'prose', 'aria-label': 'Page content' },
        clipboardTextSerializer: (slice) => plainTextOf(slice),
        handleDOMEvents: {
          // right click on a picture shows the same options as its handle, with copy and open
          contextmenu: (view, event) => {
            if (!(event.target instanceof Element) || !event.target.closest('.image-block')) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const node = at && at.inside >= 0 ? view.state.doc.nodeAt(at.inside) : null;
            if (!at || node?.type.name !== 'image') return false;
            event.preventDefault();
            setBlockMenu({
              pos: at.inside,
              rect: new DOMRect(event.clientX, event.clientY, 0, 0),
            });
            return true;
          },
        },
        handleClickOn: (_view, _pos, node, _nodePos, event) => {
          // ctrl or cmd click follows links like a browser would
          const href = node.marks?.find((mark) => mark.type.name === 'link')?.attrs.href;
          if (href && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            openHref(String(href));
            return true;
          }
          return false;
        },
      },
      // only real edits count, tiptap also reports an update when nothing in the page changed
      onUpdate: ({ transaction, appendedTransactions }) => {
        if (!transaction.docChanged && !appendedTransactions.some((tr) => tr.docChanged)) return;
        if (!dirty) callbacks.current.onDirty(true);
        dirty = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(commit, COMMIT_DELAY_MS);
      },
    });

    instance.on('focus', () => setFocusedEditor(instance));
    const unregister = registerCommit(commit);
    setEditor(instance);
    callbacks.current.onReady?.(instance);

    return () => {
      commit();
      unregister();
      setFocusedEditor(null);
      setEditor(null);
      setBlockMenu(null);
      // menus unregister their plugins during the same unmount, destroy once they are done
      setTimeout(() => instance.destroy(), 0);
    };
    // the editor is rebuilt only when the page changes, later doc updates are synced below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  // content changed outside this editor, for example a task ticked in the tasks view
  useEffect(() => {
    if (!editor || editor.isDestroyed || doc === committed.current) return;
    committed.current = doc;
    editor.commands.setContent(doc as JSONContent, { emitUpdate: false });
  }, [doc, editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable, false);
  }, [editor, editable]);

  // opens with the search match selected and in view
  useEffect(() => {
    if (!editor || !find) return;
    const term = find.toLowerCase();
    let found: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (!node.isTextblock) return true;
      const text = node.textBetween(0, node.content.size, undefined, '￼').toLowerCase();
      const index = text.indexOf(term);
      if (index !== -1) found = { from: pos + 1 + index, to: pos + 1 + index + term.length };
      return false;
    });
    const match = found as { from: number; to: number } | null;
    if (match) {
      editor.chain().focus().setTextSelection(match).scrollIntoView().run();
    }
    navigate({ name: 'page', id: pageId, find: null }, { replace: true, pane });
  }, [editor, find, pageId, pane]);

  // opens at the heading or block a link pointed at, briefly lit so the eye finds it
  useEffect(() => {
    if (!editor || !anchor) return;
    let target: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (target !== null) return false;
      const hit = isBlockAnchor(anchor)
        ? node.attrs.blockId === anchor.slice(1)
        : node.type.name === 'heading' && foldText(node.textContent.trim()) === foldText(anchor.trim());
      if (hit) target = pos;
      return !hit;
    });
    const dom = target === null ? null : editor.view.nodeDOM(target);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ block: 'center' });
      // an animation, not a class, so the editor never sees its own content change
      const glow = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim();
      dom.animate([{ backgroundColor: glow }, { backgroundColor: 'transparent' }], {
        duration: 1800,
        easing: 'ease-out',
      });
    }
    navigate({ name: 'page', id: pageId, find: null }, { replace: true, pane });
  }, [editor, anchor, pageId, pane]);

  // ctrl or cmd f from anywhere on the page opens the find bar, in the side of a split being used
  useEffect(() => {
    const open = () => {
      if (pane !== targetPane() || !editor || editor.isDestroyed) return;
      const { from, to, empty } = editor.state.selection;
      const picked = empty ? '' : editor.state.doc.textBetween(from, to, '\n');
      // a picked word or line, never a run of blocks
      const text = picked.includes('\n') ? '' : picked.slice(0, 200);
      setFinding((last) => ({ text, n: (last?.n ?? 0) + 1 }));
    };
    window.addEventListener('morrow:find', open);
    return () => window.removeEventListener('morrow:find', open);
  }, [pane, editor]);

  if (!editor) return <div className="editor-loading" aria-hidden="true" />;

  // the find bar sits in the view's top corner, under the top bar and clear of the page's text
  const findHost = finding ? (editor.view.dom.closest('.view') as HTMLElement | null) : null;
  return (
    <div className="editor-host">
      {finding &&
        findHost &&
        createPortal(<FindBar editor={editor} seed={finding} onClose={() => setFinding(null)} />, findHost)}
      <EditorContent editor={editor} className="editor-surface" />
      {editable && (
        <>
          <FormattingMenu editor={editor} />
          <LinkMenu editor={editor} />
          <TableMenu editor={editor} />
        </>
      )}
      {blockMenu && (
        <BlockMenu
          editor={editor}
          request={blockMenu}
          pageTitle={displayTitle(getState().pages[pageId])}
          onClose={() => setBlockMenu(null)}
        />
      )}
    </div>
  );
}
