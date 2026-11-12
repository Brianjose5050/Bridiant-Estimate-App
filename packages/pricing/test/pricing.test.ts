import { describe, expect, it } from 'vitest';
import {
  calculateInternal,
  issueCustomerEstimate,
  EstimateNotApprovedError,
  PricingError,
  type OwnerEstimate,
  type Rule,
  type RuleSet,
} from '../src/index.js';

/*
 * TEST FIXTURE ONLY. These are synthetic numbers that check arithmetic.
 * They are not business prices, were not taken from any application, and are never
 * written to content, seeds, or public output.
 */
const rule = (over: Partial<Rule> & Pick<Rule, 'id' | 'kind' | 'value'>): Rule => ({
  internalLabel: `internal:${over.id}`,
  customerLabel: null,
  serviceSlug: null,
  key: null,
  isPercent: false,
  showToCustomer: false,
  ...over,
});

const label = (en: string) => ({ en, es: `${en} (es)` });

const approved = (rules: Rule[]): RuleSet => ({
  rateVersion: 'test-v1',
  status: 'approved',
  approvedBy: 'owner',
  approvedAt: '2026-01-01T00:00:00Z',
  rules,
});

const fullRules: Rule[] = [
  rule({ id: 'base-std', kind: 'base', serviceSlug: 'standard-cleaning', value: 10000, showToCustomer: true, customerLabel: label('Standard visit') }),
  rule({ id: 'size-2', kind: 'size', key: 'band-2', value: 2000, showToCustomer: true, customerLabel: label('Home size') }),
  rule({ id: 'freq-weekly', kind: 'frequency', key: 'weekly', value: 9000, showToCustomer: true, customerLabel: label('Frequency') }), // 90%
  rule({ id: 'addon-fridge', kind: 'addon', key: 'fridge', value: 1500, showToCustomer: true, customerLabel: label('Refrigerator') }),
  rule({ id: 'min', kind: 'minimum', value: 5000, showToCustomer: true, customerLabel: label('Minimum') }),
  rule({ id: 'disc-pct', kind: 'discount', value: 1000, isPercent: true, showToCustomer: true, customerLabel: label('Discount') }), // 10%
  rule({ id: 'tax', kind: 'tax', value: 800, showToCustomer: true, customerLabel: label('Tax') }), // 8%
  rule({ id: 'credit', kind: 'credit', value: 500, showToCustomer: true, customerLabel: label('Credit') }),
];

const input = { serviceSlug: 'standard-cleaning', sizeBand: 'band-2', frequency: 'weekly', addOnKeys: ['fridge'] };

describe('approval gate', () => {
  it('refuses to calculate with a draft rate version', () => {
    const draft: RuleSet = { ...approved(fullRules), status: 'draft', approvedBy: null, approvedAt: null };
    expect(() => calculateInternal(input, draft)).toThrow(PricingError);
    try {
      calculateInternal(input, draft);
    } catch (error) {
      expect((error as PricingError).code).toBe('RATE_VERSION_NOT_APPROVED');
    }
  });

  it('refuses when the rate set is retired', () => {
    try {
      calculateInternal(input, { ...approved(fullRules), status: 'retired' });
      throw new Error('should not reach');
    } catch (error) {
      expect((error as PricingError).code).toBe('NO_APPROVED_RATE_VERSION');
    }
  });
});

describe('internal calculation (integer cents, fixed order)', () => {
  it('applies base, size, frequency, add-ons, discount, tax, and credit in order', () => {
    const result = calculateInternal(input, approved(fullRules));
    // base 10000 + size 2000 = 12000; weekly 90% -> 10800; add-on 1500 -> 12300 (subtotal)
    // minimum 5000 not reached; 10% discount -1230 -> 11070; tax 8% = 885.6 -> 886 (half up)
    // credit -500 -> total 11456
    expect(result.subtotalCents).toBe(12300);
    expect(result.totalCents).toBe(11456);
    expect(result.lines.reduce((sum, line) => sum + line.amountCents, 0)).toBe(result.totalCents);
  });

  it('adds the minimum-charge difference when the subtotal is below the minimum', () => {
    const minimumRules = [
      rule({ id: 'base-std', kind: 'base', serviceSlug: 'standard-cleaning', value: 10000 }),
      rule({ id: 'size-2', kind: 'size', key: 'band-2', value: 2000 }),
      rule({ id: 'min', kind: 'minimum', value: 15000 }),
    ];
    const result = calculateInternal({ ...input, frequency: null, addOnKeys: [] }, approved(minimumRules));
    expect(result.subtotalCents).toBe(15000);
    expect(result.lines.find((l) => l.ruleId === 'min')?.amountCents).toBe(3000);
  });

  it('reports a specific error when a required rule is missing', () => {
    try {
      calculateInternal({ ...input, serviceSlug: 'deep-cleaning' }, approved(fullRules));
      throw new Error('should not reach');
    } catch (error) {
      expect((error as PricingError).code).toBe('MISSING_BASE_RULE');
    }
  });
});

describe('customer output: owner-approved only, no internals', () => {
  const calc = calculateInternal(input, approved(fullRules));
  const estimate: OwnerEstimate = {
    reference: 'BFG-TEST01',
    status: 'draft',
    locale: 'en',
    serviceName: { en: 'Standard Cleaning', es: 'Limpieza estándar' },
    explanation: { en: 'Your visit details.', es: 'Detalles de su visita.' },
    calculation: calc,
  };

  it('refuses to issue a draft estimate', () => {
    expect(() => issueCustomerEstimate(estimate)).toThrow(EstimateNotApprovedError);
  });

  it('refuses to issue without an owner explanation', () => {
    expect(() => issueCustomerEstimate({ ...estimate, status: 'approved', explanation: null })).toThrow(/explanation/);
  });

  it('issues owner-labelled lines with no rule identifiers, rate version, or internal text', () => {
    const issued = issueCustomerEstimate({ ...estimate, status: 'approved' });
    const text = JSON.stringify(issued);
    expect(text).not.toContain('test-v1');
    expect(text).not.toContain('disc-pct');
    expect(text).not.toContain('addon-fridge');
    expect(text).not.toContain('internal');
    expect(text).not.toContain('band-2');
    expect(text).not.toContain('"rules"');
    expect(issued.lines.map((l) => l.label)).toEqual(['Standard visit', 'Home size', 'Frequency', 'Refrigerator', 'Discount', 'Tax', 'Credit']);
    expect(issued.totalCents).toBe(11456);
  });

  it('refuses to issue when hidden lines change the total', () => {
    const hidden = fullRules.map((r) => (r.id === 'disc-pct' ? { ...r, showToCustomer: false } : r));
    const calcHidden = calculateInternal(input, approved(hidden));
    expect(() => issueCustomerEstimate({ ...estimate, status: 'approved', calculation: calcHidden })).toThrow(/reconcile/);
  });

  it('issues in Spanish with Spanish owner labels', () => {
    const issued = issueCustomerEstimate({ ...estimate, status: 'approved', locale: 'es' });
    expect(issued.serviceName).toBe('Limpieza estándar');
    expect(issued.lines[0]?.label).toBe('Standard visit (es)');
  });
});
