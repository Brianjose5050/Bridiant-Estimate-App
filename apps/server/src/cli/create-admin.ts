import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { createAdmin } from '../auth.js';

/**
 * Creates the single owner account. Run once, on the owner's own computer.
 * The authenticator secret is shown once, so it can be added to an authenticator app.
 */
async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const db = openDb(cfg.dbPath);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const username = (process.env.BRIDIANT_ADMIN_USERNAME ?? (await rl.question('Owner username: '))).trim();
    const password = await rl.question('Password (12+ characters, input is visible in this terminal): ');
    const created = await createAdmin(db, cfg, username, password);
    console.log('\nOwner account created.');
    console.log('Add this to your authenticator app (or enter the secret manually):');
    console.log(`  Secret: ${created.totpSecret}`);
    console.log(`  URI:    ${created.otpauth}`);
    console.log('\nStore the secret in a password manager. It is encrypted in the database and cannot be displayed again.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not create the owner account.');
    process.exitCode = 1;
  } finally {
    rl.close();
    db.close();
  }
}

void main();
