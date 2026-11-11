#!/usr/bin/env node
/**
 * Creates web-sized preview copies of owner photos for LOCAL preview only.
 * Originals stay in content/source (git-ignored). Output goes to apps/public/public/preview-media
 * (git-ignored). EXIF and GPS metadata are stripped. Requires ImageMagick `convert`.
 */
import { readdir, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'content/source/images/gallery-unclassified');
const out = join(root, 'apps/public/public/preview-media');

await mkdir(out, { recursive: true });
let files = [];
try {
  files = (await readdir(src)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
} catch {
  console.log('No gallery source folder found. Nothing to prepare.');
  process.exit(0);
}
for (const file of files) {
  const target = join(out, file.replace(/\.(png|webp)$/i, '.jpg'));
  await run('convert', [
    join(src, file),
    '-auto-orient',
    '-strip',
    '-resize', '1400x1400>',
    '-quality', '82',
    '-colorspace', 'sRGB',
    target,
  ]);
}
console.log(`Prepared ${files.length} preview image(s) in apps/public/public/preview-media (git-ignored).`);
