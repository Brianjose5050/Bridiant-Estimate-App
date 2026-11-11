import { LOCALES, type Locale } from './locales.js';
import { isPlaceholder } from './placeholders.js';

/**
 * Approval state of one locale of one field.
 * - draft: being written or proposed. Never publishable.
 * - pending_approval: supplied by the owner or a reviewer, awaiting explicit approval.
 * - approved: explicitly approved by a named person. Only this state publishes.
 */
export type LocaleStatus = 'draft' | 'pending_approval' | 'approved';

export interface LocalizedField {
  value: Record<Locale, string>;
  status: Record<Locale, LocaleStatus>;
  /**
   * Owner's explicit per-item choice to show English when Spanish is missing.
   * Default is false. Never set automatically.
   */
  fallbackToEnglish?: boolean;
}

export interface PublishIssue {
  field: string;
  locale: Locale;
  problem:
    | 'empty'
    | 'placeholder'
    | 'not_approved'
    | 'missing_locale_no_fallback';
  message: string;
}

export interface PublishResult {
  ok: boolean;
  issues: PublishIssue[];
}

/**
 * Checks one localized field against the publish rules:
 * 1. Every locale must be non-empty and must not contain a placeholder.
 * 2. Every locale must be explicitly approved.
 * 3. A missing locale is allowed only when the owner has set fallbackToEnglish
 *    AND English itself is approved.
 */
export function checkField(name: string, field: LocalizedField): PublishIssue[] {
  const issues: PublishIssue[] = [];

  for (const locale of LOCALES) {
    const text = field.value[locale].trim();
    const status = field.status[locale];

    if (text.length === 0) {
      // An empty Spanish entry is allowed only through the owner's explicit fallback.
      // The English approval requirement is checked below.
      if (locale === 'es' && field.fallbackToEnglish === true) continue;
      issues.push({
        field: name,
        locale,
        problem: 'empty',
        message: `${name} (${locale}) is empty.`,
      });
      continue;
    }

    if (isPlaceholder(text)) {
      issues.push({
        field: name,
        locale,
        problem: 'placeholder',
        message: `${name} (${locale}) still contains a placeholder.`,
      });
    }

    if (status !== 'approved') {
      issues.push({
        field: name,
        locale,
        problem: 'not_approved',
        message: `${name} (${locale}) is not approved (status: ${status}).`,
      });
    }
  }

  if (field.fallbackToEnglish === true && field.status.en !== 'approved') {
    issues.push({
      field: name,
      locale: 'en',
      problem: 'missing_locale_no_fallback',
      message: `${name}: English must be approved before English fallback can apply.`,
    });
  }

  return issues;
}

/** Checks every field of an entity. The entity publishes only if all fields pass. */
export function checkEntityPublishable(
  fields: Record<string, LocalizedField>,
): PublishResult {
  const issues = Object.entries(fields).flatMap(([name, field]) =>
    checkField(name, field),
  );
  return { ok: issues.length === 0, issues };
}
