import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { formatShortcut } from '../actions';
import { t } from '../i18n';
import type { TranslationKey } from '../i18n';
import { ACCENTS, setPreferences, usePreferences } from '../platform/preferences';
import type { ThemePreference, WritingFont } from '../platform/preferences';
import { closeDialog } from '../ui';
import { Dialog } from './primitives';

// the first time morrow opens it asks what to call you and how it should look, then shows the few things
// worth knowing. every answer can be changed later in settings
export function WelcomeDialog() {
  const prefs = usePreferences();
  const [step, setStep] = useState(0);
  const finish = () => {
    setPreferences({ onboarded: true });
    closeDialog();
  };
  const steps = [
    <div key="name" className="welcome-step">
      <p>{t('welcome.intro')}</p>
      <label className="field">
        <span>{t('welcome.nameQuestion')}</span>
        <input
          className="text-input"
          data-autofocus
          maxLength={60}
          placeholder={t('settings.general.yourNamePlaceholder')}
          defaultValue={prefs.name}
          onChange={(event) => setPreferences({ name: event.target.value.trim() })}
          onKeyDown={(event) => event.key === 'Enter' && setStep(1)}
        />
      </label>
    </div>,
    <div key="look" className="welcome-step">
      <span className="welcome-label">{t('settings.appearance.theme')}</span>
      <Choice<ThemePreference>
        value={prefs.theme}
        options={[
          ['system', t('settings.appearance.themes.system')],
          ['light', t('settings.appearance.themes.light')],
          ['dark', t('settings.appearance.themes.dark')],
        ]}
        onChange={(theme) => setPreferences({ theme })}
      />
      <span className="welcome-label">{t('settings.appearance.accentColour')}</span>
      <div className="accent-swatches" role="radiogroup" aria-label={t('settings.appearance.accentColour')}>
        {ACCENTS.filter((accent) => accent !== 'custom').map((accent) => {
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
      <span className="welcome-label">{t('settings.appearance.font')}</span>
      <Choice<WritingFont>
        value={prefs.font}
        options={[
          ['serif', t('settings.appearance.fonts.serif')],
          ['sans', t('settings.appearance.fonts.sans')],
          ['mono', t('settings.appearance.fonts.mono')],
        ]}
        onChange={(font) => setPreferences({ font })}
      />
    </div>,
    <div key="tips" className="welcome-step">
      <ul className="welcome-tips">
        <li>{t('welcome.tipSlash')}</li>
        <li>{t('welcome.tipLinks')}</li>
        <li>{t('welcome.tipDates')}</li>
        <li>{t('welcome.tipSearch', { shortcut: formatShortcut('Mod+K') })}</li>
        <li>{t('welcome.tipToday', { shortcut: formatShortcut('Alt+D') })}</li>
        <li>{t('welcome.tipFiles')}</li>
      </ul>
    </div>,
  ];
  const titles = [t('welcome.title'), t('welcome.lookTitle'), t('welcome.tipsTitle')];
  const last = step === steps.length - 1;
  return (
    <Dialog
      title={titles[step]!}
      onClose={finish}
      footer={
        <div className="welcome-footer">
          <span className="muted small">
            {step + 1} / {steps.length}
          </span>
          {step > 0 && (
            <button type="button" className="button" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={14} /> {t('welcome.back')}
            </button>
          )}
          <button
            type="button"
            className="button primary"
            onClick={() => (last ? finish() : setStep(step + 1))}
          >
            {last ? t('welcome.start') : t('welcome.next')} {!last && <ArrowRight size={14} />}
          </button>
        </div>
      }
    >
      {steps[step]}
    </Dialog>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(([option, label]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          className={value === option ? 'is-active' : ''}
          onClick={() => onChange(option)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
