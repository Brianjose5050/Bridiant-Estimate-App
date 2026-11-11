import servicesSeed from '../../../../content/seed/services.json';
import copySeed from '../../../../content/seed/copy.json';
import gallerySeed from '../../../../content/seed/gallery.json';
import { CATALOG, type CatalogKey } from '../../../../packages/i18n/src/catalog';

export type Lang = 'en' | 'es';
export const LANGS: Lang[] = ['en', 'es'];

/**
 * 'preview': local review build. Pending content is visible and labelled.
 * 'production': only owner-approved content is generated. Pending pages are not built.
 */
export const MODE: 'preview' | 'production' =
  process.env.SITE_MODE === 'production' ? 'production' : 'preview';

type Status = { en: string; es: string };

export interface Service {
  slug: { en: string; es: string };
  name: { en: string; es: string };
  tagline: { en: string; es: string };
  summary: { en: string; es: string };
  note: { en: string; es: string } | null;
  includedGroups: { title: { en: string; es: string }; items: { en: string; es: string }[] }[];
  addOns: { en: string; es: string }[];
  status: Status;
  visible: boolean;
  id: string;
}

export const services: Service[] = (servicesSeed.services as unknown as Omit<Service, 'id'>[]).map((s) => ({
  ...s,
  id: s.slug.en,
}));

export const addOnsIntro = servicesSeed.addOnsIntro as { en: string; es: string };

/** Approved in this language, or always true in preview mode. */
export function isShown(status: Status | undefined, lang: Lang): boolean {
  return MODE === 'preview' || status?.[lang] === 'approved';
}

/** Preview-only label for pending content. Never generated in production. */
export function isPending(status: Status | undefined, lang: Lang): boolean {
  return status?.[lang] !== 'approved';
}

type CopyItem = { en: string; es: string; status: Status };
const copy = copySeed as unknown as Record<string, unknown>;

/** Reads a copy item by path, for example 'home.headline'. Returns null if missing. */
export function copyItem(path: string): CopyItem | null {
  const value = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], copy);
  return (value as CopyItem) ?? null;
}

/** Returns the text for a copy item, or null when it is hidden in this mode. */
export function text(path: string, lang: Lang): string | null {
  const item = copyItem(path);
  if (!item) return null;
  return isShown(item.status, lang) ? item[lang] : null;
}

export function ui(key: CatalogKey, lang: Lang): string {
  return CATALOG[key][lang];
}

export function serviceFor(id: string): Service | undefined {
  return services.find((s) => s.id === id);
}

export function serviceSlugFor(service: Service, lang: Lang): string {
  return service.slug[lang];
}

export const pages = {
  home: '',
  about: 'about/',
  services: 'services/',
  work: 'our-work/',
  standards: 'cleaning-standards/',
  welcome: 'welcome/',
  request: 'request-estimate/',
  privacy: 'privacy/',
  terms: 'terms/',
} as const;

export function href(lang: Lang, page: string): string {
  return `/${lang}/${page}`;
}

export const photos = gallerySeed.items.map((item) => ({
  id: item.id,
  file: item.file,
  kind: item.kind,
  visible: item.visible,
  deleted: item.deleted,
  sortOrder: item.sortOrder,
}));

export const estimateNotReceivedMessage = (lang: Lang) => CATALOG['status.notReceived'][lang];

/**
 * Production gate for whole pages. A page is generated only when every listed copy item is
 * approved in this language (or always in preview mode).
 */
export function ready(lang: Lang, keys: string[]): boolean {
  if (MODE === 'preview') return true;
  return keys.every((key) => copyItem(key)?.status?.[lang] === 'approved');
}

export function servicesReady(lang: Lang): boolean {
  return MODE === 'preview' || services.every((s) => s.status[lang] === 'approved');
}
