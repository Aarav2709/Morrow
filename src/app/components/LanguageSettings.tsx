import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { dateLocale, SUPPORTED_LOCALES, useTranslation } from '../i18n';
import type { SupportedLocale, TranslationKey } from '../i18n';
import { describeDate } from '../editor/Structure';
import { desktop } from '../platform/desktop';
import { DATE_FORMATS, setPreferences, usePreferences } from '../platform/preferences';
import type { DateFormat, WeekStart } from '../platform/preferences';
import { toast } from '../ui';
import { allTimeZones, systemTimeZone, zoneOffsetLabel } from '../zones';
import { Switch } from './primitives';
import { Select } from './Select';
import { Segmented, SettingRow, SettingsGroup } from './SettingsRows';

// languages the spellchecker can be set to, the system's own are offered too. each system checks only in
// the ones it has a dictionary for
const SPELL_CHOICES = [
  'en-US',
  'en-GB',
  'es-ES',
  'es-MX',
  'pt-BR',
  'pt-PT',
  'fr-FR',
  'de-DE',
  'it-IT',
  'nl-NL',
  'ca-ES',
  'sv-SE',
  'da-DK',
  'nb-NO',
  'fi-FI',
  'pl-PL',
  'cs-CZ',
  'hu-HU',
  'ro-RO',
  'el-GR',
  'tr-TR',
  'ru-RU',
  'uk-UA',
  'hi-IN',
  'id-ID',
  'vi-VN',
];

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([dateLocale()], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

interface SpellInfo {
  chosen: string[];
  system: string[];
  automatic: boolean;
}

// the languages words are checked in. none picked follows the system, several can be checked at once
function SpellLanguages() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<SpellInfo | null>(null);
  useEffect(() => {
    void desktop
      ?.spellLanguages?.()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  if (!info) return null;
  if (info.automatic)
    return (
      <SettingRow
        label={t('settings.language.spellLanguages')}
        help={t('settings.language.spellAutomatic')}
      />
    );
  const save = async (chosen: string[]) => {
    setInfo({ ...info, chosen });
    const restart = await desktop?.setSpellLanguages?.(chosen).catch(() => false);
    if (restart) toast(t('settings.language.spellRestart'));
  };
  const remaining = [...new Set([...info.system, ...SPELL_CHOICES])].filter(
    (code) => !info.chosen.includes(code),
  );
  return (
    <SettingRow
      label={t('settings.language.spellLanguages')}
      help={
        info.chosen.length
          ? t('settings.language.spellLanguagesHelp')
          : t('settings.language.spellSystem', {
              languages: info.system.map(languageName).join(', ') || '—',
            })
      }
      stacked
    >
      <div className="spell-languages">
        {info.chosen.map((code) => (
          <span key={code} className="chip spell-language">
            {languageName(code)}
            <button
              type="button"
              className="icon-button tiny"
              aria-label={t('settings.language.removeLanguage', { language: languageName(code) })}
              onClick={() => void save(info.chosen.filter((item) => item !== code))}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {info.chosen.length < 8 && (
          <Select<string>
            label={t('settings.language.addLanguage')}
            placeholder={t('settings.language.addLanguage')}
            value={null}
            options={remaining
              .map((code) => ({ value: code, label: languageName(code), detail: code }))
              .sort((a, b) => a.label.localeCompare(b.label))}
            // the first pick starts from the system's languages, so adding spanish keeps english
            onChange={(code) =>
              void save(
                [...(info.chosen.length ? info.chosen : info.system), code].filter(
                  (item, index, all) => all.indexOf(item) === index,
                ),
              )
            }
          />
        )}
        {info.chosen.length > 0 && (
          <button type="button" className="link-button small" onClick={() => void save([])}>
            {t('settings.language.useSystem')}
          </button>
        )}
      </div>
    </SettingRow>
  );
}

export function LanguageSettings() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const zones = useMemo(
    () =>
      allTimeZones().map((zone) => ({
        value: zone,
        label: zone.replaceAll('_', ' '),
        detail: zoneOffsetLabel(zone),
      })),
    [],
  );
  const today = new Date();
  // a date a week and a half from now shows each format the way a date in a page would
  const sample = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 10);
  const sampleKey = `${sample.getFullYear()}-${String(sample.getMonth() + 1).padStart(2, '0')}-${String(sample.getDate()).padStart(2, '0')}`;
  return (
    <>
      <SettingsGroup>
        <SettingRow label={t('settings.general.language')} help={t('settings.general.languageHelp')}>
          <Select<SupportedLocale>
            label={t('settings.general.language')}
            value={prefs.locale}
            options={SUPPORTED_LOCALES.map((locale) => ({ value: locale.id, label: locale.label }))}
            onChange={(locale) => setPreferences({ locale })}
          />
        </SettingRow>
        <SettingRow label={t('settings.general.spellcheck')} help={t('settings.general.spellcheckHelp')}>
          <Switch
            label={t('settings.general.spellcheck')}
            checked={prefs.spellcheck}
            onChange={(spellcheck) => setPreferences({ spellcheck })}
          />
        </SettingRow>
        {prefs.spellcheck && <SpellLanguages />}
      </SettingsGroup>
      <SettingsGroup title={t('settings.language.region')}>
        <SettingRow label={t('settings.language.dateFormat')} help={t('settings.language.dateFormatHelp')}>
          <Select<DateFormat>
            label={t('settings.language.dateFormat')}
            value={prefs.dateFormat}
            options={DATE_FORMATS.map((format) => ({
              value: format,
              label: t(`settings.language.dateFormats.${format}` as TranslationKey),
              detail: describeDate(sampleKey, today, format),
            }))}
            onChange={(dateFormat) => setPreferences({ dateFormat })}
          />
        </SettingRow>
        <SettingRow label={t('settings.language.autoZone')} help={t('settings.language.autoZoneHelp')}>
          <Switch
            label={t('settings.language.autoZone')}
            checked={prefs.timeZone === null}
            onChange={(automatic) => setPreferences({ timeZone: automatic ? null : systemTimeZone() })}
          />
        </SettingRow>
        <SettingRow label={t('settings.language.timeZone')}>
          <Select<string>
            label={t('settings.language.timeZone')}
            value={prefs.timeZone ?? systemTimeZone()}
            disabled={prefs.timeZone === null}
            options={zones}
            onChange={(timeZone) => setPreferences({ timeZone })}
          />
        </SettingRow>
        <SettingRow label={t('settings.general.weekStart')} help={t('settings.language.weekStartHelp')}>
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
      </SettingsGroup>
    </>
  );
}
