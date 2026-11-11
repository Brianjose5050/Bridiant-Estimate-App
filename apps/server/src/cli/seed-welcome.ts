import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { seedWelcomePacket } from '../welcome.js';

/** Adds the Welcome Packet chapters (unapproved, unpublished). Safe to run more than once. */
const here = fileURLToPath(new URL('.', import.meta.url));
const packetPath = resolve(here, '../../../../content/seed/welcome-packet.json');
const cfg = loadConfig(process.env);
const db = openDb(cfg.dbPath);
const added = seedWelcomePacket(db, JSON.parse(readFileSync(packetPath, 'utf8')));
console.log(`Welcome Packet: ${added} chapter(s) added. Existing chapters were not changed. All remain unapproved and unpublished.`);
db.close();
