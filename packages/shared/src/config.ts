import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../..');

loadDotenv({ path: resolve(REPO_ROOT, '.env') });

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  databaseUrl:
    process.env['DATABASE_URL'] ?? 'postgres://armlex:armlex@localhost:5433/armlex',
  crawlDelayMs: num('ARLIS_CRAWL_DELAY_MS', 2000),
  userAgent:
    process.env['ARLIS_USER_AGENT'] ??
    'ArmLexBot/0.1 (+legal research; contact rafayelarakelyan1@gmail.com)',
  snapshotDir: resolve(REPO_ROOT, 'data/snapshots'),
  auditDir: resolve(REPO_ROOT, 'data/audit'),
} as const;
