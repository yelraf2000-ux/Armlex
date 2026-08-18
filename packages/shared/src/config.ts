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

/**
 * The database URL, with a localhost fallback that must never apply in production.
 *
 * The fallback points at the docker-compose Postgres, which is right for local
 * work and catastrophic anywhere else: a deployed instance missing
 * DATABASE_URL silently dialled 127.0.0.1:5433 and surfaced as
 * `ECONNREFUSED`, which reads like a network fault rather than absent
 * configuration. Naming the real problem costs one check.
 */
function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url) return url;

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'DATABASE_URL is not set. Refusing to fall back to the local development ' +
        'database (localhost:5433), which does not exist here and would surface ' +
        'as a confusing ECONNREFUSED. Set DATABASE_URL in the host environment.',
    );
  }
  return 'postgres://armlex:armlex@localhost:5433/armlex';
}

export const config = {
  databaseUrl: databaseUrl(),
  crawlDelayMs: num('ARLIS_CRAWL_DELAY_MS', 2000),
  userAgent:
    process.env['ARLIS_USER_AGENT'] ??
    'ArmLexBot/0.1 (+legal research; contact rafayelarakelyan1@gmail.com)',
  snapshotDir: resolve(REPO_ROOT, 'data/snapshots'),
  auditDir: resolve(REPO_ROOT, 'data/audit'),
} as const;
