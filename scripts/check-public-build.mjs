#!/usr/bin/env node
/**
 * Guards the public build. Fails if:
 * - any pricing or rule identifier appears in the public output or public source
 * - (production) any placeholder, pending-approval marker, or preview-only file appears
 *
 * Usage: node scripts/check-public-build.mjs [preview|production]
 * Mode defaults to the SITE_MODE environment variable.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'apps/public/dist');
const src = join(root, 'apps/public/src');
const mode = process.argv[2] ?? (process.env.SITE_MODE === 'production' ? 'production' : 'preview');

const ALWAYS_FORBIDDEN = [
  'calculateInternal',
  'issueCustomerEstimate',
  'rateVersion',
  'internalLabel',
  'showToCustomer',
  'approvedBy',
  'lineOverrides',
  'OwnerEstimate',
  '@bridiant/pricing',
  'packages/pricing',
  'RuleSet',
];
const PRODUCTION_FORBIDDEN = ['OWNER TO PROVIDE', 'pending_approval', 'Preview ·', 'preview-media'];

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const problems = [];
const textExt = /\.(html|js|css|json|svg|txt|xml)$/i;

const distFiles = await walk(dist).catch(() => null);
if (!distFiles) {
  console.error(`No build output at ${relative(root, dist)}. Run the build first.`);
  process.exit(1);
}

for (const file of distFiles) {
  const rel = relative(root, file);
  if (mode === 'production' && rel.includes('preview-media')) {
    problems.push(`${rel}: preview-only media in production output`);
  }
  if (!textExt.test(file)) continue;
  const text = await readFile(file, 'utf8');
  for (const token of ALWAYS_FORBIDDEN) {
    if (text.includes(token)) problems.push(`${rel}: forbidden pricing token "${token}"`);
  }
  if (mode === 'production') {
    for (const token of PRODUCTION_FORBIDDEN) {
      if (text.includes(token)) problems.push(`${rel}: unpublished content marker "${token}"`);
    }
  }
}

// Public source must never import the pricing package.
for (const file of await walk(src)) {
  if (!/\.(astro|ts|js|tsx|jsx|mjs)$/.test(file)) continue;
  const text = await readFile(file, 'utf8');
  for (const token of ['@bridiant/pricing', 'packages/pricing', 'calculateInternal', 'issueCustomerEstimate']) {
    if (text.includes(token)) problems.push(`${relative(root, file)}: public source references "${token}"`);
  }
}

const htmlCount = distFiles.filter((f) => f.endsWith('.html')).length;
console.log(`Public build check (${mode}): ${distFiles.length} file(s), ${htmlCount} page(s).`);
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(`\nFAILED: ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('PASSED: no pricing identifiers in public output or source.');
