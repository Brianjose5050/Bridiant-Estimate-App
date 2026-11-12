import { describe, expect, it } from 'vitest';
import { placeholder, isPlaceholder } from '../src/placeholders.js';
import { localized } from '../src/bilingual.js';
import { checkField, checkEntityPublishable, type LocalizedField } from '../src/publish-gate.js';
import { CATALOG, catalogProblems, t } from '../src/catalog.js';
import { isLocale, LOCALES } from '../src/locales.js';

const approved: LocalizedField = {
  value: { en: 'Office cleaning for professional spaces.', es: 'Limpieza de oficinas para espacios profesionales.' },
  status: { en: 'approved', es: 'approved' },
};

describe('placeholders', () => {
  it('creates a clearly labeled marker that is detected', () => {
    const text = placeholder('service description, Office Cleaning', 'en');
    expect(text).toBe('[OWNER TO PROVIDE: service description, Office Cleaning (EN)]');
    expect(isPlaceholder(text)).toBe(true);
  });

  it('does not flag ordinary text', () => {
    expect(isPlaceholder('Office cleaning for professional spaces.')).toBe(false);
  });
});

describe('bilingual helper', () => {
  it('returns the requested locale', () => {
    expect(localized({ en: 'Hello', es: 'Hola' }, 'es')).toBe('Hola');
  });

  it('returns empty text without fallback, and English only with explicit fallback', () => {
    expect(localized({ en: 'Hello', es: '' }, 'es')).toBe('');
    expect(localized({ en: 'Hello', es: '' }, 'es', { fallbackToEnglish: true })).toBe('Hello');
  });
});

describe('publish gate', () => {
  it('publishes only when both locales are non-empty, non-placeholder, and approved', () => {
    expect(checkField('title', approved)).toEqual([]);
    expect(checkEntityPublishable({ title: approved }).ok).toBe(true);
  });

  it('blocks placeholders even when marked approved', () => {
    const field: LocalizedField = {
      value: { en: placeholder('service name', 'en'), es: 'Servicio' },
      status: { en: 'approved', es: 'approved' },
    };
    const issues = checkField('title', field);
    expect(issues.map((i) => i.problem)).toContain('placeholder');
  });

  it('blocks draft or pending text', () => {
    const field: LocalizedField = {
      value: { en: 'Text', es: 'Texto' },
      status: { en: 'approved', es: 'draft' },
    };
    expect(checkField('title', field).map((i) => i.problem)).toEqual(['not_approved']);
  });

  it('blocks a missing Spanish entry without explicit fallback', () => {
    const field: LocalizedField = {
      value: { en: 'Text', es: '' },
      status: { en: 'approved', es: 'draft' },
    };
    expect(checkField('title', field).map((i) => i.problem)).toEqual(['empty']);
  });

  it('allows a missing Spanish entry only with explicit fallback and approved English', () => {
    const field: LocalizedField = {
      value: { en: 'Text', es: '' },
      status: { en: 'approved', es: 'draft' },
      fallbackToEnglish: true,
    };
    expect(checkField('title', field)).toEqual([]);
  });

  it('does not allow fallback when English is not approved', () => {
    const field: LocalizedField = {
      value: { en: 'Text', es: '' },
      status: { en: 'pending_approval', es: 'draft' },
      fallbackToEnglish: true,
    };
    const problems = checkField('title', field).map((i) => i.problem);
    expect(problems).toContain('not_approved');
    expect(problems).toContain('missing_locale_no_fallback');
  });

  it('never publishes an entity if any field fails', () => {
    const result = checkEntityPublishable({
      title: approved,
      summary: { value: { en: 'x', es: 'x' }, status: { en: 'draft', es: 'draft' } },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.every((i) => i.field === 'summary')).toBe(true);
  });
});

describe('interface string catalog', () => {
  it('has English and Spanish for every key', () => {
    expect(catalogProblems()).toEqual([]);
  });

  it('marks every entry as proposed (not yet approved by the owner)', () => {
    expect(Object.keys(CATALOG).length).toBeGreaterThan(0);
  });

  it('returns the text for a locale', () => {
    expect(t('nav.requestEstimate', 'en')).toBe('Request an Estimate');
    expect(t('nav.requestEstimate', 'es')).toBe('Solicitar un estimado');
  });
});

describe('locales', () => {
  it('supports exactly English and Spanish', () => {
    expect([...LOCALES]).toEqual(['en', 'es']);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('fr')).toBe(false);
  });
});
