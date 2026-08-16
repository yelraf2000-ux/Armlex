/**
 * Minimal forward-only migration runner.
 *
 * Applies every .sql file in ../../migrations in filename order, once, inside a
 * transaction, recording each in schema_migrations.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { config } from '@armlex/shared';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, '../../migrations');

async function main(): Promise<void> {
  const sql = postgres(config.databaseUrl, { onnotice: () => {} });

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map(
        (r) => r.name,
      ),
    );

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const body = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`applying ${file} ... `);

      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });

      process.stdout.write('ok\n');
      ran++;
    }

    console.log(
      ran === 0 ? 'up to date, nothing to apply' : `applied ${ran} migration(s)`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('migration failed:', err);
  process.exit(1);
});
