import {
  HardDrive,
  Info,
  MessageSquareText,
  Palette,
  Puzzle,
  RefreshCw,
  SlidersHorizontal,
  X,
  GripVertical,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatShortcut } from '../actions';
import { AssistantSettings } from '../assistant/AssistantSettings';
import { previewCustomCss, saveCustomCss, useCustomCss } from '../customCss';
import { openHref } from '../editor/EditorMenus';
import { dateLocale, SUPPORTED_LOCALES, useTranslation } from '../i18n';
import type { SupportedLocale, TranslationKey } from '../i18n';
import { copyLegacyInto, legacyPageCount } from '../legacy';
import {
  deleteUnusedFiles,
  emptyOldTrash,
  exportAllMarkdown,
  exportBackup,
  importMarkdown,
  restoreBackup,
  unusedFiles,
} from '../operations';
import { formatBytes } from '../platform/attachments';
import { canOpenFolders, desktop, isMobile } from '../platform/desktop';
import {
  ACCENTS,
  PALETTES,
  resolvedTheme,
  SIDEBAR_FIXED,
  SIDEBAR_GROUPS,
  SIDEBAR_MODULES,
  setPreferences,
  usePreferences,
} from '../platform/preferences';
import type {
  Palette as PaletteName,
  SidebarItem,
  SidebarModule,
  TextScale,
  WeekStart,
} from '../platform/preferences';
import type { PageWidth, StartPage, ThemePreference, TrashDays, WritingFont } from '../platform/preferences';
import { closeDialog, confirmAction, openDialog, toast } from '../ui';
import type { SettingsSection } from '../ui';
import { chooseVaultFolder, switchVault } from '../vaults';
import { checkForUpdate, installUpdate, useUpdateState } from '../updates';
import { getSession } from '../workspace';
import { Dialog, Logo, Switch } from './primitives';
import { Select } from './Select';
import { PluginSettings } from './PluginSettings';
import { SettingRow, SettingsGroup } from './SettingsRows';
import { CloudSettings, NetworkSettings } from './SyncSettings';
import { t } from '../i18n';

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
  { id: 'plugins', key: 'settings.sections.plugins', icon: Puzzle },
  { id: 'about', key: 'settings.sections.about', icon: Info },
];

