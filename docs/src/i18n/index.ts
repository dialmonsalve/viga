import { en } from './en';
import { es, type Dictionary } from './es';
import { pt } from './pt';

export const LANGS = ['es', 'en', 'pt'] as const;

export type Lang = (typeof LANGS)[number];

export const LANG_TAGS: Record<Lang, string> = { es: 'es', en: 'en', pt: 'pt-BR' };

export const LANG_NAMES: Record<Lang, string> = { es: 'Español', en: 'English', pt: 'Português' };

const dictionaries: Record<Lang, Dictionary> = { es, en, pt };

export function getDictionary(lang: Lang): Dictionary {
  return dictionaries[lang];
}
