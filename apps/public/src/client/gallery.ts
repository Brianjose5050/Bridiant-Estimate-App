import { initReveal } from './reveal';

/** Renders published gallery items from the private server. Only approved, published items are returned. */
interface Photo { id: number; src: string; alt: string; caption: string }
interface GalleryItem { type: 'single' | 'pair'; id: string; projectTitle: string | null; serviceId: string | null; photos: Photo[] }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderPair(item: GalleryItem, lang: string): HTMLElement {
  const [before, after] = item.photos;
  const figure = el('figure', 'compare reveal');
  figure.style.setProperty('--pos', '50%');
  const beforeImg = el('img');
  beforeImg.src = before?.src ?? '';
  beforeImg.alt = before?.alt ?? '';
  beforeImg.loading = 'lazy';
  const afterImg = el('img', 'after');
  afterImg.src = after?.src ?? '';
  afterImg.alt = after?.alt ?? '';
  afterImg.loading = 'lazy';
  const handle = el('span', 'handle');
  handle.setAttribute('aria-hidden', 'true');
  const labelBefore = el('span', 'label before', lang === 'es' ? 'Antes' : 'Before');
  const labelAfter = el('span', 'label after', lang === 'es' ? 'Después' : 'After');
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.value = '50';
  range.setAttribute('aria-label', lang === 'es' ? 'Comparar antes y después' : 'Compare before and after');
  range.addEventListener('input', () => figure.style.setProperty('--pos', `${range.value}%`));
  figure.append(beforeImg, afterImg, handle, labelBefore, labelAfter, range);
  return figure;
}

function renderSingle(item: GalleryItem): HTMLElement {
  const photo = item.photos[0];
  const figure = el('figure', 'reveal');
  figure.style.margin = '0';
  figure.style.display = 'grid';
  figure.style.gap = '10px';
  const img = el('img');
  img.src = photo?.src ?? '';
  img.alt = photo?.alt ?? '';
  img.loading = 'lazy';
  img.style.width = '100%';
  img.style.aspectRatio = '4 / 5';
  img.style.objectFit = 'cover';
  img.style.borderRadius = '14px';
  figure.appendChild(img);
  if (photo?.caption) figure.appendChild(el('figcaption', 'small', photo.caption));
  return figure;
}

export function initGallery(): void {
  const root = document.getElementById('gallery-live');
  if (!root) return;
  const lang = root.dataset.lang === 'es' ? 'es' : 'en';
  const empty = document.getElementById('gallery-empty');
  fetch(`/api/gallery?lang=${lang}`, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<{ items?: GalleryItem[] }>) : null))
    .then((data) => {
      const items = data?.items ?? [];
      if (items.length === 0) return;
      if (empty) empty.hidden = true;
      const grid = el('div', 'grid grid--2');
      for (const item of items) {
        const card = el('section', 'stack');
        if (item.projectTitle) card.appendChild(el('h2', 'serif', item.projectTitle));
        card.appendChild(item.type === 'pair' ? renderPair(item, lang) : renderSingle(item));
        grid.appendChild(card);
      }
      root.appendChild(grid);
      initReveal(root);
    })
    .catch(() => {
      /* Service unavailable: the introduction stays visible. */
    });
}