function Segmented<T extends string | number>({
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
    <Dialog
      title={t('settings.title')}
      size="large"
      className="settings-dialog"
      hideTitle
      onClose={closeDialog}
    >
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
        {current === 'plugins' && <PluginSettings />}
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
          value={
            prefs.startPage === 'today' && prefs.hiddenModules.includes('daily') ? 'home' : prefs.startPage
          }
          options={[
            ...(prefs.hiddenModules.includes('daily')
              ? []
              : [['today', t('settings.general.startPages.today')] as [StartPage, string]]),
            ['home', t('settings.general.startPages.home')],
            ['last', t('settings.general.startPages.last')],
          ]}
          onChange={(startPage) => setPreferences({ startPage })}
        />
      </SettingRow>
      {!prefs.hiddenModules.includes('daily') && (
        <SettingRow label={t('settings.general.autoDaily')} help={t('settings.general.autoDailyHelp')}>
          <Switch
            label={t('settings.general.autoDaily')}
            checked={prefs.autoDaily}
            onChange={(autoDaily) => setPreferences({ autoDaily })}
          />
        </SettingRow>
      )}
      <SettingRow label={t('settings.general.weekStart')}>
        <Segmented<WeekStart>
          label={t('settings.general.weekStart')}
          value={prefs.weekStart}
          options={([1, 0, 6] as const).map((day) => [
            day,
            // 2023-12-31 was a sunday
            new Date(2023, 11, 31 + day).toLocaleDateString(dateLocale(), { weekday: 'long' }),
          ])}
          onChange={(weekStart) => setPreferences({ weekStart })}
        />
      </SettingRow>
      <SettingRow label={t('settings.general.spellcheck')} help={t('settings.general.spellcheckHelp')}>
        <Switch
          label={t('settings.general.spellcheck')}
          checked={prefs.spellcheck}
          onChange={(spellcheck) => setPreferences({ spellcheck })}
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
        <SettingRow label={t('settings.appearance.colourTheme')}>
          <div
            className="palette-swatches"
            role="radiogroup"
            aria-label={t('settings.appearance.colourTheme')}
          >
            {PALETTES.map((palette) => {
              const label = t(`settings.appearance.palettes.${palette}` as TranslationKey);
              const [page, side, text] = PALETTE_PREVIEW[palette][resolvedTheme(prefs.theme)]!;
              return (
                <button
                  key={palette}
                  type="button"
                  role="radio"
                  aria-checked={prefs.palette === palette}
                  aria-label={label}
                  title={label}
                  className="palette-swatch"
                  onClick={() => setPreferences({ palette })}
                >
                  <span className="palette-preview" style={{ background: page }}>
                    <span style={{ background: side }} />
                    <span className="palette-lines">
                      <i style={{ background: text }} />
                      <i style={{ background: text }} />
                    </span>
                  </span>
                  <span className="palette-name">{label}</span>
                </button>
              );
            })}
          </div>
        </SettingRow>
        <SettingRow label={t('settings.appearance.accentColour')}>
          <div
            className="accent-swatches"
            role="radiogroup"
            aria-label={t('settings.appearance.accentColour')}
          >
            {ACCENTS.map((accent) => {
              const label = t(`settings.appearance.accents.${accent}` as TranslationKey);
              // a colour of your own, picked with the system's colour picker
              if (accent === 'custom')
                return (
                  <label
                    key={accent}
                    className={`accent-swatch accent-custom${prefs.accent === 'custom' ? ' is-picked' : ''}`}
                    title={label}
                    style={{ '--swatch': prefs.accentColor } as React.CSSProperties}
                  >
                    <input
                      type="color"
                      aria-label={label}
                      value={prefs.accentColor}
                      onClick={() => setPreferences({ accent: 'custom' })}
                      onChange={(event) =>
                        setPreferences({ accent: 'custom', accentColor: event.target.value })
                      }
                    />
                  </label>
                );
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
        <SettingRow label={t('settings.appearance.textSize')}>
          <Segmented<TextScale>
            label={t('settings.appearance.textSize')}
            value={prefs.textScale}
            options={[
              [0.9, t('settings.appearance.textSizes.small')],
              [1, t('settings.appearance.textSizes.normal')],
              [1.1, t('settings.appearance.textSizes.large')],
              [1.25, t('settings.appearance.textSizes.larger')],
            ]}
            onChange={(textScale) => setPreferences({ textScale })}
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
              ['full', t('settings.appearance.widths.full')],
            ]}
            onChange={(width) => setPreferences({ width })}
          />
        </SettingRow>
      </SettingsGroup>
      <SidebarSettings />
      <CustomCss />
    </>
  );
}

// which views the sidebar lists
// what each colour theme looks like in light and in dark: the page, the sidebar and the text, as in palettes.css
const PALETTE_PREVIEW: Record<PaletteName, Record<'light' | 'dark', [string, string, string]>> = {
  default: { light: ['#ffffff', '#f8f8f7', '#1d1d1f'], dark: ['#191919', '#202020', '#ececec'] },
  paper: { light: ['#fbf8f1', '#f3eee3', '#2b2620'], dark: ['#1f1c17', '#26221c', '#ece4d4'] },
  sepia: { light: ['#f4ecd8', '#ebe0c6', '#3d2f1f'], dark: ['#241d16', '#2b231a', '#e9dcc4'] },
  nord: { light: ['#eceff4', '#e5e9f0', '#2e3440'], dark: ['#2e3440', '#3b4252', '#eceff4'] },
  forest: { light: ['#f4f7f2', '#ebf0e7', '#1f2a1f'], dark: ['#171d18', '#1d241e', '#e2eadf'] },
  midnight: { light: ['#f5f6f8', '#eceef2', '#1d1d1f'], dark: ['#000000', '#0b0b0c', '#e8e8ea'] },
};

function SidebarSettings() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const [dragging, setDragging] = useState<SidebarItem | null>(null);
  const label = (item: SidebarItem): string => {
    switch (item) {
      case 'search':
        return t('common.search');
      case 'home':
        return t('settings.general.startPages.home');
      case 'daily':
        return t('sidebar.today');
      case 'templates':
        return t('dialogs.templates');
      case 'files':
        return t('files.title');
      case 'pages':
        return t('sidebar.pagesHeading');
      case 'settings':
        return t('settings.title');
      case 'assistant':
        return t('settings.sections.assistant');
      default:
        return t(`sidebar.${item}` as TranslationKey);
    }
  };
  // an item moves within its own group, before the one it is dropped on or a step up or down
  const move = (item: SidebarItem, to: SidebarItem | number) => {
    const order = prefs.sidebarOrder.filter((other) => other !== item);
    const group = groupOf(item);
    const members = order.filter((other) => groupOf(other) === group);
    let target: SidebarItem | undefined;
    if (typeof to === 'number') {
      const index = prefs.sidebarOrder.filter((other) => groupOf(other) === group).indexOf(item) + to;
      if (index < 0 || index > members.length) return;
      target = members[index];
      if (!target) {
        const last = members[members.length - 1];
        order.splice(last ? order.indexOf(last) + 1 : order.length, 0, item);
        setPreferences({ sidebarOrder: order });
        return;
      }
    } else target = to;
    if (!target || groupOf(target) !== group) return;
    order.splice(order.indexOf(target), 0, item);
    setPreferences({ sidebarOrder: order });
  };
  const groups: Array<[keyof typeof SIDEBAR_GROUPS, string]> = [
    ['top', t('settings.sidebar.groupTop')],
    ['sections', t('settings.sidebar.groupSections')],
    ['bottom', t('settings.sidebar.groupBottom')],
  ];
  return (
    <>
      <SettingsGroup title={t('settings.sidebar.title')}>
        <SettingRow label={t('settings.sidebar.peek')} help={t('settings.sidebar.peekHelp')}>
          <Switch
            label={t('settings.sidebar.peek')}
            checked={prefs.sidebarPeek}
            onChange={(sidebarPeek) => setPreferences({ sidebarPeek })}
          />
        </SettingRow>
      </SettingsGroup>
      {groups.map(([group, title]) => (
        <SettingsGroup key={group} title={title}>
          {prefs.sidebarOrder
            .filter((item) => groupOf(item) === group && item !== 'assistant')
            .map((item) => {
              const fixed = SIDEBAR_FIXED.includes(item);
              const module = (SIDEBAR_MODULES as readonly string[]).includes(item)
                ? (item as SidebarModule)
                : null;
              return (
                <div
                  key={item}
                  className={`settings-row sidebar-layout-row${dragging === item ? ' is-dragging' : ''}`}
                  onDragOver={(event) => {
                    if (dragging && groupOf(dragging) === group) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging && dragging !== item) move(dragging, item);
                    setDragging(null);
                  }}
                >
                  <button
                    type="button"
                    className="icon-button small drag-grip"
                    draggable
                    aria-label={t('settings.sidebar.moveAria', { name: label(item) })}
                    title={t('settings.sidebar.moveHint')}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', item);
                      setDragging(item);
                    }}
                    onDragEnd={() => setDragging(null)}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                      event.preventDefault();
                      move(item, event.key === 'ArrowUp' ? -1 : 1);
                    }}
                  >
                    <GripVertical size={14} />
                  </button>
                  <span className="settings-row-label sidebar-layout-label">{label(item)}</span>
                  <Switch
                    label={t('settings.sidebar.show', { name: label(item) })}
                    checked={fixed || (module !== null && !prefs.hiddenModules.includes(module))}
                    disabled={fixed || module === null}
                    onChange={(show) =>
                      module &&
                      setPreferences({
                        hiddenModules: show
                          ? prefs.hiddenModules.filter((other) => other !== module)
                          : [...prefs.hiddenModules, module],
                      })
                    }
                  />
                </div>
              );
            })}
        </SettingsGroup>
      ))}
      <p className="muted small settings-note">{t('settings.sidebar.conditionalHelp')}</p>
    </>
  );
}

