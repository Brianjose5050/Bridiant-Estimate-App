import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// The checker is plain ESM JavaScript, shared with the CLI.
import { findViolations, scanRepository } from '../../../scripts/palette-check.mjs';
import { BRAND, NAVY_TINT_ALPHA, navyTint } from '../src/palette.js';

const tokensCss = readFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), 'utf8');
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Test fixtures are built at run time so this file itself passes the repository scan.
const hash = '#';
const offBrandHex = hash + 'ff0000';
const offBrandRgb = 'rgb(' + '200, 150, 10)';
const goldWord = 'go' + 'ld';

describe('brand palette', () => {
  it('defines exactly the three official colors', () => {
    expect(BRAND).toEqual({ navy: '#071A2B', white: '#FFFFFF', gray: '#F1F3F5' });
  });

  it('keeps tokens.css in exact agreement with palette.ts', () => {
    expect(tokensCss).toContain(`--color-navy: ${BRAND.navy};`);
    expect(tokensCss).toContain(`--color-white: ${BRAND.white};`);
    expect(tokensCss).toContain(`--color-gray: ${BRAND.gray};`);
    for (const [key, alpha] of Object.entries(NAVY_TINT_ALPHA)) {
      expect(tokensCss).toContain(`--color-navy-${key}: rgba(7, 26, 43, ${alpha});`);
      expect(navyTint(key as keyof typeof NAVY_TINT_ALPHA)).toBe(`rgba(7, 26, 43, ${alpha})`);
    }
  });
});

describe('palette checker', () => {
  it('accepts the official colors and navy tints', () => {
    const ok = `color: ${BRAND.navy}; background: ${BRAND.white}; border: 1px solid rgba(7, 26, 43, 0.2);`;
    expect(findViolations('x.css', ok)).toEqual([]);
  });

  it('rejects an off-brand hex value', () => {
    const v = findViolations('x.css', `color: ${offBrandHex};`);
    expect(v.map((x) => x.rule)).toEqual(['hex']);
  });

  it('rejects an off-brand rgb value', () => {
    const v = findViolations('x.ts', `const c = '${offBrandRgb}';`);
    expect(v.map((x) => x.rule)).toEqual(['rgb']);
  });

  it('rejects HSL color functions entirely', () => {
    const v = findViolations('x.css', 'color: ' + 'hsl' + '(210, 60%, 15%);');
    expect(v.map((x) => x.rule)).toEqual(['hsl']);
  });

  it('rejects named off-brand colors in style files', () => {
    const v = findViolations('x.css', `.badge { color: ${goldWord}; }`);
    expect(v.map((x) => x.rule)).toEqual(['named-color']);
  });

  it('scans the brand-controlled source tree with zero violations', async () => {
    const violations = await scanRepository(repoRoot);
    expect(violations).toEqual([]);
  });
});
