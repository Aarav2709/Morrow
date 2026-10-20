import type { en } from './locales/en';

export type SupportedLocale = 'en' | 'es' | 'pt';

export interface LocaleInfo {
  id: SupportedLocale;
  label: string;
}

export const SUPPORTED_LOCALES: LocaleInfo[] = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'pt', label: 'Português' },
];

export type TranslationSchema = typeof en;

export type TranslationParams = Record<string, string | number>;

export type NestedKeyOf<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? NestedKeyOf<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

export type TranslationKey = NestedKeyOf<TranslationSchema>;
