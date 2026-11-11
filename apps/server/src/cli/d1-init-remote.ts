import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { d1RestDb } from '../node/d1-rest-db.js';
import { assertSafeInvocation, EXPECTED_DATABASE_NAME, initializeRemote, InitRefused, type InitResult } from '../init-remote.js';
import type { PacketChapter } from '../welcome.js';

/**
 * One-time initialisation of the REMOTE production D1 database: owner account and Welcome Packet.
 * Dry run by default. Writes only with --apply --confirm bridiant-prod.
 * Secrets come from the environment or a password file. Nothing secret is printed except the
 * owner's authenticator secret, once, on apply.
 *
 *   node dist/cli/d1-init-remote.js --database bridiant-prod --username <name>            (plan only)
 *   node dist/cli/d1-init-remote.js --database bridiant-prod --username <name> --apply --confirm bridiant-prod
 *
 * Environment: CLOUDFLARE_ACCOUNT_ID, BRIDIANT_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN, BRIDIANT_SECRET_KEY,
 * and BRIDIANT_OWNER_PASSWORD or --password-file <path>.
 */

interface Args {
  database?: string;
  username?: string;
  confirm?: string;
  apply: boolean;
  passwordFile?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { apply: false };
  const valued = new Set(['--database', '--username', '--confirm', '--password-file']);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] ?? '';
    if (flag === '--apply') {
      out.apply = true;
      continue;
    }
    if (!valued.has(flag)) throw new InitRefused('unknown_argument', `Unknown argument: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new InitRefused('missing_value', `${flag} needs a value.`);
    if (flag === '--database') out.database = value;
    else if (flag === '--username') out.username = value;
    else if (flag === '--confirm') out.confirm = value;
    else out.passwordFile = value;
    i += 1;
  }
  return out;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new InitRefused('missing_setting', `${name} is not set.`);
  return value;
}

function readPassword(args: Args): string {
  if (args.passwordFile) return readFileSync(args.passwordFile, 'utf8').replace(/\r?\n$/, '');
  return requireEnv('BRIDIANT_OWNER_PASSWORD');
}

function report(result: InitResult): void {
  const { plan } = result;
  console.log(`Owner accounts present before: ${plan.ownerCount}`);
  console.log(`Welcome chapters present before: ${plan.chaptersPresent} (missing: ${plan.chaptersMissing})`);
  if (!result.applied) {
    console.log('Dry run. Nothing was written. To apply, repeat with --apply --confirm ' + EXPECTED_DATABASE_NAME);
    return;
  }
  console.log(result.ownerCreated ? 'Owner account created.' : 'Owner already exists. No owner was created or changed.');
  if (result.ownerTotpSecret) {
    console.log('\nAuthenticator secret (shown ONCE; store it in a password manager now):');
    console.log(`  ${result.ownerTotpSecret}`);
  }
  console.log(`Welcome chapters added: ${result.chaptersAdded}. All chapters remain unapproved and unpublished.`);
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const packetPath = resolve(here, '../../../../content/seed/welcome-packet.json');
  try {
    const args = parseArgs(process.argv.slice(2));
    assertSafeInvocation({ database: args.database, confirm: args.confirm, apply: args.apply });
    if (!args.username) throw new InitRefused('username_missing', '--username is required.');
    const cfg = loadConfig({ BRIDIANT_SECRET_KEY: requireEnv('BRIDIANT_SECRET_KEY') });
    const db = d1RestDb({
      accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
      databaseId: requireEnv('BRIDIANT_D1_DATABASE_ID'),
      apiToken: requireEnv('CLOUDFLARE_API_TOKEN'),
    });
    const packet = JSON.parse(readFileSync(packetPath, 'utf8')) as { chapters: PacketChapter[] };
    const password = args.apply ? readPassword(args) : undefined;
    const result = await initializeRemote(db, cfg, { username: args.username, apply: args.apply, packet, ...(password !== undefined ? { password } : {}) });
    report(result);
  } catch (error) {
    if (error instanceof InitRefused) {
      console.error(`Refused (${error.code}): ${error.message}`);
      process.exitCode = 2;
    } else {
      console.error('Initialisation failed. No secret or request detail is shown. Check the database state before retrying.');
      process.exitCode = 1;
    }
  }
}

void main();
