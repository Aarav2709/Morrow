import { useMemo, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageId } from '../../core/model';
import { foldText } from '../../core/search';
import { ancestorsOf, childrenOf, flattenTree, isDescendantOf } from '../../core/tree';
import { ACTIONS, formatShortcut } from '../actions';
import { expandPage, movePage } from '../operations';
import { closeDialog, useUi } from '../ui';
import { run, useWorkspace } from '../workspace';
import { CaptureDialog } from './CaptureDialog';
import { EmojiPicker } from './EmojiPicker';
import { EncryptDialog } from './EncryptDialog';
import { HistoryDialog } from './HistoryDialog';
import { MathDialog } from './MathDialog';
import { Dialog } from './primitives';
import { SettingsDialog } from './Settings';
import { useTranslation } from '../i18n';
import { SourceDialog } from './SourceDialog';
import { PairDialog } from './SyncSettings';
import { TemplateDialog } from './TemplateDialog';

export function Dialogs() {
  const { t } = useTranslation();
  const { dialog } = useUi();
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'settings':
      return <SettingsDialog section={dialog.section} />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'move':
      return <MoveDialog pageId={dialog.pageId} />;
    case 'history':
      return <HistoryDialog pageId={dialog.pageId} />;
    case 'icon':
      return (
        <EmojiPicker
          pageId={dialog.pageId}
          onPick={(icon) => run({ type: 'page.setIcon', id: dialog.pageId, icon, now: Date.now() })}
        />
      );
    case 'source':
      return (
        <SourceDialog
          title={dialog.title}
          value={dialog.value}
          language={dialog.language}
          displayMode={dialog.displayMode ?? false}
          onSave={dialog.onSave}
        />
      );
    case 'math':
      return (
        <MathDialog
          value={dialog.value}
          block={dialog.block}
          onSave={dialog.onSave}
          onCancel={dialog.onCancel}
        />
      );
    case 'template':
      return <TemplateDialog parentId={dialog.parentId} />;
    case 'encrypt':
      return <EncryptDialog pageId={dialog.pageId} />;
    case 'pair':
      return <PairDialog />;
    case 'capture':
      return <CaptureDialog />;
    case 'confirm':
      return (
        <Dialog
          title={dialog.title}
          size="small"
          onClose={closeDialog}
          footer={
            <>
              <button type="button" className="button" onClick={closeDialog}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={`button ${dialog.danger ? 'danger-solid' : 'primary'}`}
                data-autofocus
                onClick={() => {
                  closeDialog();
                  dialog.onConfirm();
                }}
              >
                {dialog.confirmLabel}
              </button>
            </>
          }
        >
          <p>{dialog.body}</p>
        </Dialog>
      );
  }
}

function ShortcutsDialog() {
  const { t, tAction } = useTranslation();
  const editing: Array<[string, string]> = [
    ['Bold, italic, underline', 'Mod+B  Mod+I  Mod+U'],
    ['Strikethrough', 'Mod+Shift+S'],
    ['Inline code', 'Mod+E'],
    ['Link selected text', 'Mod+K'],
    ['Headings', 'Mod+Alt+1  2  3'],
    ['Insert a block', '/'],
    ['Link to a page', '[['],
    ['Move block up or down', 'Alt+Shift+↑  ↓'],
    ['Indent or outdent list item', 'Tab  Shift+Tab'],
    ['Undo and redo', 'Mod+Z  Mod+Shift+Z'],
    ['Save immediately', 'Mod+S'],
    ['Find and replace', 'Mod+F'],
    ['Add an image or file', 'paste or drop it'],
  ];
  const format = (keys: string) =>
    keys
      .split('  ')
      .map((part) => (part.includes('+') ? formatShortcut(part) : part))
      .join('  ');
  return (
    <Dialog title={t('dialogs.shortcuts.title')} onClose={closeDialog}>
      <div className="shortcut-columns">
        <section>
          <h3>{t('dialogs.shortcuts.everywhere')}</h3>
          <dl className="shortcut-list">
            {ACTIONS.filter((action) => action.shortcut).map((action) => (
              <div key={action.id}>
                <dt>{tAction(action.id, action.label)}</dt>
                <dd>
                  <kbd className="kbd">{formatShortcut(action.shortcut!)}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>{t('dialogs.shortcuts.writing')}</h3>
          <dl className="shortcut-list">
            {editing.map(([label, keys]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <kbd className="kbd">{format(keys)}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Dialog>
  );
}

function MoveDialog({ pageId }: { pageId: PageId }) {
  const { t } = useTranslation();
  const state = useWorkspace();
  const [query, setQuery] = useState('');
  const page = state.pages[pageId];
  const targets = useMemo(() => {
    const folded = foldText(query.trim());
    return flattenTree(state.pages).filter(({ page: candidate }) => {
      if (candidate.id === pageId || isDescendantOf(state.pages, candidate.id, pageId)) return false;
      return !folded || foldText(displayTitle(candidate)).includes(folded);
    });
  }, [state.pages, pageId, query]);

  if (!page) return null;
  const move = (parentId: PageId | null) => {
    if (movePage(pageId, parentId, childrenOf(state.pages, parentId).length)) {
      expandPage(parentId);
      closeDialog();
    }
  };

  return (
    <Dialog title={t('dialogs.move.titleParam', { title: displayTitle(page) })} onClose={closeDialog}>
      <input
        className="text-input"
        placeholder={t('dialogs.move.placeholder')}
        aria-label={t('dialogs.move.ariaDestination')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        data-autofocus
      />
      <ul className="move-list" role="listbox" aria-label={t('dialogs.move.ariaList')}>
        {!query && (
          <li>
            <button
              type="button"
              className="move-target"
              disabled={page.parentId === null}
              onClick={() => move(null)}
            >
              {t('dialogs.move.topLevel')}
            </button>
          </li>
        )}
        {targets.map(({ page: target, depth }) => (
          <li key={target.id}>
            <button
              type="button"
              className="move-target"
              style={{ paddingLeft: `${12 + (query ? 0 : depth * 16)}px` }}
              disabled={target.id === page.parentId}
              onClick={() => move(target.id)}
            >
              {displayTitle(target)}
              {query && (
                <span className="link-row-path">
                  {ancestorsOf(state.pages, target.id).reverse().map(displayTitle).join(' / ')}
                </span>
              )}
            </button>
          </li>
        ))}
        {targets.length === 0 && query && <li className="muted move-empty">{t('dialogs.move.noMatches')}</li>}
      </ul>
    </Dialog>
  );
}
