/**
 * Official Bridiant brand palette. This file is the single source of truth.
 * tokens.css must match these values exactly (checked by tests).
 *
 * Rule: only these three colors, plus navy at reduced opacity (tints).
 * No gold, beige, green, red, purple, orange, yellow, pink, or brown.
 */
export const BRAND = {
  navy: '#071A2B',
  white: '#FFFFFF',
  gray: '#F1F3F5',
} as const;

/** Navy tints: navy at reduced opacity. Names encode the percentage. */
export const NAVY_TINT_ALPHA = {
  '70': 0.7,
  '40': 0.4,
  '20': 0.2,
  '08': 0.08,
} as const;

export const NAVY_RGB = [7, 26, 43] as const;

/** Lower-case hex values that are allowed anywhere in brand-controlled source. */
export const ALLOWED_HEX: ReadonlySet<string> = new Set(
  Object.values(BRAND).map((hex) => hex.toLowerCase()),
);

/** Returns the navy tint as an rgba() string, for example navyTint('20'). */
export function navyTint(key: keyof typeof NAVY_TINT_ALPHA): string {
  const [r, g, b] = NAVY_RGB;
  return `rgba(${r}, ${g}, ${b}, ${NAVY_TINT_ALPHA[key]})`;
}
