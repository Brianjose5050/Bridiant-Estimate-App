import { loadConfig } from './config.js';
import { startServer } from './server.js';

const port = Number(process.env.BRIDIANT_PORT ?? 4330);
const host = process.env.BRIDIANT_HOST ?? '127.0.0.1';
const cfg = loadConfig(process.env);

startServer(cfg, port, host)
  .then(() => {
    console.log(`Bridiant server listening on http://${host}:${port} (${cfg.env})`);
    console.log('Public site: /  ·  Private panel: /admin/login  ·  Intake: POST /api/estimate');
  })
  .catch((error: unknown) => {
    console.error('Server failed to start.', error instanceof Error ? error.message : '');
    process.exit(1);
  });
