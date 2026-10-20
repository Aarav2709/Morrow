import { getPreferences, usePreferences } from '../platform/preferences';
import { en } from './locales/en';
import { es } from './locales/es';
import { pt } from './locales/pt';
import type { SupportedLocale, TranslationKey, TranslationParams, TranslationSchema } from './types';

export * from './types';

const dictionaries: Record<SupportedLocale, TranslationSchema> = {
  en,
  es,
  pt,
};

function resolvePath(obj: unknown, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, key) => {
    return key in params ? String(params[key]) : `{${key}}`;
  });
}

export function getLocale(): SupportedLocale {
  return getPreferences().locale;
}

export function t(
  key: TranslationKey,
  params?: TranslationParams,
  localeOverride?: SupportedLocale,
): string {
  const locale = localeOverride ?? getLocale();
  const dict = dictionaries[locale] ?? dictionaries.en;
  let text = resolvePath(dict, key);
  if (text === undefined && locale !== 'en') {
    text = resolvePath(dictionaries.en, key);
  }
  return interpolate(text ?? key, params);
}

export function tAction(actionId: string, fallback?: string, localeOverride?: SupportedLocale): string {
  const key = `actions.items.${actionId.replace(/\./g, '_')}` as TranslationKey;
  const text = t(key, undefined, localeOverride);
  return text !== key ? text : (fallback ?? actionId);
}

export function useTranslation() {
  const prefs = usePreferences();
  const locale = prefs.locale;
  return {
    locale,
    t: (key: TranslationKey, params?: TranslationParams) => t(key, params, locale),
    tAction: (actionId: string, fallback?: string) => tAction(actionId, fallback, locale),
  };
}
