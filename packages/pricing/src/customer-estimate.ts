import type { InternalCalculation } from './types.js';

/**
 * Owner-approved estimate. Only the owner can move an estimate to 'approved'.
 * The customer receives nothing until it is approved.
 */
export interface OwnerEstimate {
  reference: string;
  status: 'draft' | 'approved';
  locale: 'en' | 'es';
  serviceName: { en: string; es: string };
  /** Owner-written explanation of the services and charges. Required before issue. */
  explanation: { en: string; es: string } | null;
  calculation: InternalCalculation;
  /** Owner's choice of lines to include. Defaults to the rule's showToCustomer flag. */
  lineOverrides?: Record<string, boolean>;
}

/** What the customer sees. Contains no rule IDs, rates, formulas, or rate version. */
export interface CustomerEstimate {
  reference: string;
  locale: 'en' | 'es';
  serviceName: string;
  explanation: string;
  lines: { label: string; amountCents: number }[];
  totalCents: number;
}

export class EstimateNotApprovedError extends Error {
  constructor() {
    super('Estimate has not been approved by the owner.');
    this.name = 'EstimateNotApprovedError';
  }
}

/**
 * Builds the customer-facing estimate from an owner-approved estimate.
 * Only lines the owner chose to show appear, with owner-written labels.
 * Internal labels, rule IDs, rates, multipliers, and the rate version are never copied.
 */
export function issueCustomerEstimate(estimate: OwnerEstimate): CustomerEstimate {
  if (estimate.status !== 'approved') throw new EstimateNotApprovedError();
  if (!estimate.explanation) {
    throw new Error('Owner explanation is required before issuing an estimate.');
  }
  const { locale } = estimate;
  const lines = estimate.calculation.lines
    .filter((line) => estimate.lineOverrides?.[line.ruleId] ?? line.showToCustomer)
    .map((line) => ({
      label: line.customerLabel ? line.customerLabel[locale] : '',
      amountCents: line.amountCents,
    }))
    .filter((line) => line.label.length > 0);

  // The visible lines must add up to the total the customer sees.
  // If the owner hid lines that change the total, issuing is refused until the display is fixed.
  const visibleSum = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (visibleSum !== estimate.calculation.totalCents) {
    throw new Error('Visible lines do not reconcile to the total. Show every line that changes the total.');
  }

  return {
    reference: estimate.reference,
    locale,
    serviceName: estimate.serviceName[locale],
    explanation: estimate.explanation[locale],
    lines,
    totalCents: estimate.calculation.totalCents,
  };
}
