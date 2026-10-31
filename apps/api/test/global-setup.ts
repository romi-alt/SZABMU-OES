import { execSync } from 'node:child_process';
import path from 'node:path';
import './env';

export default function setup() {
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, stdio: 'pipe' });
}
