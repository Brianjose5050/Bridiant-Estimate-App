/** Subtle entrance for elements marked .reveal. Immediate when the user prefers reduced motion. */
export function initReveal(scope: ParentNode = document): void {
  const targets = Array.from(scope.querySelectorAll<HTMLElement>('.reveal'));
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    targets.forEach((node) => node.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  targets.forEach((node) => observer.observe(node));
}
