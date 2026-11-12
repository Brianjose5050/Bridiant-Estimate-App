import type { Locale } from './locales.js';

/**
 * Placeholder marker used for any business information the owner has not supplied.
 * Placeholders are visible in the admin and can never be published.
 */
export const PLACEHOLDER_PREFIX = '[OWNER TO PROVIDE:';

const PLACEHOLDER_PATTERN = /\[OWNER TO PROVIDE:[^\]]*\]/;

export function placeholder(item: string, locale: Locale): string {
  return `${PLACEHOLDER_PREFIX} ${item} (${locale.toUpperCase()})]`;
}

export function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERN.test(text);
}
