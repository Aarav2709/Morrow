import { describe, expect, it } from 'vitest';
import { en } from './locales/en';
import { es } from './locales/es';
import { pt } from './locales/pt';
import { t } from './index';

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v as Record<string, unknown>, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

describe('i18n locales', () => {
  it('has matching keys between en, es and pt dictionaries', () => {
    const enKeys = collectKeys(en).sort();
    const esKeys = collectKeys(es).sort();
    const ptKeys = collectKeys(pt).sort();
    expect(esKeys).toEqual(enKeys);
    expect(ptKeys).toEqual(enKeys);
  });

  it('interpolates parameters correctly', () => {
    const result = t('home.dayStreak', { count: 7 }, 'en');
    expect(result).toBe('7 day streak');

    const resultEs = t('home.dayStreak', { count: 7 }, 'es');
    expect(resultEs).toBe('Racha de 7 días');

    const resultPt = t('home.dayStreak', { count: 7 }, 'pt');
    expect(resultPt).toBe('Sequência de 7 dias');
  });

  it('translates common keys into spanish', () => {
    expect(t('common.cancel', undefined, 'en')).toBe('Cancel');
    expect(t('common.cancel', undefined, 'es')).toBe('Cancelar');
    expect(t('sidebar.today', undefined, 'es')).toBe('Hoy');
    expect(t('settings.general.title', undefined, 'es')).toBe('General');
  });

  it('translates common keys into portuguese', () => {
    expect(t('common.cancel', undefined, 'pt')).toBe('Cancelar');
    expect(t('common.save', undefined, 'pt')).toBe('Salvar');
    expect(t('sidebar.today', undefined, 'pt')).toBe('Hoje');
    expect(t('settings.title', undefined, 'pt')).toBe('Configurações');
    expect(t('settings.sections.appearance', undefined, 'pt')).toBe('Aparência');
  });
});
