import {
  PricingError,
  type CalculationLine,
  type EstimateInput,
  type InternalCalculation,
  type Rule,
  type RuleSet,
} from './types.js';

const BPS = 10000;

/** Rounds half away from zero, on integer cents, to avoid float drift. */
function applyBps(cents: number, bps: number): number {
  const product = cents * bps;
  return product >= 0 ? Math.floor((product + BPS / 2) / BPS) : -Math.floor((-product + BPS / 2) / BPS);
}

function findOne(rules: Rule[], predicate: (r: Rule) => boolean): Rule | undefined {
  return rules.find(predicate);
}

/**
 * Calculates an internal estimate on the server.
 *
 * Order of operations (owner-defined rules, fixed sequence):
 * base -> size band -> frequency multiplier -> add-ons -> minimum charge
 * -> discounts -> tax -> credits -> total.
 *
 * Refuses to run unless the rule set is approved. Never returns a rule set.
 */
export function calculateInternal(input: EstimateInput, ruleSet: RuleSet): InternalCalculation {
  if (ruleSet.status === 'draft') {
    throw new PricingError('RATE_VERSION_NOT_APPROVED', 'Rate version is a draft and cannot be used.');
  }
  if (ruleSet.status !== 'approved') {
    throw new PricingError('NO_APPROVED_RATE_VERSION', 'No approved rate version is available.');
  }

  const rules = ruleSet.rules;
  const lines: CalculationLine[] = [];
  const line = (rule: Rule, amountCents: number): void => {
    lines.push({
      ruleId: rule.id,
      kind: rule.kind,
      internalLabel: rule.internalLabel,
      customerLabel: rule.customerLabel,
      showToCustomer: rule.showToCustomer,
      amountCents,
    });
  };

  // 1. Base (required for the service)
  const base = findOne(rules, (r) => r.kind === 'base' && r.serviceSlug === input.serviceSlug);
  if (!base) throw new PricingError('MISSING_BASE_RULE', `No base rule for service ${input.serviceSlug}.`);
  line(base, base.value);
  let subtotal = base.value;

  // 2. Size band (required)
  const size = findOne(rules, (r) => r.kind === 'size' && r.key === input.sizeBand && (r.serviceSlug === null || r.serviceSlug === input.serviceSlug));
  if (!size) throw new PricingError('MISSING_SIZE_RULE', `No size rule for band ${input.sizeBand}.`);
  line(size, size.value);
  subtotal += size.value;

  // 3. Frequency multiplier (optional, applied to the running subtotal)
  if (input.frequency !== null) {
    const freq = findOne(rules, (r) => r.kind === 'frequency' && r.key === input.frequency && (r.serviceSlug === null || r.serviceSlug === input.serviceSlug));
    if (!freq) throw new PricingError('MISSING_FREQUENCY_RULE', `No frequency rule for ${input.frequency}.`);
    const adjusted = applyBps(subtotal, freq.value) - subtotal;
    line(freq, adjusted);
    subtotal += adjusted;
  }

  // 4. Add-ons (each a fixed amount)
  for (const key of input.addOnKeys) {
    const addon = findOne(rules, (r) => r.kind === 'addon' && r.key === key && (r.serviceSlug === null || r.serviceSlug === input.serviceSlug));
    if (!addon) throw new PricingError('MISSING_ADDON_RULE', `No add-on rule for ${key}.`);
    line(addon, addon.value);
    subtotal += addon.value;
  }

  // 5. Minimum charge (adds the difference if below the minimum)
  const minimum = findOne(rules, (r) => r.kind === 'minimum' && (r.serviceSlug === null || r.serviceSlug === input.serviceSlug));
  if (minimum && subtotal < minimum.value) {
    line(minimum, minimum.value - subtotal);
    subtotal = minimum.value;
  }

  // 6. Discounts (owner-defined; percent or fixed)
  let afterDiscount = subtotal;
  for (const discount of rules.filter((r) => r.kind === 'discount' && (r.serviceSlug === null || r.serviceSlug === input.serviceSlug))) {
    const amount = discount.isPercent ? -applyBps(afterDiscount, discount.value) : -Math.min(discount.value, afterDiscount);
    line(discount, amount);
    afterDiscount += amount;
  }

  // 7. Tax (owner-defined rate on the discounted subtotal)
  const tax = findOne(rules, (r) => r.kind === 'tax');
  if (tax) {
    const amount = applyBps(afterDiscount, tax.value);
    line(tax, amount);
    afterDiscount += amount;
  }

  // 8. Credits (owner-defined, fixed, applied last)
  let total = afterDiscount;
  for (const credit of rules.filter((r) => r.kind === 'credit' && (r.serviceSlug === null || r.serviceSlug === input.serviceSlug))) {
    const amount = -Math.min(credit.value, total);
    line(credit, amount);
    total += amount;
  }

  return {
    rateVersion: ruleSet.rateVersion,
    lines,
    subtotalCents: subtotal,
    totalCents: total,
  };
}
