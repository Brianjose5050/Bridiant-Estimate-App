import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPlaceholder } from '../../packages/i18n/src/index.js';

const settingsPath = fileURLToPath(new URL('../seed/site-settings.json', import.meta.url));
const pricingPath = fileURLToPath(new URL('../seed/pricing-rules.json', import.meta.url));

type Entry = { value: unknown; status?: Record<string, string> };

function bilingualValues(obj: Record<string, unknown>): string[] {
  return Object.entries(obj)
    .filter(([key]) => !key.startsWith('_'))
    .flatMap(([, entry]) => {
      const value = (entry as Entry).value;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.values(value as Record<string, string>);
      }
      return [];
    });
}

describe('seed content: no invented business information', () => {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;

  it('every bilingual business value is a placeholder, except the approved-for-review tagline', () => {
    for (const [key, entry] of Object.entries(settings)) {
      if (key.startsWith('_') || key === 'schemaVersion') continue;
      const value = (entry as Entry).value;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [locale, text] of Object.entries(value as Record<string, string>)) {
          if (key === 'tagline' && locale === 'en') continue;
          expect(isPlaceholder(text), `${key}.${locale} must be a placeholder`).toBe(true);
        }
      }
    }
  });

  it('English tagline matches the brand brief exactly and is marked pending approval', () => {
    const tagline = settings['tagline'] as Entry & { value: { en: string } };
    expect(tagline.value.en).toBe('The Standard, Quietly Kept.');
    expect(tagline.status?.['en']).toBe('pending_approval');
  });

  it('contact values and notification recipients are empty or placeholders', () => {
    const recipients = (settings['notificationRecipients'] as Entry).value;
    expect(recipients).toEqual([]);
    expect(bilingualValues(settings).length).toBeGreaterThan(0);
  });

  it('pricing seed is empty and contains no rate values', () => {
    const pricing = JSON.parse(readFileSync(pricingPath, 'utf8')) as {
      rateVersion: unknown;
      rules: unknown[];
      discounts: unknown[];
      credits: unknown[];
    };
    expect(pricing.rateVersion).toBeNull();
    expect(pricing.rules).toEqual([]);
    expect(pricing.discounts).toEqual([]);
    expect(pricing.credits).toEqual([]);
  });
});
