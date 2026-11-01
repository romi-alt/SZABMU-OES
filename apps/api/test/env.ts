import fs from 'node:fs';
import path from 'node:path';
// Load root .env but point everything at the TEST database.
const envFile = path.resolve(__dirname, '../../../.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, '');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://oes:oes_dev_password@localhost:5433/szabmu_oes_test';
process.env.RUN_WORKERS = 'false';
process.env.DEV_EXPOSE_CODES = 'true';
process.env.WEB_ORIGIN = 'http://localhost:3000';
