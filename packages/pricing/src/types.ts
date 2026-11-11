/**
 * PRIVATE PRICING DOMAIN. Server-side only.
 *
 * This package must never be imported by apps/public or any browser bundle.
 * Its rule sets are owner-entered and stored in the private database schema.
 * No rates, prices, or formulas are defined in this repository.
 *
 * All money is integer cents. Multipliers and percentages are basis points
 * (10000 = 100%).
 */

export type RuleKind =
  | 'base' // fixed amount for a service
  | 'size' // amount added for a size band
  | 'frequency' // multiplier for a frequency option (basis points)
  | 'addon' // fixed amount per add-on
  | 'minimum' // minimum charge for the subtotal
  | 'discount' // percent (bps) or fixed amount off, owner-defined
  | 'tax' // rate on the discounted subtotal (bps)
  | 'credit'; // fixed amount applied after tax, owner-defined

export interface Rule {
  id: string;
  kind: RuleKind;
  /** Internal label. Never shown to customers unless showToCustomer is true. */
  internalLabel: string;
  /** Customer-facing label written by the owner. */
  customerLabel: { en: string; es: string } | null;
  /** Service this rule applies to, or null for all services. */
  serviceSlug: string | null;
  /** Lookup key: size band id, frequency id, or add-on id, depending on kind. */
  key: string | null;
  /** Cents for base, size, addon, minimum, credit, discount (fixed). Basis points for frequency, discount (percent), tax. */
  value: number;
  /** Discount only: true if value is a percent in basis points. */
  isPercent: boolean;
  /** Owner choice: show this line to the customer. Default false. */
  showToCustomer: boolean;
}

export type RuleSetStatus = 'draft' | 'approved' | 'retired';

export interface RuleSet {
  rateVersion: string;
  status: RuleSetStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  rules: Rule[];
}

export interface EstimateInput {
  serviceSlug: string;
  sizeBand: string;
  frequency: string | null;
  addOnKeys: string[];
}

export interface CalculationLine {
  ruleId: string;
  kind: RuleKind;
  internalLabel: string;
  customerLabel: { en: string; es: string } | null;
  showToCustomer: boolean;
  /** Signed cents: positive adds to the total, negative subtracts. */
  amountCents: number;
}

export interface InternalCalculation {
  rateVersion: string;
  lines: CalculationLine[];
  subtotalCents: number;
  totalCents: number;
}

export type PricingErrorCode =
  | 'NO_APPROVED_RATE_VERSION'
  | 'RATE_VERSION_NOT_APPROVED'
  | 'MISSING_BASE_RULE'
  | 'MISSING_SIZE_RULE'
  | 'MISSING_FREQUENCY_RULE'
  | 'MISSING_ADDON_RULE'
  | 'INVALID_RULE';

export class PricingError extends Error {
  constructor(
    readonly code: PricingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}
