import { HardDrive, Info, MessageSquareText, Palette, RefreshCw, SlidersHorizontal, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatShortcut } from '../actions';
import { AssistantSettings } from '../assistant/AssistantSettings';
import { previewCustomCss, saveCustomCss, useCustomCss } from '../customCss';
import { openHref } from '../editor/EditorMenus';
import { SUPPORTED_LOCALES, useTranslation } from '../i18n';
import type { SupportedLocale, TranslationKey } from '../i18n';
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
import { ACCENTS, setPreferences, usePreferences } from '../platform/preferences';
import type { PageWidth, StartPage, ThemePreference, WritingFont } from '../platform/preferences';
import { closeDialog, openDialog, toast } from '../ui';
import type { SettingsSection } from '../ui';
import { chooseVaultFolder } from '../vaults';
import { getSession } from '../workspace';
import { Dialog, Logo, Switch } from './primitives';
import { Select } from './Select';
import { SettingRow, SettingsGroup } from './SettingsRows';
import { CloudSettings, NetworkSettings } from './SyncSettings';

interface SectionDef {
  id: SettingsSection;
  key: TranslationKey;
  icon: LucideIcon;
}

const SECTIONS: SectionDef[] = [
  { id: 'general', key: 'settings.sections.general', icon: SlidersHorizontal },
  { id: 'appearance', key: 'settings.sections.appearance', icon: Palette },
  { id: 'assistant', key: 'settings.sections.assistant', icon: MessageSquareText },
  { id: 'sync', key: 'settings.sections.sync', icon: RefreshCw },
  { id: 'vault', key: 'settings.sections.vault', icon: HardDrive },
  { id: 'about', key: 'settings.sections.about', icon: Info },
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
  const { t } = useTranslation();
  const [current, setCurrent] = useState<SettingsSection>(section ?? 'general');
  const shown = SECTIONS.find((item) => item.id === current) ?? SECTIONS[0]!;
  return (
    <Dialog title={t('settings.title')} size="large" className="settings-dialog" hideTitle onClose={closeDialog}>
      <nav className="settings-nav" aria-label={t('settings.title')}>
        <p className="settings-nav-title">{t('settings.title')}</p>
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          const label = t(item.key);
          return (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item${item.id === current ? ' is-active' : ''}`}
              aria-current={item.id === current ? 'page' : undefined}
              onClick={() => setCurrent(item.id)}
            >
              <Icon size={15} /> {label}
            </button>
          );
        })}
      </nav>
      <div className="settings-page" key={current}>
        <header className="settings-page-head">
          <h3>{t(shown.key)}</h3>
          <button
            type="button"
            className="icon-button"
            aria-label={t('settings.closeSettings')}
            onClick={closeDialog}
          >
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
  const { t } = useTranslation();
  const prefs = usePreferences();
  return (
    <SettingsGroup>
      <SettingRow label={t('settings.general.language')} help={t('settings.general.languageHelp')}>
        <Select<SupportedLocale>
          label={t('settings.general.language')}
          value={prefs.locale}
          options={SUPPORTED_LOCALES.map((locale) => ({
            value: locale.id,
            label: locale.label,
          }))}
          onChange={(locale) => setPreferences({ locale })}
        />
      </SettingRow>
      <SettingRow label={t('settings.general.yourName')} help={t('settings.general.yourNameHelp')}>
        <input
          className="text-input small settings-input"
          placeholder={t('settings.general.yourNamePlaceholder')}
          aria-label={t('settings.general.yourName')}
          maxLength={60}
          defaultValue={prefs.name}
          onBlur={(event) => setPreferences({ name: event.target.value.trim() })}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
      </SettingRow>
      <SettingRow
        label={t('settings.general.whenOpens')}
        help={t('settings.general.whenOpensHelp', {
          shortcutDaily: formatShortcut('Alt+D'),
          shortcutCapture: formatShortcut('Mod+Alt+M'),
        })}
      >
        <Segmented<StartPage>
          label={t('settings.general.whenOpens')}
          value={prefs.startPage}
          options={[
            ['today', t('settings.general.startPages.today')],
            ['home', t('settings.general.startPages.home')],
            ['last', t('settings.general.startPages.last')],
          ]}
          onChange={(startPage) => setPreferences({ startPage })}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

function AppearanceSettings() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  return (
    <>
      <SettingsGroup>
        <SettingRow label={t('settings.appearance.theme')}>
          <Segmented<ThemePreference>
            label={t('settings.appearance.theme')}
            value={prefs.theme}
            options={[
              ['system', t('settings.appearance.themes.system')],
              ['light', t('settings.appearance.themes.light')],
              ['dark', t('settings.appearance.themes.dark')],
            ]}
            onChange={(theme) => setPreferences({ theme })}
          />
        </SettingRow>
        <SettingRow label={t('settings.appearance.accentColour')}>
          <div className="accent-swatches" role="radiogroup" aria-label={t('settings.appearance.accentColour')}>
            {ACCENTS.map((accent) => {
              const label = t(`settings.appearance.accents.${accent}` as TranslationKey);
              return (
                <button
                  key={accent}
                  type="button"
                  role="radio"
                  aria-checked={prefs.accent === accent}
                  aria-label={label}
                  title={label}
                  className={`accent-swatch accent-${accent}`}
                  onClick={() => setPreferences({ accent })}
                />
              );
            })}
          </div>
        </SettingRow>
        <SettingRow
          label={t('settings.appearance.colourfulPages')}
          help={t('settings.appearance.colourfulPagesHelp')}
        >
          <Switch
            label={t('settings.appearance.colourfulPages')}
            checked={prefs.colorful}
            onChange={(colorful) => setPreferences({ colorful })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t('settings.appearance.writingTitle')}>
        <SettingRow label={t('settings.appearance.font')}>
          <Segmented<WritingFont>
            label={t('settings.appearance.font')}
            value={prefs.font}
            options={[
              ['serif', t('settings.appearance.fonts.serif')],
              ['sans', t('settings.appearance.fonts.sans')],
              ['mono', t('settings.appearance.fonts.mono')],
            ]}
            onChange={(font) => setPreferences({ font })}
          />
        </SettingRow>
        <SettingRow label={t('settings.appearance.pageWidth')}>
          <Segmented<PageWidth>
            label={t('settings.appearance.pageWidth')}
            value={prefs.width}
            options={[
              ['comfortable', t('settings.appearance.widths.comfortable')],
              ['wide', t('settings.appearance.widths.wide')],
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
  const { t } = useTranslation();
  const saved = useCustomCss();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const text = draft ?? saved;
  return (
    <SettingsGroup>
      <SettingRow label={t('settings.appearance.customCss')} help={t('settings.appearance.customCssHelp')}>
        <button type="button" className="button small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open
            ? t('settings.appearance.customCssClose')
            : saved.trim()
              ? t('settings.appearance.customCssEdit')
              : t('settings.appearance.customCssAdd')}
        </button>
      </SettingRow>
      {open && (
        <div className="settings-row is-stacked">
          <textarea
            className="text-input css-input"
            spellCheck={false}
            aria-label={t('settings.appearance.customCss')}
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
              {t('settings.appearance.customCssDiscard')}
            </button>
            <button
              type="button"
              className="button primary small"
              disabled={draft === null || draft === saved}
              onClick={() =>
                void saveCustomCss(text)
                  .then(() => {
                    setDraft(null);
                    toast(t('settings.appearance.customCssSaved'));
                  })
                  .catch(() => toast(t('settings.appearance.customCssFailed'), { tone: 'error' }))
              }
            >
              {t('settings.appearance.customCssSave')}
            </button>
          </div>
        </div>
      )}
    </SettingsGroup>
  );
}

function VaultSettings() {
  const { t } = useTranslation();
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
      <SettingsGroup help={t('settings.vault.groupHelp')}>
        <SettingRow label={t('settings.vault.currentFolder')} help={<span className="settings-path">{vault}</span>}>
          {desktop?.vault && (
            <button type="button" className="button small" onClick={() => void desktop?.vault?.reveal('')}>
              {t('settings.vault.showFolder')}
            </button>
          )}
          <button type="button" className="button small" onClick={() => void chooseVaultFolder()}>
            {t('settings.vault.chooseAnother')}
          </button>
        </SettingRow>
        {legacy > 0 && (
          <SettingRow
            label={t('settings.vault.copyLegacy')}
            help={t('settings.vault.copyLegacyHelp', { count: legacy })}
          >
            <button
              type="button"
              className="button small"
              onClick={() =>
                void copyLegacyInto(getSession()).then((result) => {
                  if (result.ok) {
                    toast(t('settings.vault.copyLegacySuccess', { count: result.value }));
                    setLegacy(0);
                  } else toast(result.error, { tone: 'error' });
                })
              }
            >
              {t('settings.vault.copyLegacyButton')}
            </button>
          </SettingRow>
        )}
      </SettingsGroup>
      <SettingsGroup title={t('settings.vault.filesTitle')}>
        <SettingRow label={t('settings.vault.exportBackup')} help={t('settings.vault.exportBackupHelp')}>
          <button type="button" className="button small" onClick={() => void exportBackup()}>
            {t('settings.vault.saveBackupButton')}
          </button>
        </SettingRow>
        <SettingRow label={t('settings.vault.restoreBackup')} help={t('settings.vault.restoreBackupHelp')}>
          <button type="button" className="button small" onClick={() => void restoreBackup()}>
            {t('settings.vault.restoreBackupButton')}
          </button>
        </SettingRow>
        <SettingRow label={t('settings.vault.exportMarkdown')} help={t('settings.vault.exportMarkdownHelp')}>
          <button type="button" className="button small" onClick={() => void exportAllMarkdown()}>
            {t('settings.vault.exportMarkdownButton')}
          </button>
        </SettingRow>
        <SettingRow label={t('settings.vault.importMarkdown')} help={t('settings.vault.importMarkdownHelp')}>
          <button type="button" className="button small" onClick={() => void importMarkdown()}>
            {t('settings.vault.importMarkdownButton')}
          </button>
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t('settings.vault.unusedFiles')}>
        <SettingRow
          label={
            files
              ? t('settings.vault.filesCount', { count: files.count, bytes: formatBytes(files.bytes) })
              : t('settings.vault.counting')
          }
          help={t('settings.vault.unusedFilesHelp')}
        >
          <button
            type="button"
            className="button small"
            disabled={!files?.unused}
            onClick={() => void deleteUnusedFiles().then(countFiles)}
          >
            {files?.unused
              ? t('settings.vault.cleanUnused', { count: files.unused })
              : t('settings.vault.noneUnused')}
          </button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

function AboutSettings() {
  const { t } = useTranslation();
  return (
    <>
      <div className="settings-about">
        <Logo size={36} />
        <div>
          <strong>Morrow {desktop?.version ?? __APP_VERSION__}</strong>
          <span>{t('settings.about.description')}</span>
        </div>
      </div>
      <SettingsGroup>
        <SettingRow
          label={t('settings.about.shortcuts')}
          help={t('settings.about.shortcutsHelp', { shortcut: formatShortcut('Mod+/') })}
        >
          <button type="button" className="button small" onClick={() => openDialog({ kind: 'shortcuts' })}>
            {t('settings.about.shortcutsButton')}
          </button>
        </SettingRow>
        <SettingRow label={t('settings.about.sourceCode')} help={t('settings.about.sourceCodeHelp')}>
          <button
            type="button"
            className="button small"
            onClick={() => openHref('https://github.com/Aarav2709/Morrow')}
          >
            {t('settings.about.gitHubButton')}
          </button>
        </SettingRow>
      </SettingsGroup>
      <p className="settings-group-help">{t('settings.about.footer')}</p>
    </>
  );
}
