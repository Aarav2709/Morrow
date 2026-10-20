import { HardDrive, Info, MessageSquareText, Palette, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatShortcut } from '../actions';
import { AssistantSettings } from '../assistant/AssistantSettings';
import { previewCustomCss, saveCustomCss, useCustomCss } from '../customCss';
import { openHref } from '../editor/EditorMenus';
import { copyLegacyInto, legacyPageCount } from '../legacy';
import {
  deleteUnusedFiles,
  exportAllMarkdown,
  exportBackup,
  importMarkdown,
  restoreBackup,
  unusedFiles,
} from '../operations';
import { formatBytes } from '../platform/attachments';
import { desktop } from '../platform/desktop';
import { ACCENT_LABELS, ACCENTS, setPreferences, usePreferences } from '../platform/preferences';
import type { PageWidth, StartPage, ThemePreference, WritingFont } from '../platform/preferences';
import { closeDialog, openDialog, toast } from '../ui';
import type { SettingsSection } from '../ui';
import { chooseVaultFolder } from '../vaults';
import { checkForUpdate, installUpdate, useUpdateState } from '../updates';
import { getSession } from '../workspace';
import { Dialog, Logo, Switch } from './primitives';
import { SettingRow, SettingsGroup } from './SettingsRows';
import { CloudSettings, NetworkSettings } from './SyncSettings';
import { SpellingSetting } from './SpellingSetting';

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: LucideIcon }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'assistant', label: 'Assistant', icon: MessageSquareText },
  { id: 'sync', label: 'Sync', icon: RefreshCw },
  { id: 'vault', label: 'Vault and files', icon: HardDrive },
  { id: 'about', label: 'About', icon: Info },
];

function Segmented<T extends string>({
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
    <div className="segmented" role="radiogroup" aria-label={label}>
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
  );
}

