import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPlaceholder } from '../../packages/i18n/src/index.js';

const servicesPath = fileURLToPath(new URL('../seed/services.json', import.meta.url));

interface SeedService {
  slug: { en: string; es: string };
  name: { value: { en: string; es: string }; status: Record<string, string> };
  summary: { value: { en: string; es: string } };
  visible: boolean;
}

const seed = JSON.parse(readFileSync(servicesPath, 'utf8')) as {
  sector: string;
  services: SeedService[];
};

describe('services seed: residential cleaning only, four services', () => {
  it('is residential only', () => {
    expect(seed.sector).toBe('residential');
  });

  it('contains exactly the four approved service names in English', () => {
    expect(seed.services.map((s) => s.name.value.en)).toEqual([
      'Standard Cleaning',
      'Deep Cleaning',
      'Move-In Cleaning',
      'Move-Out Cleaning',
    ]);
  });

  it('has a Spanish name and slug for every service', () => {
    for (const service of seed.services) {
      expect(service.name.value.es.trim().length).toBeGreaterThan(0);
      expect(service.slug.es.trim().length).toBeGreaterThan(0);
      expect(service.slug.en).toMatch(/^[a-z0-9-]+$/);
      expect(service.slug.es).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('keeps every description as a placeholder and every service hidden until approved', () => {
    for (const service of seed.services) {
      expect(isPlaceholder(service.summary.value.en)).toBe(true);
      expect(isPlaceholder(service.summary.value.es)).toBe(true);
      expect(service.visible).toBe(false);
    }
  });

  it('contains no commercial-only service names', () => {
    const text = JSON.stringify(seed).toLowerCase();
    for (const term of ['office', 'medical', 'industrial', 'retail', 'commercial']) {
      expect(text).not.toContain(term);
    }
  });
});
