import { Editor, Extension } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { DocNode, PageId } from '../../core/model';
import { findPagesByTitle, pageIdByTitle } from '../../core/search';
import { ancestorsOf, isEffectivelyTrashed } from '../../core/tree';
import { createPage } from '../operations';
import { navigate, openPage } from '../router';
import { getSession, getState, run } from '../workspace';
import type { BlockMenuRequest } from './BlockHandle';
import { registerCommit, setFocusedEditor } from './commits';
import { BlockMenu, FormattingMenu, LinkMenu, openHref, TableMenu } from './EditorMenus';
import { FindBar } from './FindBar';
import { createExtensions } from './extensions';

interface Props {
  pageId: PageId;
  doc: DocNode;
  editable: boolean;
  find: string | null;
  onExitTop: () => void;
  onDirty: (dirty: boolean) => void;
  onReady?: (editor: Editor) => void;
}

const COMMIT_DELAY_MS = 250;

// keeps one editor instance per page and writes changes back through commands
export function PageEditor({ pageId, doc, editable, find, onExitTop, onDirty, onReady }: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [blockMenu, setBlockMenu] = useState<BlockMenuRequest | null>(null);
  const [finding, setFinding] = useState(false);
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
          'Mod-s': () => {
            commit();
            void getSession().flush();
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
          subscribe: (listener) => getSession().subscribe(listener),
          open: (id) => openPage(id),
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
          onBlockMenu: setBlockMenu,
          resolvePage: (title) => pageIdByTitle(getState(), title),
        }),
        shortcuts,
      ],
      content: doc as JSONContent,
      editable,
      editorProps: {
        attributes: { class: 'prose', 'aria-label': 'Page content', spellcheck: 'true' },
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
      onUpdate: () => {
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
    if (editor && !editor.isDestroyed) editor.setEditable(editable);
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
    navigate({ name: 'page', id: pageId, find: null }, { replace: true });
  }, [editor, find, pageId]);

  // ctrl or cmd f from anywhere on the page opens the find bar
  useEffect(() => {
    const open = () => setFinding(true);
    window.addEventListener('morrow:find', open);
    return () => window.removeEventListener('morrow:find', open);
  }, []);

  if (!editor) return <div className="editor-loading" aria-hidden="true" />;

  return (
    <div className="editor-host">
      {finding && <FindBar editor={editor} onClose={() => setFinding(false)} />}
      <EditorContent editor={editor} className="editor-surface" />
      {editable && (
        <>
          <FormattingMenu editor={editor} />
          <LinkMenu editor={editor} />
          <TableMenu editor={editor} />
        </>
      )}
      {blockMenu && <BlockMenu editor={editor} request={blockMenu} onClose={() => setBlockMenu(null)} />}
    </div>
  );
}