export function SettingsDialog({ section }: { section?: SettingsSection }) {
  const [current, setCurrent] = useState<SettingsSection>(section ?? 'general');
  const shown = SECTIONS.find((item) => item.id === current) ?? SECTIONS[0]!;
  return (
    <Dialog title="Settings" size="large" className="settings-dialog" hideTitle onClose={closeDialog}>
      <nav className="settings-nav" aria-label="Settings">
        <p className="settings-nav-title">Settings</p>
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item${item.id === current ? ' is-active' : ''}`}
              aria-current={item.id === current ? 'page' : undefined}
              onClick={() => setCurrent(item.id)}
            >
              <Icon size={15} /> {item.label}
            </button>
          );
        })}
      </nav>
      <div className="settings-page" key={current}>
        <header className="settings-page-head">
          <h3>{shown.label}</h3>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={closeDialog}>
            <X size={16} />
          </button>
        </header>
        {current === 'general' && <GeneralSettings />}
        {current === 'appearance' && <AppearanceSettings />}
        {current === 'assistant' && <AssistantSettings />}
        {current === 'sync' && (
          <>
            <NetworkSettings />
            <CloudSettings />
          </>
        )}
        {current === 'vault' && <VaultSettings />}
        {current === 'about' && <AboutSettings />}
      </div>
    </Dialog>
  );
}

function GeneralSettings() {
  const prefs = usePreferences();
  return (
    <SettingsGroup>
      <SpellingSetting />
      <SettingRow label="Your name" help="The home page greets you with it.">
        <input
          className="text-input small settings-input"
          placeholder="Optional"
          aria-label="Your name"
          maxLength={60}
          defaultValue={prefs.name}
          onBlur={(event) => setPreferences({ name: event.target.value.trim() })}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
      </SettingRow>
      <SettingRow
        label="When Morrow opens"
        help={`${formatShortcut('Alt+D')} opens today's note, ${formatShortcut('Mod+Alt+M')} jots into it from any app.`}
      >
        <Segmented<StartPage>
          label="When Morrow opens"
          value={prefs.startPage}
          options={[
            ['today', "Today's note"],
            ['home', 'Home'],
            ['last', 'Where I left off'],
          ]}
          onChange={(startPage) => setPreferences({ startPage })}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

function AppearanceSettings() {
  const prefs = usePreferences();
  return (
    <>
      <SettingsGroup>
        <SettingRow label="Theme">
          <Segmented<ThemePreference>
            label="Theme"
            value={prefs.theme}
            options={[
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
            onChange={(theme) => setPreferences({ theme })}
          />
        </SettingRow>
        <SettingRow label="Accent colour">
          <div className="accent-swatches" role="radiogroup" aria-label="Accent colour">
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
        </SettingRow>
        <SettingRow label="Colourful pages" help="Coloured headings, lists, icons and tags.">
          <Switch
            label="Colourful pages"
            checked={prefs.colorful}
            onChange={(colorful) => setPreferences({ colorful })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Writing">
        <SettingRow label="Font">
          <Segmented<WritingFont>
            label="Writing font"
            value={prefs.font}
            options={[
              ['serif', 'Serif'],
              ['sans', 'Sans'],
              ['mono', 'Mono'],
            ]}
            onChange={(font) => setPreferences({ font })}
          />
        </SettingRow>
        <SettingRow label="Page width">
          <Segmented<PageWidth>
            label="Page width"
            value={prefs.width}
            options={[
              ['comfortable', 'Comfortable'],
              ['wide', 'Wide'],
            ]}
            onChange={(width) => setPreferences({ width })}
          />
        </SettingRow>
      </SettingsGroup>
      <CustomCss />
    </>
  );
}

// styles of your own, saved in the vault and shown as you type
function CustomCss() {
  const saved = useCustomCss();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const text = draft ?? saved;
  return (
    <SettingsGroup>
      <SettingRow label="Custom CSS" help="Restyle anything. Saved in your vault as .morrow/style.css.">
        <button type="button" className="button small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Close' : saved.trim() ? 'Edit' : 'Add'}
        </button>
      </SettingRow>
      {open && (
        <div className="settings-row is-stacked">
          <textarea
            className="text-input css-input"
            spellCheck={false}
            aria-label="Custom CSS"
            placeholder={'.page-title { letter-spacing: -0.03em; }\n:root { --accent: #e5484d; }'}
            value={text}
            onChange={(event) => {
              setDraft(event.target.value);
              previewCustomCss(event.target.value);
            }}
          />
          <div className="settings-actions">
            <button
              type="button"
              className="button small"
              disabled={draft === null}
              onClick={() => {
                setDraft(null);
                previewCustomCss(saved);
              }}
            >
              Discard
            </button>
            <button
              type="button"
              className="button primary small"
              disabled={draft === null || draft === saved}
              onClick={() =>
                void saveCustomCss(text)
                  .then(() => {
                    setDraft(null);
                    toast('Custom CSS saved.');
                  })
                  .catch(() => toast('Could not save the CSS.', { tone: 'error' }))
              }
            >
              Save
            </button>
          </div>
        </div>
      )}
    </SettingsGroup>
  );
}

function VaultSettings() {
  const vault = getSession().location;
  const [legacy, setLegacy] = useState(0);
  const [files, setFiles] = useState<{ count: number; bytes: number; unused: number } | null>(null);
  const countFiles = () => {
    void Promise.all([getSession().listFiles(), unusedFiles()]).then(([all, unused]) =>
      setFiles({
        count: all.length,
        bytes: all.reduce((sum, file) => sum + file.size, 0),
        unused: unused.length,
      }),
    );
  };
  useEffect(countFiles, []);
  useEffect(() => {
    if (vault)
      void legacyPageCount()
        .then(setLegacy)
        .catch(() => setLegacy(0));
  }, [vault]);

  return (
    <>
      <SettingsGroup help="Every page is a Markdown file in this folder. Open it in any app or back it up however you like.">
        <SettingRow label="Vault folder" help={<span className="settings-path">{vault}</span>}>
          {desktop?.vault && (
            <button type="button" className="button small" onClick={() => void desktop?.vault?.reveal('')}>
              Show
            </button>
          )}
          <button type="button" className="button small" onClick={() => void chooseVaultFolder()}>
            Open another
          </button>
        </SettingRow>
        {legacy > 0 && (
          <SettingRow
            label="Pages from an earlier version"
            help={`${legacy} page${legacy === 1 ? ' is' : 's are'} still in the app's own storage.`}
          >
            <button
              type="button"
              className="button small"
              onClick={() =>
                void copyLegacyInto(getSession()).then((result) => {
                  if (result.ok) {
                    toast(`Copied ${result.value} page${result.value === 1 ? '' : 's'} into this vault.`);
                    setLegacy(0);
                  } else toast(result.error, { tone: 'error' });
                })
              }
            >
              Copy into this vault
            </button>
          </SettingRow>
        )}
      </SettingsGroup>
      <SettingsGroup title="Backups and export">
        <SettingRow label="Save a backup" help="One file with every page, the trash included.">
          <button type="button" className="button small" onClick={() => void exportBackup()}>
            Save…
          </button>
        </SettingRow>
        <SettingRow label="Restore a backup" help="Adds its pages. Existing pages are never overwritten.">
          <button type="button" className="button small" onClick={() => void restoreBackup()}>
            Restore…
          </button>
        </SettingRow>
        <SettingRow label="Export as Markdown" help="A zip of plain text files.">
          <button type="button" className="button small" onClick={() => void exportAllMarkdown()}>
            Export…
          </button>
        </SettingRow>
        <SettingRow label="Import Markdown" help="Files, folders or a Notion export.">
          <button type="button" className="button small" onClick={() => void importMarkdown()}>
            Import…
          </button>
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Images and files">
        <SettingRow
          label={
            files
              ? `${files.count} file${files.count === 1 ? '' : 's'}, ${formatBytes(files.bytes)}`
              : 'Counting…'
          }
          help="A file stays while any page or page version uses it."
        >
          <button
            type="button"
            className="button small"
            disabled={!files?.unused}
            onClick={() => void deleteUnusedFiles().then(countFiles)}
          >
            {files?.unused ? `Remove ${files.unused} unused` : 'None unused'}
          </button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

// checking asks github's release list for the latest version and sends nothing about you or your notes
function UpdateSettings() {
  const prefs = usePreferences();
  const update = useUpdateState();
  if (!desktop?.updates) return null;
  const found = update.kind === 'available' || update.kind === 'installing' ? update.update : null;
  const status =
    update.kind === 'checking'
      ? 'Checking…'
      : update.kind === 'current'
        ? 'You have the latest version.'
        : update.kind === 'error'
          ? update.message
          : found
            ? `Morrow ${found.version} is out.`
            : 'Checks GitHub for a new version when Morrow opens and once a day.';
  return (
    <SettingsGroup>
      <SettingRow label="Check for updates" help={status}>
        <div className="settings-actions">
          <button
            type="button"
            className="button small"
            disabled={update.kind === 'checking' || update.kind === 'installing'}
            onClick={() => void checkForUpdate()}
          >
            Check now
          </button>
          <Switch
            label="Check for updates automatically"
            checked={prefs.checkUpdates}
            onChange={(checkUpdates) => setPreferences({ checkUpdates })}
          />
        </div>
      </SettingRow>
      {found && (
        <SettingRow
          label={`Morrow ${found.version}`}
          help={
            update.kind === 'installing'
              ? `Downloading… ${Math.round(update.share * 100)}%`
              : found.installable
                ? 'Morrow restarts into the new version once it is downloaded.'
                : 'Download it from the release page and install it over this one.'
          }
        >
          <div className="settings-actions">
            <button type="button" className="button small" onClick={() => openHref(found.url)}>
              What's new
            </button>
            <button
              type="button"
              className="button small primary"
              disabled={update.kind === 'installing'}
              onClick={() => void installUpdate(found)}
            >
              {found.installable ? 'Install and restart' : 'Download'}
            </button>
          </div>
        </SettingRow>
      )}
    </SettingsGroup>
  );
}

function AboutSettings() {
  return (
    <>
      <div className="settings-about">
        <Logo size={36} />
        <div>
          <strong>Morrow {desktop?.version ?? __APP_VERSION__}</strong>
          <span>Free and open source under the Apache License 2.0.</span>
        </div>
      </div>
      <UpdateSettings />
      <SettingsGroup>
        <SettingRow label="Keyboard shortcuts" help={`Or press ${formatShortcut('Mod+/')} anywhere.`}>
          <button type="button" className="button small" onClick={() => openDialog({ kind: 'shortcuts' })}>
            Show
          </button>
        </SettingRow>
        <SettingRow label="Source code" help="Report a problem or suggest something.">
          <button
            type="button"
            className="button small"
            onClick={() => openHref('https://github.com/Aarav2709/Morrow')}
          >
            GitHub
          </button>
        </SettingRow>
      </SettingsGroup>
      <p className="settings-group-help">
        No accounts, no tracking and no ads. Nothing leaves this computer unless you turn on the assistant,
        sync or update checks.
      </p>
    </>
  );
}
