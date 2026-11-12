import { HOME_LABELS, KIND_LABELS, SERVICE_LABELS, STATUS_LABELS, TIER_LABELS, t, type AdminLang, type TKey } from './i18n.js';

/** Escapes text for HTML. Every dynamic value in the panel goes through this function. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export function label(map: Record<string, Record<AdminLang, string>>, key: string | null | undefined, lang: AdminLang): string {
  if (!key) return '';
  return map[key]?.[lang] ?? key;
}

export function statusLabel(status: string, lang: AdminLang): string {
  return label(STATUS_LABELS, status, lang);
}

export function formatDate(iso: string | null | undefined, lang: AdminLang): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(lang === 'es' ? 'es-US' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

export function statusPill(status: string, lang: AdminLang): string {
  const cls = status === 'new' ? 'pill pill--new' : 'pill';
  return `<span class="${cls}">${esc(statusLabel(status, lang))}</span>`;
}

export function serviceNames(ids: string[], lang: AdminLang): string {
  return ids.map((id) => label(SERVICE_LABELS, id, lang)).join(', ');
}

export function homeLabel(value: string, lang: AdminLang): string {
  return label(HOME_LABELS, value, lang);
}

export { KIND_LABELS, TIER_LABELS };

export interface LayoutOptions {
  lang: AdminLang;
  title: string;
  csrf: string | null;
  signedIn: boolean;
  activeNav?: string | undefined;
  flash?: { kind: 'ok' | 'error'; text: string } | null | undefined;
  body: string;
  path: string;
}

export function layout(o: LayoutOptions): string {
  const nav = o.signedIn
    ? `<nav class="admin-nav" aria-label="Panel">
        <a href="/admin/requests" ${o.activeNav === 'requests' ? 'aria-current="page"' : ''}>${esc(t(o.lang, 'navRequests'))}</a>
        <a href="/admin/welcome" ${o.activeNav === 'welcome' ? 'aria-current="page"' : ''}>${esc(t(o.lang, 'navWelcome'))}</a>
        <a href="/admin/gallery" ${o.activeNav === 'gallery' ? 'aria-current="page"' : ''}>${esc(t(o.lang, 'navGallery'))}</a>
        <a href="/admin/status" ${o.activeNav === 'status' ? 'aria-current="page"' : ''}>${esc(t(o.lang, 'navStatus'))}</a>
      </nav>`
    : '';
  const logout = o.signedIn && o.csrf
    ? `<form method="post" action="/admin/logout" class="inline"><input type="hidden" name="csrf" value="${esc(o.csrf)}"><button class="link" type="submit">${esc(t(o.lang, 'logout'))}</button></form>`
    : '';
  const flash = o.flash ? `<p class="flash flash--${o.flash.kind}" role="status">${esc(o.flash.text)}</p>` : '';
  const other: AdminLang = o.lang === 'en' ? 'es' : 'en';
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="same-origin">
<title>${esc(o.title)} · ${esc(t(o.lang, 'appName'))}</title>
<link rel="stylesheet" href="/admin/static/tokens.css">
<link rel="stylesheet" href="/admin/static/admin.css">
</head>
<body class="admin">
<header class="admin-top">
  <div class="admin-top__inner">
    <a class="brand" href="/admin/requests">Bridiant <span>${o.lang === 'es' ? 'Panel privado' : 'Private panel'}</span></a>
    <div class="admin-top__tools">
      <a class="lang-toggle" href="/admin/lang?to=${other}&amp;next=${encodeURIComponent(o.path)}">${esc(t(o.lang, 'setLanguage'))}</a>
      ${logout}
    </div>
  </div>
  ${nav}
</header>
<main class="admin-main">
  ${flash}
  ${o.body}
</main>
</body>
</html>`;
}

export function textField(name: string, labelText: string, value: string, opts: { type?: string; required?: boolean; max?: number; help?: string; autocomplete?: string; inputmode?: string } = {}): string {
  return `<label class="field"><span>${esc(labelText)}</span>
    <input type="${opts.type ?? 'text'}" name="${esc(name)}" value="${esc(value)}"${opts.required ? ' required' : ''}${opts.max ? ` maxlength="${opts.max}"` : ''}${opts.autocomplete ? ` autocomplete="${opts.autocomplete}"` : ''}${opts.inputmode ? ` inputmode="${opts.inputmode}"` : ''}>
    ${opts.help ? `<small>${esc(opts.help)}</small>` : ''}</label>`;
}

export function selectField(name: string, labelText: string, options: Array<{ value: string; label: string }>, selected: string): string {
  return `<label class="field"><span>${esc(labelText)}</span>
    <select name="${esc(name)}">${options.map((o) => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
}

export function checkbox(name: string, labelText: string, checked: boolean): string {
  return `<label class="check"><input type="checkbox" name="${esc(name)}" value="1"${checked ? ' checked' : ''}><span>${esc(labelText)}</span></label>`;
}

export function keyText(lang: AdminLang, key: TKey): string {
  return esc(t(lang, key));
}
