import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { FileStore } from '../files.js';

export interface UploadedPart {
  name: string;
  size: number;
  data(): Promise<Uint8Array<ArrayBuffer>>;
}

/** Form input of an admin request: text fields and uploaded files, read with size limits. */
export interface AdminInput {
  fields: Record<string, string>;
  files: Record<string, UploadedPart[]>;
}

export interface AdminCtx {
  method: string;
  path: string;
  query: URLSearchParams;
  input: AdminInput;
  cookies: Record<string, string>;
  ip: string;
  origin: string | null;
  host: string | null;
  cfg: Config;
  db: Db;
  files: FileStore;
}

export interface AdminResponse {
  status: number;
  html?: string;
  headers?: Record<string, string>;
  /** A private file, served only after the session check. */
  file?: { key: string; mime: string; name: string; inline: boolean };
}

export function redirect(location: string, extra: Record<string, string> = {}): AdminResponse {
  return { status: 303, headers: { Location: location, ...extra } };
}

export function htmlResponse(status: number, body: string, extra: Record<string, string> = {}): AdminResponse {
  return { status, html: body, headers: extra };
}

export function requireCsrf(input: AdminInput, csrf: string): boolean {
  const token = input.fields.csrf;
  return typeof token === 'string' && token.length > 0 && token === csrf;
}
