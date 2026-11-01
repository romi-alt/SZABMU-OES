import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations') },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
