import { createApp } from './bootstrap';
import { loadConfig } from './config';

async function main() {
  const cfg = loadConfig();
  const app = await createApp();
  await app.listen(cfg.API_PORT, cfg.API_HOST);
}
main().catch((e) => { console.error(e); process.exit(1); });
