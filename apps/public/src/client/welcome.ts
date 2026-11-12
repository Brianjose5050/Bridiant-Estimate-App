import { parseBlocks, type Block } from '../../../../packages/welcome/src/index';
import { initReveal } from './reveal';

/** Renders published Welcome Center chapters. Text is inserted as text nodes only, never as HTML. */
interface ChapterItem {
  id: number;
  key: string | null;
  kind: string;
  title: string;
  subtitle: string;
  body: string;
  documentUrl: string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderBlocks(blocks: Block[], section: HTMLElement): void {
  for (const block of blocks) {
    if (block.type === 'heading') {
      section.appendChild(el('h3', 'wc-heading', block.text));
    } else if (block.type === 'paragraph') {
      section.appendChild(el('p', block.emphasis ? 'wc-quote' : 'wc-text', block.text));
    } else if (block.type === 'list') {
      const ul = el('ul', 'wc-list');
      block.items.forEach((item) => ul.appendChild(el('li', '', item)));
      section.appendChild(ul);
    } else {
      const dl = el('dl', 'wc-pairs');
      block.items.forEach((item) => {
        dl.appendChild(el('dt', '', item.label));
        dl.appendChild(el('dd', '', item.text));
      });
      section.appendChild(dl);
    }
  }
}

export function initWelcome(): void {
  initReveal(document);
  const root = document.getElementById('wc-chapters');
  const chips = document.getElementById('wc-chips');
  const status = document.getElementById('wc-status');
  if (!root || !chips) return;
  const lang = root.dataset.lang === 'es' ? 'es' : 'en';
  const openDoc = root.dataset.openDoc ?? '';

  fetch(`/api/welcome?lang=${lang}`, { headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? (response.json() as Promise<{ items?: ChapterItem[] }>) : null))
    .then((data) => {
      const items = data?.items ?? [];
      if (items.length === 0) return;
      if (status) status.hidden = true;
      chips.hidden = false;
      items.forEach((item, index) => {
        const id = `chapter-${index + 1}`;
        const number = String(index + 1).padStart(2, '0');
        const chip = el('a', 'wc-chip', `${number}  ${item.title}`);
        chip.href = `#${id}`;
        chips.appendChild(chip);

        const section = el('section', 'wc-chapter reveal');
        section.id = id;
        section.appendChild(el('p', 'wc-number', number));
        section.appendChild(el('h2', 'serif wc-title', item.title));
        if (item.subtitle) section.appendChild(el('p', 'wc-subtitle', item.subtitle));
        renderBlocks(parseBlocks(item.body), section);
        if (item.documentUrl) {
          const link = el('a', 'btn btn--ghost wc-doc', openDoc);
          link.href = item.documentUrl;
          link.target = '_blank';
          link.rel = 'noopener';
          section.appendChild(link);
        }
        root.appendChild(section);
      });
      initReveal(root);
    })
    .catch(() => {
      /* Service unavailable: the guidance text stays visible. */
    });
}
