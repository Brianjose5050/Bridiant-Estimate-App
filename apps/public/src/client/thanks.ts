import { initReveal } from './reveal';

/** Shows the confirmed reference only when the page was opened with a valid one. */
export function initThanks(): void {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref && /^BFG-[0-9A-Z]{6}$/.test(ref)) {
    const box = document.querySelector<HTMLElement>('[data-reference-box]');
    const out = document.querySelector<HTMLElement>('[data-reference]');
    if (box && out) {
      out.textContent = ref;
      box.hidden = false;
    }
  }
  initReveal();
}
