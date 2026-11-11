import { z } from 'zod';
import { DEFAULT_LOCALE, type Locale } from './locales.js';

/** A translatable value stored as one object with an English and a Spanish entry. */
export const bilingualText = z.object({
  en: z.string(),
  es: z.string(),
});

export type BilingualText = z.infer<typeof bilingualText>;

/** Returns the text for a locale, falling back to English only when asked to. */
export function localized(
  value: BilingualText,
  locale: Locale,
  options: { fallbackToEnglish?: boolean } = {},
): string {
  const text = value[locale];
  if (text.trim().length > 0) return text;
  if (options.fallbackToEnglish === true) return value[DEFAULT_LOCALE];
  return '';
}
