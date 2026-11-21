import { EditorContent, useEditor } from '@tiptap/react';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { anchorSlice, isBlockAnchor, replaceAnchorSlice } from '../../core/anchors';
import { inlineText } from '../../core/doc';
import { displayTitle } from '../../core/model';
import type { DocNode, PageId } from '../../core/model';
import { findPagesByTitle, pageIdByTitle, resolveLinkTarget } from '../../core/search';
import { t } from '../i18n';
import { createPage, openToday } from '../operations';
import { navigate, openPage } from '../router';
import { getSession, getState, run } from '../workspace';
import { createExtensions } from './extensions';

const SAVE_AFTER_MS = 400;

// a block or a heading's section of another page, edited right where it is shown. what is typed is written
// into that page, so every page showing the same block shows the change, the way notion's synced blocks do
export function SyncedBlock({
  sourceId,
  anchor,
  setAnchor,
}: {
  sourceId: PageId;
  anchor: string;
  setAnchor: (anchor: string | null) => void;
}) {
  const anchorRef = useRef(anchor);
  // the anchor can change when its heading is renamed, the latest one is read when saving
  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);
  const writing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: createExtensions({
      getTitle: (id) => (getState().pages[id] ? displayTitle(getState().pages[id]) : null),
      getIcon: (id) => getState().pages[id]?.icon ?? null,
      subscribe: (listener) => getSession().subscribe(listener),
      open: (id, target) => openPage(id, null, target),
      findPages: (query) =>
        findPagesByTitle(getState(), query, 8).map((page) => ({
          id: page.id,
          title: displayTitle(page),
          path: '',
        })),
      createPage: (title) => createPage({ parentId: sourceId, title, open: false }),
      resolveTarget: (target) => resolveLinkTarget(getState(), target),
      createFromTarget: (target) => createPage({ title: target.split('/').pop() || target, open: false }),
      openTag: (tag) => navigate({ name: 'tag', tag }),
      // a synced block never shows other pages inside itself, so embeds can't go round in a loop
      renderEmbed: () => null,
      createChild: () => null,
      openDate: (date) => openToday(date),
      onBlockMenu: () => {},
      resolvePage: (title) => pageIdByTitle(getState(), title),
    }),
    content: anchorSlice(getState().docs[sourceId] ?? { type: 'doc' }, anchor) ?? {
      type: 'doc',
      content: [],
    },
    editorProps: { attributes: { class: 'prose synced-block-body', 'aria-label': t('editor.synced.label') } },
    onUpdate: ({ editor: current }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => save((current.getJSON().content ?? []) as DocNode[]), SAVE_AFTER_MS);
    },
  });

  const save = (blocks: DocNode[]) => {
    const source = getState().docs[sourceId];
    if (!source) return;
    const next = replaceAnchorSlice(source, anchorRef.current, blocks);
    if (!next) return;
    writing.current = true;
    run({ type: 'page.setDoc', id: sourceId, doc: next, now: Date.now() });
    writing.current = false;
    // a heading renamed here is still the part shown, the link follows its new name
    if (!isBlockAnchor(anchorRef.current)) {
      const heading = blocks[0];
      const name = heading?.type === 'heading' ? inlineText(heading).trim() : '';
      if (name && name !== anchorRef.current) setAnchor(name);
    }
  };

  // changes made to the block elsewhere show here, unless this is where it is being typed in
  useEffect(() => {
    if (!editor) return;
    return getSession().subscribe(() => {
      if (writing.current || editor.isDestroyed || editor.isFocused) return;
      const slice = anchorSlice(getState().docs[sourceId] ?? { type: 'doc' }, anchorRef.current);
      if (!slice) return;
      if (JSON.stringify(slice.content ?? []) !== JSON.stringify(editor.getJSON().content ?? []))
        editor.commands.setContent(slice, { emitUpdate: false });
    });
  }, [editor, sourceId]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div className="synced-block" title={t('editor.synced.hint')}>
      <span className="synced-block-mark" aria-hidden="true">
        <RefreshCw size={11} /> {t('editor.synced.label')}
      </span>
      <EditorContent editor={editor} />
    </div>
  );
}
