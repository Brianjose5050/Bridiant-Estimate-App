import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

export const REQUEST_STATUSES = [
  'new',
  'under_review',
  'contacted',
  'estimate_sent',
  'booked',
  'completed',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const SCHEMA_VERSION = 1;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_user (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret_enc TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_session (
  token_hash TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS estimate_request (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en','es')),
  status TEXT NOT NULL CHECK (status IN ('new','under_review','contacted','estimate_sent','booked','completed','cancelled')),
  reviewed_at TEXT,
  services TEXT NOT NULL,
  services_text TEXT NOT NULL,
  home_type TEXT NOT NULL,
  bedrooms TEXT NOT NULL,
  bathrooms TEXT NOT NULL,
  frequency TEXT,
  move_date TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  zip TEXT,
  notes TEXT,
  ip_hash TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_request_received ON estimate_request (received_at);
CREATE INDEX IF NOT EXISTS idx_request_status ON estimate_request (status);

CREATE TABLE IF NOT EXISTS request_photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES estimate_request (id),
  display_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES estimate_request (id),
  kind TEXT NOT NULL CHECK (kind IN ('received','viewed','status_changed','note_added','email_queued','email_sent','email_failed')),
  from_value TEXT,
  to_value TEXT,
  body TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_request ON request_event (request_id);

CREATE TABLE IF NOT EXISTS request_note (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES estimate_request (id),
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER REFERENCES estimate_request (id),
  kind TEXT NOT NULL CHECK (kind IN ('owner_alert','customer_ack')),
  locale TEXT NOT NULL,
  recipient TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','failed','skipped_no_recipient')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS welcome_resource (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_key TEXT UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('presentation','service_info','standards','preparation','policy','document','faq')),
  access_tier TEXT NOT NULL CHECK (access_tier IN ('public','after_request','after_approval')),
  subtitle_en TEXT NOT NULL DEFAULT '',
  subtitle_es TEXT NOT NULL DEFAULT '',
  title_en TEXT NOT NULL DEFAULT '',
  title_es TEXT NOT NULL DEFAULT '',
  body_en TEXT NOT NULL DEFAULT '',
  body_es TEXT NOT NULL DEFAULT '',
  approved_en INTEGER NOT NULL DEFAULT 0,
  approved_es INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  document_storage TEXT,
  document_mime TEXT,
  document_bytes INTEGER,
  document_sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gallery_project (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_en TEXT NOT NULL DEFAULT '',
  title_es TEXT NOT NULL DEFAULT '',
  service_id TEXT,
  approved_en INTEGER NOT NULL DEFAULT 0,
  approved_es INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gallery_photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'unclassified' CHECK (kind IN ('unclassified','before','after','regular')),
  project_id INTEGER REFERENCES gallery_project (id),
  service_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  ownership_confirmed INTEGER NOT NULL DEFAULT 0,
  people_status TEXT NOT NULL DEFAULT 'unknown' CHECK (people_status IN ('none_visible','permission_on_file','unknown')),
  caption_en TEXT NOT NULL DEFAULT '',
  caption_es TEXT NOT NULL DEFAULT '',
  alt_en TEXT NOT NULL DEFAULT '',
  alt_es TEXT NOT NULL DEFAULT '',
  approved_caption_en INTEGER NOT NULL DEFAULT 0,
  approved_caption_es INTEGER NOT NULL DEFAULT 0,
  approved_alt_en INTEGER NOT NULL DEFAULT 0,
  approved_alt_es INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gallery_pair (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  before_id INTEGER NOT NULL UNIQUE REFERENCES gallery_photo (id),
  after_id INTEGER NOT NULL UNIQUE REFERENCES gallery_photo (id),
  project_id INTEGER NOT NULL REFERENCES gallery_project (id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK (before_id <> after_id)
);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(SCHEMA);
  db.prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Fixed-window rate limit. Returns true when the action is allowed. */
export function allowRate(db: Db, key: string, limit: number, windowSeconds: number, nowMs = Date.now()): boolean {
  const windowStart = Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds;
  const row = db.prepare('SELECT window_start, count FROM rate_limit WHERE key = ?').get(key) as
    | { window_start: number; count: number }
    | undefined;
  if (!row || row.window_start !== windowStart) {
    db.prepare('INSERT OR REPLACE INTO rate_limit (key, window_start, count) VALUES (?, ?, 1)').run(key, windowStart);
    return true;
  }
  if (row.count >= limit) return false;
  db.prepare('UPDATE rate_limit SET count = count + 1 WHERE key = ?').run(key);
  return true;
}

export function audit(db: Db, action: string, entity: string, entityId: string | null, detail: Record<string, unknown> | null = null): void {
  db.prepare('INSERT INTO audit_log (action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(
    action,
    entity,
    entityId,
    detail ? JSON.stringify(detail) : null,
    nowIso(),
  );
}
