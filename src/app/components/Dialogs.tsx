import { Download, FileUp, FolderArchive, FolderOpen, HardDrive, Paperclip, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { displayTitle } from '../../core/model';
import type { PageId } from '../../core/model';
import { foldText } from '../../core/search';
import { ancestorsOf, childrenOf, flattenTree, isDescendantOf } from '../../core/tree';
import { ACTIONS, formatShortcut } from '../actions';
import {
  deleteUnusedFiles,
  exportAllMarkdown,
  exportBackup,
  expandPage,
  importMarkdown,
  restoreBackup,
  unusedFiles,
} from '../operations';
import { formatBytes } from '../platform/attachments';
import { desktop } from '../platform/desktop';
import { setPreferences, usePreferences } from '../platform/preferences';
import { ACCENT_LABELS, ACCENTS } from '../platform/preferences';
import type { PageWidth, ThemePreference, WritingFont } from '../platform/preferences';
import { copyLegacyInto, legacyPageCount } from '../legacy';
import { closeDialog, toast, useUi } from '../ui';
import { chooseVaultFolder } from '../vaults';
import { getSession, run, useWorkspace } from '../workspace';
import { HistoryDialog, IconDialog } from './HistoryDialog';
import { CaptureDialog } from './CaptureDialog';
import { EncryptDialog } from './EncryptDialog';
import { SourceDialog } from './SourceDialog';
import { PairDialog, SyncSection } from './SyncSettings';
import { TemplateDialog } from './TemplateDialog';
import { Dialog } from './primitives';

export function Dialogs() {
  const { dialog } = useUi();
  if (!dialog) return null;
  switch (dialog.kind) {
    case 'settings':
      return <SettingsDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'move':
      return <MoveDialog pageId={dialog.pageId} />;
    case 'history':
      return <HistoryDialog pageId={dialog.pageId} />;
    case 'icon':
      return (
        <IconDialog
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
                Cancel
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

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="setting-row">
      <span className="setting-label" id={`setting-${label}`}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={`setting-${label}`}>
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            className={value === option ? 'is-active' : ''}
            onClick={() => onChange(option)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsDialog() {
  const prefs = usePreferences();
  const [legacy, setLegacy] = useState(0);
  const vault = getSession().location;

  useEffect(() => {
    if (vault)
      void legacyPageCount()
        .then(setLegacy)
        .catch(() => setLegacy(0));
  }, [vault]);

  return (
    <Dialog title="Settings" size="large" onClose={closeDialog}>
      <section className="settings-section">
        <h3>Appearance</h3>
        <Choice<ThemePreference>
          label="Theme"
          value={prefs.theme}
          options={[
            ['system', 'System'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ]}
          onChange={(theme) => setPreferences({ theme })}
        />
        <Choice<WritingFont>
          label="Writing font"
          value={prefs.font}
          options={[
            ['serif', 'Serif'],
            ['sans', 'Sans'],
            ['mono', 'Mono'],
          ]}
          onChange={(font) => setPreferences({ font })}
        />
        <Choice<PageWidth>
          label="Page width"
          value={prefs.width}
          options={[
            ['comfortable', 'Comfortable'],
            ['wide', 'Wide'],
          ]}
          onChange={(width) => setPreferences({ width })}
        />
        <div className="setting-row">
          <span className="setting-label" id="setting-accent">
            Accent colour
          </span>
          <div className="accent-swatches" role="radiogroup" aria-labelledby="setting-accent">
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                role="radio"
                aria-checked={prefs.accent === accent}
                aria-label={ACCENT_LABELS[accent]}
                title={ACCENT_LABELS[accent]}
                className={`accent-swatch accent-${accent}`}
                onClick={() => setPreferences({ accent })}
              />
            ))}
          </div>
        </div>
        <label className="setting-row checkbox-row">
          <span className="setting-label">
            Colourful pages
            <span className="muted small"> Coloured headings, lists, icons and tags</span>
          </span>
          <input
            type="checkbox"
            checked={prefs.colorful}
            onChange={(event) => setPreferences({ colorful: event.target.checked })}
          />
        </label>
      </section>

      <section className="settings-section">
        <h3>Your data</h3>
        <p className="muted">
          Every page is a Markdown file in this folder. Open it in any app, sync it with any tool, or keep it
          under version control. Morrow never sends anything anywhere.
        </p>
        <div className="data-path">
          <HardDrive size={14} /> <code>{vault}</code>
          <button type="button" className="button small" onClick={() => void desktop?.vault?.reveal('')}>
            <FolderOpen size={14} /> Show
          </button>
          <button type="button" className="button small" onClick={() => void chooseVaultFolder()}>
            Open another
          </button>
        </div>
        {legacy > 0 && (
          <p className="muted small">
            {legacy} page{legacy === 1 ? '' : 's'} from an earlier version of Morrow are still in the app's
            own storage.{' '}
            <button
              type="button"
              className="link-button"
              onClick={() =>
                void copyLegacyInto(getSession()).then((result) => {
                  if (result.ok) {
                    toast(`Copied ${result.value} page${result.value === 1 ? '' : 's'} into this vault.`);
                    setLegacy(0);
                  } else toast(result.error, { tone: 'error' });
                })
              }
            >
              Copy them into this vault
            </button>
          </p>
        )}
        <div className="data-grid">
          <button type="button" className="data-action" onClick={() => void exportBackup()}>
            <Download size={18} strokeWidth={1.5} />
            <span>
              <strong>Save a backup</strong>
              <span className="muted">
                One file with every page, including the trash. Morrow can restore it.
              </span>
            </span>
          </button>
          <button type="button" className="data-action" onClick={() => void restoreBackup()}>
            <Upload size={18} strokeWidth={1.5} />
            <span>
              <strong>Restore a backup</strong>
              <span className="muted">
                Adds the pages from a backup. Existing pages are never overwritten.
              </span>
            </span>
          </button>
          <button type="button" className="data-action" onClick={() => void exportAllMarkdown()}>
            <FolderArchive size={18} strokeWidth={1.5} />
            <span>
              <strong>Export as Markdown</strong>
              <span className="muted">A zip of plain text files, readable by almost any app.</span>
            </span>
          </button>
          <button type="button" className="data-action" onClick={() => void importMarkdown()}>
            <FileUp size={18} strokeWidth={1.5} />
            <span>
              <strong>Import Markdown</strong>
              <span className="muted">Turn .md files into pages. Links like [[Page]] are connected.</span>
            </span>
          </button>
        </div>
      </section>

      <SyncSection />
      <AttachmentsSection />

      <section className="settings-section">
        <h3>About</h3>
        <p className="muted">
          Morrow {desktop?.version ?? __APP_VERSION__} is free and open source under the Apache License 2.0.
          It has no accounts, no tracking, no ads and no AI features, by design.
        </p>
      </section>
    </Dialog>
  );
}

function AttachmentsSection() {
  const [summary, setSummary] = useState<{ count: number; bytes: number; unused: number } | null>(null);
  const refresh = () => {
    void Promise.all([getSession().listFiles(), unusedFiles()]).then(([files, unused]) =>
      setSummary({
        count: files.length,
        bytes: files.reduce((sum, file) => sum + file.size, 0),
        unused: unused.length,
      }),
    );
  };
  useEffect(refresh, []);
  return (
    <section className="settings-section">
      <h3>Images and files</h3>
      <div className="setting-row">
        <span className="setting-label">
          <Paperclip size={14} />{' '}
          {summary
            ? `${summary.count} file${summary.count === 1 ? '' : 's'}, ${formatBytes(summary.bytes)}`
            : 'Counting…'}
        </span>
        <button
          type="button"
          className="button small"
          disabled={!summary?.unused}
          onClick={() => void deleteUnusedFiles().then(refresh)}
        >
          {summary?.unused ? `Remove ${summary.unused} unused` : 'No unused files'}
        </button>
      </div>
      <p className="muted small">
        Files stay while any page, trashed page or page version uses them. Backups include them.
      </p>
    </section>
  );
}

function ShortcutsDialog() {
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
    <Dialog title="Keyboard shortcuts" onClose={closeDialog}>
      <div className="shortcut-columns">
        <section>
          <h3>Everywhere</h3>
          <dl className="shortcut-list">
            {ACTIONS.filter((action) => action.shortcut).map((action) => (
              <div key={action.id}>
                <dt>{action.label}</dt>
                <dd>
                  <kbd className="kbd">{formatShortcut(action.shortcut!)}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>Writing</h3>
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
    const result = run({
      type: 'page.move',
      id: pageId,
      parentId,
      index: childrenOf(state.pages, parentId).length,
    });
    if (result.ok) {
      expandPage(parentId);
      closeDialog();
    }
  };

  return (
    <Dialog title={`Move “${displayTitle(page)}”`} onClose={closeDialog}>
      <input
        className="text-input"
        placeholder="Find a page"
        aria-label="Find a destination page"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        data-autofocus
      />
      <ul className="move-list" role="listbox" aria-label="Destinations">
        {!query && (
          <li>
            <button
              type="button"
              className="move-target"
              disabled={page.parentId === null}
              onClick={() => move(null)}
            >
              Top level
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
        {targets.length === 0 && query && <li className="muted move-empty">No matching pages.</li>}
      </ul>
    </Dialog>
  );
}
