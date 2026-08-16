/**
 * The one Postgres pool for the running server.
 *
 * `retrieve.ts` and `chat.ts` each used to hold their own lazily-created pool.
 * That cost two Neon connections instead of one, and — more visibly — made the
 * warm-up useless: pinging the database through retrieval's pool left chat's
 * pool still unconnected, so a turn paid ~4s of connection setup anyway.
 * Measured before and after on an idle system: 4.1s → 0.6s.
 *
 * Scripts under `ingest/` and `embed/` deliberately keep their own connections;
 * they are separate processes with their own lifetimes.
 */
import postgres from 'postgres';
import { config } from '@armlex/shared';

let sql: postgres.Sql | undefined;

export function db(): postgres.Sql {
  sql ??= postgres(config.databaseUrl, { onnotice: () => {} });
  return sql;
}

export async function closeDb(): Promise<void> {
  await sql?.end();
  sql = undefined;
}
