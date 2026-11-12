import type { Locale } from './locales.js';

/**
 * Interface strings (navigation labels, buttons, state messages).
 *
 * Every entry is "proposed": it is a generic interface label written for review.
 * Each entry must be approved by the owner (in both languages) before go-live.
 * The Spanish text is a draft until a named reviewer approves it.
 * This catalog contains no company-specific content.
 */
export type CatalogStatus = 'proposed' | 'approved';

export interface CatalogEntry {
  en: string;
  es: string;
  status: Record<Locale, CatalogStatus>;
}

export const CATALOG = {
  'nav.home': { en: 'Home', es: 'Inicio' },
  'nav.about': { en: 'About Us', es: 'Nosotros' },
  'nav.ourWork': { en: 'Our Work', es: 'Nuestro trabajo' },
  'nav.services': { en: 'Our Services', es: 'Nuestros servicios' },
  'nav.standards': { en: 'Cleaning Standards', es: 'Estándares de limpieza' },
  'nav.requestEstimate': { en: 'Request an Estimate', es: 'Solicitar un estimado' },
  'nav.welcome': { en: 'Welcome Center', es: 'Centro de bienvenida' },
  'lang.switcherLabel': { en: 'Language', es: 'Idioma' },
  'form.next': { en: 'Next', es: 'Siguiente' },
  'form.back': { en: 'Back', es: 'Atrás' },
  'form.submit': { en: 'Send request', es: 'Enviar solicitud' },
  'form.required': { en: 'This field is required.', es: 'Este campo es obligatorio.' },
  'status.notReceived': {
    en: 'We could not send your request just now. Your answers are still saved on this device.',
    es: 'No pudimos enviar su solicitud en este momento. Sus respuestas siguen guardadas en este dispositivo.',
  },
} as const satisfies Record<string, { en: string; es: string }>;

export type CatalogKey = keyof typeof CATALOG;

export function t(key: CatalogKey, locale: Locale): string {
  return CATALOG[key][locale];
}

export function catalogProblems(): string[] {
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(CATALOG)) {
    if (entry.en.trim() === '') problems.push(`${key}: English is empty`);
    if (entry.es.trim() === '') problems.push(`${key}: Spanish is empty`);
  }
  return problems;
}
