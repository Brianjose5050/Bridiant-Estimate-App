import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const servicesPath = fileURLToPath(new URL('../seed/services.json', import.meta.url));

interface Bilingual { en: string; es: string }
interface Group { title: Bilingual; items: Bilingual[] }
interface Service {
  slug: Bilingual;
  name: Bilingual;
  tagline: Bilingual;
  summary: Bilingual;
  includedGroups: Group[];
  addOns: Bilingual[];
  status: { en: string; es: string };
  visible: boolean;
}

const seed = JSON.parse(readFileSync(servicesPath, 'utf8')) as {
  sector: string;
  services: Service[];
};

describe('services seed: residential cleaning, four services', () => {
  it('is residential only', () => {
    expect(seed.sector).toBe('residential');
  });

  it('contains exactly the four service names in English', () => {
    expect(seed.services.map((s) => s.name.en)).toEqual([
      'Standard Cleaning',
      'Deep Cleaning',
      'Move-In Cleaning',
      'Move-Out Cleaning',
    ]);
  });

  it('has a Spanish name and valid slugs for every service', () => {
    for (const service of seed.services) {
      expect(service.name.es.trim().length).toBeGreaterThan(0);
      expect(service.slug.en).toMatch(/^[a-z0-9-]+$/);
      expect(service.slug.es).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('has bilingual taglines, summaries, and at least one checklist group', () => {
    for (const service of seed.services) {
      for (const locale of ['en', 'es'] as const) {
        expect(service.tagline[locale].trim().length).toBeGreaterThan(0);
        expect(service.summary[locale].trim().length).toBeGreaterThan(0);
      }
      expect(service.includedGroups.length).toBeGreaterThan(0);
      for (const group of service.includedGroups) {
        expect(group.items.length).toBeGreaterThan(0);
        for (const item of group.items) {
          expect(item.en.trim().length).toBeGreaterThan(0);
          expect(item.es.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps every service hidden and pending approval, with Spanish as a draft', () => {
    for (const service of seed.services) {
      expect(service.visible).toBe(false);
      expect(service.status.en).toBe('pending_approval');
      expect(service.status.es).toBe('draft');
    }
  });

  it('lists the add-ons from the source checklists, without any prices', () => {
    const standard = seed.services.find((s) => s.slug.en === 'standard-cleaning');
    expect(standard?.addOns.length).toBe(15);
    const text = JSON.stringify(seed).toLowerCase();
    expect(text).not.toMatch(/\$|\busd\b|\bprice\b|\brate\b/);
  });

  it('contains no commercial-only terms', () => {
    const text = JSON.stringify(seed).toLowerCase();
    for (const term of ['office', 'medical', 'industrial', 'retail', 'commercial']) {
      expect(text).not.toContain(term);
    }
  });
});
