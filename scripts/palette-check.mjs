#!/usr/bin/env node
/**
 * Palette lint for brand-controlled source (apps/, packages/, content/).
 *
 * Fails on:
 * - any hex color outside #071A2B, #FFFFFF, #F1F3F5
 * - any rgb()/rgba() color whose RGB channels are not navy, white, or gray
 * - any hsl()/hsla() color (use hex or rgba tokens so the palette stays auditable)
 * - named off-brand colors (gold, beige, green, red, ...) in CSS, SVG, or HTML
 *
 * The legacy estimate app (index.html.html) and documentation are outside the scanned
 * directories and are not modified or checked by this script.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_HEX = new Set(['#071a2b', '#ffffff', '#f1f3f5']);
const ALLOWED_RGB_BASES = new Set(['7,26,43', '255,255,255', '241,243,245']);

const SCAN_DIRS = ['packages', 'apps', 'content'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.html', '.svg', '.json']);
const STYLE_EXTENSIONS = new Set(['.css', '.html', '.svg']);

const OFF_BRAND_NAMES = [
  'gold', 'goldenrod', 'beige', 'tan', 'khaki', 'bisque', 'wheat',
  'green', 'lime', 'olive', 'teal', 'mint', 'emerald',
  'red', 'crimson', 'maroon', 'tomato', 'coral', 'salmon',
  'purple', 'violet', 'magenta', 'fuchsia', 'lavender', 'indigo',
  'orange', 'yellow', 'amber', 'pink', 'brown', 'chocolate', 'sienna',
  'blue', 'skyblue', 'cyan', 'aqua',
];
const OFF_BRAND_PATTERN = new RegExp(`\\b(${OFF_BRAND_NAMES.join('|')})\\b`, 'i');

const HEX_PATTERN = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const RGB_PATTERN = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/gi;
const HSL_PATTERN = /hsla?\(/gi;

/** Returns a list of violations for one file's text. Pure function, used by tests. */
export function findViolations(fileName, text) {
  const violations = [];
  const ext = extname(fileName);
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNo = index + 1;

    for (const match of line.matchAll(HEX_PATTERN)) {
      let hex = match[0].toLowerCase();
      if (hex.length === 4) {
        hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
      }
      if (!ALLOWED_HEX.has(hex)) {
        violations.push({ fileName, lineNo, rule: 'hex', detail: match[0] });
      }
    }

    for (const match of line.matchAll(RGB_PATTERN)) {
      const base = `${Number(match[1])},${Number(match[2])},${Number(match[3])}`;
      if (!ALLOWED_RGB_BASES.has(base)) {
        violations.push({ fileName, lineNo, rule: 'rgb', detail: match[0] });
      }
    }

    if (HSL_PATTERN.test(line)) {
      violations.push({ fileName, lineNo, rule: 'hsl', detail: 'hsl() is not allowed' });
    }
    HSL_PATTERN.lastIndex = 0;

    if (STYLE_EXTENSIONS.has(ext)) {
      const named = line.match(OFF_BRAND_PATTERN);
      if (named) {
        violations.push({ fileName, lineNo, rule: 'named-color', detail: named[0] });
      }
    }
  });

  return violations;
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

/** Scans the brand-controlled directories under a repository root. */
export async function scanRepository(root) {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    let files;
    try {
      files = await listFiles(join(root, dir));
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      violations.push(...findViolations(relative(root, file), text));
    }
  }
  return violations;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const violations = await scanRepository(root);
  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`${v.fileName}:${v.lineNo} [${v.rule}] ${v.detail}`);
    }
    console.error(`\nPalette check failed: ${violations.length} violation(s).`);
    process.exit(1);
  }
  console.log('Palette check passed.');
}
