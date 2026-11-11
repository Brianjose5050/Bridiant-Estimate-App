import { describe, expect, it, vi, afterEach } from 'vitest';
import { verifyTurnstile } from '../src/estimates.js';
import { ResendSender, processOutbox, type EmailSender } from '../src/email.js';
import { openDb } from '../src/db.js';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Turnstile verification (mocked network; no account used)', () => {
  it('accepts only a successful siteverify response', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: URLSearchParams }) => {
      calls.push({ url, body: init.body.toString() });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    expect(await verifyTurnstile('secret-value', 'token-value', '203.0.113.5')).toBe(true);
    expect(calls[0]?.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(calls[0]?.body).toContain('response=token-value');
  });

  it('fails closed on rejection, missing token, or network error', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    expect(await verifyTurnstile('s', 't', '203.0.113.5')).toBe(false);
    expect(await verifyTurnstile('s', '', '203.0.113.5')).toBe(false);
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    expect(await verifyTurnstile('s', 't', '203.0.113.5')).toBe(false);
  });
});

describe('Resend adapter (mocked network; no account used)', () => {
  it('sends the expected request and reports provider errors without details', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body: string }) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response('{}', { status: 200 });
    });
    const sender = new ResendSender('re_test_key_placeholder', 'alerts@example.invalid');
    await sender.send({ to: 'owner@example.invalid', subject: 'New request', text: 'A new request was received.' });
    expect(seen[0]?.url).toBe('https://api.resend.com/emails');
    expect(seen[0]?.headers.Authorization).toBe('Bearer re_test_key_placeholder');
    expect(seen[0]?.body).toEqual({ from: 'alerts@example.invalid', to: ['owner@example.invalid'], subject: 'New request', text: 'A new request was received.' });
    vi.stubGlobal('fetch', async () => new Response('secret detail from provider', { status: 422 }));
    await expect(sender.send({ to: 'a@example.invalid', subject: 's', text: 't' })).rejects.toThrow('provider_http_422');
  });

  it('keeps a message queued after a provider failure and marks it failed after three attempts', async () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'mail-')), 'm.sqlite'));
    db.prepare("INSERT INTO email_outbox (kind, locale, recipient, subject, body_text, status, created_at) VALUES ('owner_alert', 'en', 'o@example.invalid', 's', 'b', 'queued', ?)").run(new Date().toISOString());
    const failing: EmailSender = { send: async () => { throw new Error('provider_http_500'); } };
    await processOutbox(db, failing);
    await processOutbox(db, failing);
    expect((db.prepare("SELECT status, attempts FROM email_outbox").get() as { status: string; attempts: number })).toEqual({ status: 'queued', attempts: 2 });
    await processOutbox(db, failing);
    expect((db.prepare("SELECT status FROM email_outbox").get() as { status: string }).status).toBe('failed');
    db.close();
  });
});
