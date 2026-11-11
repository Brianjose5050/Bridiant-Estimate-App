import type { Config } from './config.js';
import type { Db } from './db.js';
import { nowIso } from './db.js';

/**
 * Email is a notification channel, not a record. The request is stored first.
 * Messages are queued in the database and sent by a worker. A failed send never
 * changes the stored request.
 *
 * Template status: the wording below is a DRAFT for owner review. It is not approved.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: OutgoingEmail): Promise<void>;
}

/** Used when no provider is configured. Nothing is sent; messages stay queued. */
export class NotConfiguredSender implements EmailSender {
  async send(): Promise<void> {
    throw new Error('provider_not_configured');
  }
}

/** Resend HTTP API adapter. Active only when BRIDIANT_EMAIL_API_KEY and an approved sender address are set. */
export class ResendSender implements EmailSender {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(message: OutgoingEmail): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`provider_http_${response.status}`);
  }
}

export function senderFor(cfg: Config): EmailSender {
  if (cfg.emailApiKey && cfg.emailFrom) return new ResendSender(cfg.emailApiKey, cfg.emailFrom);
  return new NotConfiguredSender();
}

/** Removes line breaks from values placed in headers and single-line fields. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
}

export function ownerAlertText(input: { reference: string; name: string; services: string[]; receivedAt: string; adminUrl: string | null }): { subject: string; text: string } {
  const subject = `New estimate request ${input.reference}`;
  const lines = [
    'A new estimate request was received.',
    '',
    `Customer: ${oneLine(input.name)}`,
    `Service: ${input.services.join(', ')}`,
    `Received (UTC): ${input.receivedAt}`,
    '',
    input.adminUrl ? `Open it in the private panel: ${input.adminUrl}` : 'Open it in the private panel. (The panel address has not been configured yet.)',
    '',
    'Contact details and answers are shown only in the private panel.',
  ];
  return { subject, text: lines.join('\n') };
}

export function customerAckText(input: { locale: 'en' | 'es'; reference: string; name: string }): { subject: string; text: string } {
  const name = oneLine(input.name);
  if (input.locale === 'es') {
    return {
      subject: `Recibimos su solicitud ${input.reference}`,
      text: [
        `Gracias, ${name}.`,
        '',
        `Recibimos su solicitud de estimado (referencia ${input.reference}).`,
        'Bridiant Facility Group revisará su información y le contactará.',
        '',
        'Esta es una solicitud de estimado, no una reservación.',
      ].join('\n'),
    };
  }
  return {
    subject: `We received your request ${input.reference}`,
    text: [
      `Thank you, ${name}.`,
      '',
      `We received your estimate request (reference ${input.reference}).`,
      'Bridiant Facility Group will review your information and contact you.',
      '',
      'This is a request for an estimate, not a booking.',
    ].join('\n'),
  };
}

/** Queues notifications for a stored request. Called only after the request is saved. */
export function queueRequestEmails(
  db: Db,
  cfg: Config,
  input: { requestId: number; reference: string; name: string; services: string[]; receivedAt: string; locale: 'en' | 'es'; customerEmail: string | null },
): void {
  const adminUrl = cfg.adminBaseUrl ? `${cfg.adminBaseUrl.replace(/\/$/, '')}/admin/requests/${input.requestId}` : null;
  const alert = ownerAlertText({ reference: input.reference, name: input.name, services: input.services, receivedAt: input.receivedAt, adminUrl });
  const insert = db.prepare(
    'INSERT INTO email_outbox (request_id, kind, locale, recipient, subject, body_text, status, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
  );
  insert.run(
    input.requestId,
    'owner_alert',
    'en',
    cfg.ownerEmail,
    alert.subject,
    alert.text,
    cfg.ownerEmail ? 'queued' : 'skipped_no_recipient',
    nowIso(),
  );
  if (input.customerEmail) {
    const ack = customerAckText({ locale: input.locale, reference: input.reference, name: input.name });
    insert.run(input.requestId, 'customer_ack', input.locale, input.customerEmail, ack.subject, ack.text, 'queued', nowIso());
  }
}

/** Sends queued messages. Three attempts, then marked failed. Returns counts for the status page. */
export async function processOutbox(db: Db, sender: EmailSender, limit = 25): Promise<{ sent: number; failed: number; pending: number }> {
  const rows = db.prepare("SELECT id, request_id, recipient, subject, body_text, attempts FROM email_outbox WHERE status = 'queued' AND recipient IS NOT NULL ORDER BY id LIMIT ?").all(limit) as Array<{
    id: number;
    request_id: number | null;
    recipient: string;
    subject: string;
    body_text: string;
    attempts: number;
  }>;
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await sender.send({ to: row.recipient, subject: row.subject, text: row.body_text });
      db.prepare("UPDATE email_outbox SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?").run(nowIso(), row.id);
      sent += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const status = attempts >= 3 ? 'failed' : 'queued';
      const message = error instanceof Error ? error.message : 'send_error';
      db.prepare('UPDATE email_outbox SET status = ?, attempts = ?, last_error = ? WHERE id = ?').run(status, attempts, message.slice(0, 200), row.id);
      if (status === 'failed') failed += 1;
    }
  }
  const pending = (db.prepare("SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'queued'").get() as { n: number }).n;
  return { sent, failed, pending };
}

/** Puts failed messages back in the queue. Used only by the owner from the System page. */
export function retryFailedEmails(db: Db): number {
  const info = db.prepare("UPDATE email_outbox SET status = 'queued', attempts = 0, last_error = NULL WHERE status = 'failed'").run();
  return Number(info.changes);
}
