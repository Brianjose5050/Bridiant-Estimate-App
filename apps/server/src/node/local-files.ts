import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { FileStore } from '../files.js';

/** Keys the server generates: gallery/, requests/ or documents/ plus a random name. Nothing else is accepted. */
const KEY = /^(gallery|requests|documents)\/[A-Za-z0-9_-]+\.[a-z]+$/;

/** Local private file store for development and tests. Never served directly: the app checks access first. */
export function localFiles(root: string): FileStore {
  const base = resolve(root);
  const pathFor = (key: string): string => {
    if (!KEY.test(key)) throw new Error('invalid_key');
    return join(base, key);
  };
  return {
    async put(key, data, _mime) {
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await unlink(pathFor(key)).catch(() => undefined);
    },
  };
}