const groupOf = (item: SidebarItem): keyof typeof SIDEBAR_GROUPS =>
  (SIDEBAR_GROUPS.top as readonly SidebarItem[]).includes(item)
    ? 'top'
    : (SIDEBAR_GROUPS.sections as readonly SidebarItem[]).includes(item)
      ? 'sections'
      : 'bottom';

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

// every vault morrow knows on this computer, in the order the vault menu lists them. one can be moved up or
// down, or forgotten, which takes it off the list and leaves its folder and files where they are
function KnownVaults() {
  const { t } = useTranslation();
  const current = getSession().location;
  const [vaults, setVaults] = useState<Array<{ path: string; name: string; exists: boolean }>>([]);
  const refresh = () => void desktop?.vault?.state().then((state) => setVaults(state.recent));
  useEffect(refresh, []);
  const move = (index: number, by: -1 | 1) => {
    const next = [...vaults];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    setVaults(next);
    void desktop?.vault?.reorder?.(next.map((vault) => vault.path));
  };
  const forget = (path: string, name: string) =>
    confirmAction({
      title: t('settings.vault.forgetTitle', { name }),
      body: t('settings.vault.forgetBody'),
      confirmLabel: t('settings.vault.forget'),
      danger: true,
      onConfirm: () => {
        void desktop?.vault?.forget(path).then(async () => {
          if (path !== current) return;
          // the open vault goes, morrow moves to the next one it knows, or asks for a folder
          const other = vaults.find((vault) => vault.path !== path && vault.exists);
          if (other) await switchVault(other.path);
          else window.location.reload();
        });
      },
    });
  if (vaults.length === 0) return null;
  return (
    <SettingsGroup title={t('settings.vault.knownTitle')} help={t('settings.vault.knownHelp')}>
      {vaults.map((vault, index) => (
        <div key={vault.path} className="settings-row known-vault">
          <div className="settings-row-text">
            <span className="settings-row-label">
              {vault.name}
              {vault.path === current && <span className="badge">{t('settings.vault.open')}</span>}
              {!vault.exists && <span className="badge is-muted">{t('settings.vault.missing')}</span>}
            </span>
            <span className="settings-row-help settings-path">{vault.path}</span>
          </div>
          <div className="known-vault-actions">
            <button
              type="button"
              className="icon-button small"
              aria-label={t('editor.moveUp')}
              title={t('editor.moveUp')}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              className="icon-button small"
              aria-label={t('editor.moveDown')}
              title={t('editor.moveDown')}
              disabled={index === vaults.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              className="button small is-danger"
              onClick={() => forget(vault.path, vault.name)}
            >
              {t('settings.vault.forget')}
            </button>
          </div>
        </div>
      ))}
    </SettingsGroup>
  );
}

function VaultSettings() {
  const { t, tp } = useTranslation();
  const prefs = usePreferences();
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
        <SettingRow
          label={t('settings.vault.currentFolder')}
          help={<span className="settings-path">{vault}</span>}
        >
          {desktop?.vault && !isMobile && (
            <button type="button" className="button small" onClick={() => void desktop?.vault?.reveal('')}>
              {t('settings.vault.showFolder')}
            </button>
          )}
          {canOpenFolders && (
            <button type="button" className="button small" onClick={() => void chooseVaultFolder()}>
              {t('settings.vault.chooseAnother')}
            </button>
          )}
        </SettingRow>
        {legacy > 0 && (
          <SettingRow
            label={t('settings.vault.copyLegacy')}
            help={tp('settings.vault.copyLegacyHelp', legacy)}
          >
            <button
              type="button"
              className="button small"
              onClick={() =>
                void copyLegacyInto(getSession()).then((result) => {
                  if (result.ok) {
                    toast(tp('settings.vault.copyLegacySuccess', result.value));
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
      {desktop?.vault && <KnownVaults />}
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
      <SettingsGroup title={t('settings.vault.trash')}>
        <SettingRow label={t('settings.vault.emptyTrash')} help={t('settings.vault.emptyTrashHelp')}>
          <Segmented<`${TrashDays}`>
            label={t('settings.vault.emptyTrash')}
            value={String(prefs.trashDays) as `${TrashDays}`}
            options={[
              ['0', t('settings.vault.never')],
              ['30', t('settings.vault.afterDays', { days: 30 })],
              ['60', t('settings.vault.afterDays', { days: 60 })],
              ['90', t('settings.vault.afterDays', { days: 90 })],
            ]}
            onChange={(days) => {
              setPreferences({ trashDays: Number(days) as TrashDays });
              emptyOldTrash();
            }}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title={t('settings.vault.unusedFiles')}>
        <SettingRow
          label={
            files
              ? tp('settings.vault.filesCount', files.count, { bytes: formatBytes(files.bytes) })
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

// checking asks github's release list for the latest version and sends nothing about you or your notes
function UpdateSettings() {
  const prefs = usePreferences();
  const update = useUpdateState();
  if (!desktop?.updates) return null;
  const found = update.kind === 'available' || update.kind === 'installing' ? update.update : null;
  const status =
    update.kind === 'checking'
      ? t('updates.checking')
      : update.kind === 'current'
        ? t('updates.upToDate')
        : update.kind === 'error'
          ? update.message
          : found
            ? t('updates.available', { version: found.version })
            : t('updates.help');
  return (
    <SettingsGroup>
      <SettingRow label={t('updates.check')} help={status}>
        <div className="settings-actions">
          <button
            type="button"
            className="button small"
            disabled={update.kind === 'checking' || update.kind === 'installing'}
            onClick={() => void checkForUpdate()}
          >
            {t('updates.checkNow')}
          </button>
          <Switch
            label={t('updates.checkAutomatically')}
            checked={prefs.checkUpdates}
            onChange={(checkUpdates) => setPreferences({ checkUpdates })}
          />
        </div>
      </SettingRow>
      {found && (
        <SettingRow
          label={t('settings.about.version', { version: found.version })}
          help={
            update.kind === 'installing'
              ? t('updates.downloading', { percent: Math.round(update.share * 100) })
              : found.installable
                ? t('updates.restartsInto')
                : t('updates.downloadManually')
          }
        >
          <div className="settings-actions">
            <button type="button" className="button small" onClick={() => openHref(found.url)}>
              {t('updates.whatsNew')}
            </button>
            <button
              type="button"
              className="button small primary"
              disabled={update.kind === 'installing'}
              onClick={() => void installUpdate(found)}
            >
              {found.installable ? t('updates.installAndRestart') : t('updates.download')}
            </button>
          </div>
        </SettingRow>
      )}
    </SettingsGroup>
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
      <UpdateSettings />
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
