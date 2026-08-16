/**
 * Alias resolution must work BEFORE any write path relies on it.
 *
 * 228650 is the id ARLIS search surfaces for the Tax Code; 109017 is canonical.
 * If a resolver returned the alias as its own document, ingestion would index
 * the Tax Code twice and retrieval would cite a snapshot id that goes stale at
 * the next amendment.
 *
 * Requires a live database. Skipped when DATABASE_URL is unset so the rest of
 * the suite still runs.
 *
 * Run: npx tsx --test packages/backend/src/db/aliases.test.ts
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { config } from '@armlex/shared';
import { resolveCanonicalId, CANONICAL_ID } from '@armlex/scraper';

const HAS_DB = Boolean(process.env['DATABASE_URL']);
const skip = HAS_DB ? false : 'DATABASE_URL not set';

describe('canonical id map (pure, no database)', () => {
  test('228650 resolves to 109017', () => {
    assert.equal(resolveCanonicalId(228650), 109017);
  });

  test('a canonical id resolves to itself', () => {
    assert.equal(resolveCanonicalId(109017), 109017);
  });

  test('an unknown id passes through unchanged', () => {
    assert.equal(resolveCanonicalId(999999), 999999);
  });

  test('no alias is also a canonical target (no cycles)', () => {
    for (const [alias, canonical] of Object.entries(CANONICAL_ID)) {
      assert.notEqual(Number(alias), canonical);
      assert.equal(
        CANONICAL_ID[canonical],
        undefined,
        `alias chain: ${alias} -> ${canonical} -> ...`,
      );
    }
  });
});

describe('document_by_any_arlis_id resolves aliases', { skip }, () => {
  let sql: postgres.Sql;

  // Synthetic ids, NOT the real 109017/228650 pair.
  //
  // This suite deletes its fixtures, and documents cascade to articles, so
  // using the real Tax Code id would wipe its 457 ingested chunks every time
  // the tests ran against a populated database. The real mapping is asserted
  // by the pure tests above; what needs a database here is only the VIEW's
  // resolution behaviour, which any id pair exercises equally well.
  const CANONICAL = 990017;
  const ALIAS = 990650;

  before(async () => {
    sql = postgres(config.databaseUrl, { onnotice: () => {} });

    await sql`DELETE FROM documents WHERE arlis_id IN (${CANONICAL}, ${ALIAS})`;
    const [doc] = await sql<{ id: string }[]>`
      INSERT INTO documents (arlis_id, doc_type, title_hy, status, arlis_url)
      VALUES (${CANONICAL}, 'code', 'ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ', 'in_force',
              ${'https://www.arlis.am/hy/acts/109017/latest'})
      RETURNING id
    `;
    await sql`
      INSERT INTO document_aliases (arlis_id, document_id, reason)
      VALUES (${ALIAS}, ${doc!.id}, 'duplicate')
    `;
  });

  after(async () => {
    await sql`DELETE FROM documents WHERE arlis_id = ${CANONICAL}`;
    await sql.end();
  });

  test('the alias id resolves to the canonical document', async () => {
    const rows = await sql<{ arlis_id: number; match_kind: string }[]>`
      SELECT arlis_id, match_kind FROM document_by_any_arlis_id
      WHERE matched_arlis_id = ${ALIAS}
    `;
    assert.equal(rows.length, 1, 'alias did not resolve to exactly one document');
    assert.equal(rows[0]?.arlis_id, CANONICAL);
    assert.equal(rows[0]?.match_kind, 'duplicate');
  });

  test('the canonical id still resolves to itself', async () => {
    const rows = await sql<{ arlis_id: number; match_kind: string }[]>`
      SELECT arlis_id, match_kind FROM document_by_any_arlis_id
      WHERE matched_arlis_id = ${CANONICAL}
    `;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.match_kind, 'canonical');
  });

  test('both ids resolve to the SAME document row', async () => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(DISTINCT id)::int AS n
      FROM document_by_any_arlis_id
      WHERE matched_arlis_id IN (${CANONICAL}, ${ALIAS})
    `;
    assert.equal(row?.n, 1, 'alias and canonical map to different documents');
  });

  test('an alias cannot shadow another document’s canonical id', async () => {
    const [other] = await sql<{ id: string }[]>`
      INSERT INTO documents (arlis_id, doc_type, title_hy, status, arlis_url)
      VALUES (999001, 'law', 'test', 'in_force', 'https://example.invalid')
      RETURNING id
    `;
    try {
      await assert.rejects(
        () => sql`
          INSERT INTO document_aliases (arlis_id, document_id, reason)
          VALUES (${CANONICAL}, ${other!.id}, 'duplicate')
        `,
        /already the canonical id/,
        'trigger did not block the collision',
      );
    } finally {
      await sql`DELETE FROM documents WHERE arlis_id = 999001`;
    }
  });
});
