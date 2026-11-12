import { createAdmin, MIN_PASSWORD_LENGTH } from './auth.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { SCHEMA_VERSION } from './schema.js';
import { seedWelcomePacket, type PacketChapter } from './welcome.js';

/** The only database this command may initialise. Any other name is refused before a request is made. */
export const EXPECTED_DATABASE_NAME = 'bridiant-prod';

export class InitRefused extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'InitRefused';
  }
}

/** Checks the invocation before any network call. A mistyped name or a missing confirmation stops here. */
export function assertSafeInvocation(input: { database: string | undefined; confirm: string | undefined; apply: boolean }): void {
  if (input.database !== EXPECTED_DATABASE_NAME) {
    throw new InitRefused('wrong_database', `Only the database "${EXPECTED_DATABASE_NAME}" can be initialised by this command.`);
  }
  if (input.apply && input.confirm !== EXPECTED_DATABASE_NAME) {
    throw new InitRefused('confirmation_missing', `To write, repeat the database name: --confirm ${EXPECTED_DATABASE_NAME}`);
  }
}

export interface InitPlan {
  ownerCount: number;
  chaptersPresent: number;
  chaptersMissing: number;
}

/** Read-only inspection. Refuses a database that is not migrated to the expected schema. */
export async function inspect(db: Db, packet: { chapters: PacketChapter[] }): Promise<InitPlan> {
  const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
  const names = new Set(tables.map((t) => t.name));
  for (const required of ['schema_meta', 'admin_user', 'welcome_resource', 'audit_log']) {
    if (!names.has(required)) throw new InitRefused('schema_missing', `Table "${required}" is missing. Apply the migration first.`);
  }
  const version = await db.first<{ value: string }>("SELECT value FROM schema_meta WHERE key = 'schema_version'");
  if (!version || Number(version.value) !== SCHEMA_VERSION) {
    throw new InitRefused('schema_version', `Schema version must be ${SCHEMA_VERSION}. Apply the migration first.`);
  }
  const owners = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM admin_user');
  const keys = new Set((await db.all<{ chapter_key: string }>('SELECT chapter_key FROM welcome_resource WHERE chapter_key IS NOT NULL')).map((r) => r.chapter_key));
  const present = packet.chapters.filter((c) => keys.has(c.key)).length;
  return { ownerCount: owners?.n ?? 0, chaptersPresent: present, chaptersMissing: packet.chapters.length - present };
}

export interface InitOptions {
  username: string;
  /** Required only when applying. A dry run never needs or reads it. */
  password?: string;
  apply: boolean;
  packet: { chapters: PacketChapter[] };
}

export interface InitResult {
  applied: boolean;
  plan: InitPlan;
  ownerCreated: boolean;
  /** Shown once, to the owner, in the terminal. Never stored or logged. */
  ownerTotpSecret?: string;
  chaptersAdded: number;
}

/**
 * One-time initialisation of a remote database, using the same functions as production.
 * - Creates the owner only when there is no owner. A second run never creates a duplicate.
 * - Adds only missing Welcome Packet chapters. Existing chapters are never overwritten.
 * - Every new chapter is unapproved and unpublished.
 * - Without apply, it only reports the plan.
 */
export async function initializeRemote(db: Db, cfg: Config, options: InitOptions): Promise<InitResult> {
  const plan = await inspect(db, options.packet);
  if (plan.ownerCount > 1) {
    throw new InitRefused('owner_duplicates', 'More than one owner row exists. Investigate before changing anything.');
  }
  if (!options.apply) return { applied: false, plan, ownerCreated: false, chaptersAdded: 0 };
  const password = options.password ?? '';
  if (plan.ownerCount === 0 && password.length < MIN_PASSWORD_LENGTH) {
    throw new InitRefused('password_too_short', `The owner password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  let ownerTotpSecret: string | undefined;
  const ownerCreated = plan.ownerCount === 0;
  if (ownerCreated) {
    ownerTotpSecret = (await createAdmin(db, cfg, options.username, password)).totpSecret;
  }
  const chaptersAdded = await seedWelcomePacket(db, options.packet);
  return { applied: true, plan, ownerCreated, ...(ownerTotpSecret ? { ownerTotpSecret } : {}), chaptersAdded };
}
