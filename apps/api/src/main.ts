import { createApp } from './bootstrap';
import { loadConfig } from './config';

async function main() {
  const cfg = loadConfig();
  const app = await createApp();
  await app.listen(Number(process.env.PORT) || cfg.API_PORT, cfg.API_HOST);   // managed hosts assign PORT; API_PORT stays the default
}
main().catch((e) => { console.error(e); process.exit(1); });
