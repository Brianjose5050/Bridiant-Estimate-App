import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { migrate } from '../db.js';
import { sqliteDb } from '../node/sqlite-db.js';
import { developmentKey } from '../main.js';
import { seedWelcomePacket } from '../welcome.js';

/** Adds the Welcome Packet chapters (unapproved, unpublished). Safe to run more than once. */
async function main(): Promise<void> {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const packetPath = resolve(here, '../../../../content/seed/welcome-packet.json');
  const dataDir = process.env.BRIDIANT_DATA_DIR ?? join(process.cwd(), 'data');
  const secretKey = process.env.BRIDIANT_SECRET_KEY ? undefined : await developmentKey(dataDir);
  const cfg = loadConfig(process.env, secretKey ? { secretKey } : {});
  const db = sqliteDb(join(dataDir, 'bridiant.sqlite'));
  try {
    await migrate(db);
    const added = await seedWelcomePacket(db, JSON.parse(readFileSync(packetPath, 'utf8')));
    console.log(`Welcome Packet: ${added} chapter(s) added. Existing chapters were not changed. All remain unapproved and unpublished.`);
  } finally {
    db.close();
    void cfg;
  }
}

void main();
