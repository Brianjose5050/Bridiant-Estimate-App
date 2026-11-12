export { LOCALES, DEFAULT_LOCALE, LOCALE_NAMES, isLocale, type Locale } from './locales.js';
export { bilingualText, localized, type BilingualText } from './bilingual.js';
export { PLACEHOLDER_PREFIX, placeholder, isPlaceholder } from './placeholders.js';
export {
  checkField,
  checkEntityPublishable,
  type LocaleStatus,
  type LocalizedField,
  type PublishIssue,
  type PublishResult,
} from './publish-gate.js';
export { CATALOG, t, catalogProblems, type CatalogKey, type CatalogStatus } from './catalog.js';
