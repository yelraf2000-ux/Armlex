/**
 * Schema integrity check.
 *
 * Asserts that everything the application depends on actually exists in the
 * connected database: extensions, tables, key columns, indexes (including the
 * halfvec HNSW index, which silently fails to build on older pgvector), the
 * alias-collision trigger, and the generated FTS columns.
 *
 * Exits non-zero on any missing object, so it can gate CI or a deploy.
 *
 * Usage: npm run db:verify
 */
import postgres from 'postgres';
import { config } from '@armlex/shared';

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

const EXPECTED_TABLES = [
  'documents',
  'articles',
  'article_refs',
  'embeddings',
  'sessions',
  'messages',
  'session_chunks',
  'eval_questions',
  'crawl_log',
  'document_aliases',
  'schema_migrations',
];

const EXPECTED_INDEXES = [
  'documents_status_idx',
  'documents_doc_type_idx',
  'documents_retrievable_idx',
  'articles_document_idx',
  'articles_tsv_hy_idx',
  'articles_tsv_ru_idx',
  'articles_number_trgm_idx',
  'article_refs_to_idx',
  'embeddings_vector_hnsw_idx',
  'document_aliases_document_idx',
  'messages_session_idx',
];

const EXPECTED_COLUMNS: [string, string][] = [
  ['documents', 'rag_eligible'],
  ['documents', 'act_number'],
  ['documents', 'act_number_suffix'],
  ['documents', 'content_hash_hy'],
  ['documents', 'hy_amended_at'],
  ['articles', 'tsv_hy'],
  ['articles', 'tsv_ru'],
  ['articles', 'ord'],
  ['articles', 'chapter_title'],
  ['embeddings', 'lang_used'],
  ['document_aliases', 'document_id'],
];

async function main(): Promise<void> {
  const sql = postgres(config.databaseUrl, { onnotice: () => {} });
  const checks: Check[] = [];

  try {
    // --- extensions --------------------------------------------------------
    const exts = (
      await sql<{ extname: string; extversion: string }[]>`
        SELECT extname, extversion FROM pg_extension
      `
    ).reduce<Record<string, string>>(
      (acc, r) => ({ ...acc, [r.extname]: r.extversion }),
      {},
    );

    for (const ext of ['vector', 'pg_trgm']) {
      checks.push({
        label: `extension ${ext}`,
        ok: Boolean(exts[ext]),
        detail: exts[ext] ? `v${exts[ext]}` : 'MISSING',
      });
    }

    // halfvec (needed by the embeddings index) landed in pgvector 0.7.0.
    const vectorVersion = exts['vector'];
    if (vectorVersion) {
      const [major = '0', minor = '0'] = vectorVersion.split('.');
      const supportsHalfvec =
        Number(major) > 0 || (Number(major) === 0 && Number(minor) >= 7);
      checks.push({
        label: 'pgvector supports halfvec (>= 0.7.0)',
        ok: supportsHalfvec,
        detail: supportsHalfvec ? `v${vectorVersion}` : `v${vectorVersion} too old`,
      });
    }

    // --- tables ------------------------------------------------------------
    const tables = new Set(
      (
        await sql<{ tablename: string }[]>`
          SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        `
      ).map((r) => r.tablename),
    );
    for (const t of EXPECTED_TABLES) {
      checks.push({
        label: `table ${t}`,
        ok: tables.has(t),
        detail: tables.has(t) ? 'present' : 'MISSING',
      });
    }

    // --- columns -----------------------------------------------------------
    const cols = new Set(
      (
        await sql<{ table_name: string; column_name: string }[]>`
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
        `
      ).map((r) => `${r.table_name}.${r.column_name}`),
    );
    for (const [t, c] of EXPECTED_COLUMNS) {
      checks.push({
        label: `column ${t}.${c}`,
        ok: cols.has(`${t}.${c}`),
        detail: cols.has(`${t}.${c}`) ? 'present' : 'MISSING',
      });
    }

    // --- indexes -----------------------------------------------------------
    const indexes = new Map(
      (
        await sql<{ indexname: string; indexdef: string }[]>`
          SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
        `
      ).map((r) => [r.indexname, r.indexdef]),
    );
    for (const i of EXPECTED_INDEXES) {
      const def = indexes.get(i);
      checks.push({
        label: `index ${i}`,
        ok: Boolean(def),
        detail: def ? def.slice(def.indexOf('USING')).slice(0, 46) : 'MISSING',
      });
    }

    // The HNSW index must actually be hnsw over halfvec, not silently a btree.
    const hnsw = indexes.get('embeddings_vector_hnsw_idx') ?? '';
    checks.push({
      label: 'embeddings index is HNSW over halfvec',
      ok: /USING hnsw/i.test(hnsw) && /halfvec/i.test(hnsw),
      detail: hnsw ? hnsw.slice(hnsw.indexOf('USING')).slice(0, 46) : 'MISSING',
    });

    // --- enums -------------------------------------------------------------
    const enums = new Set(
      (
        await sql<{ typname: string }[]>`
          SELECT typname FROM pg_type WHERE typtype = 'e'
        `
      ).map((r) => r.typname),
    );
    for (const e of ['doc_type', 'doc_status', 'lang']) {
      checks.push({
        label: `enum ${e}`,
        ok: enums.has(e),
        detail: enums.has(e) ? 'present' : 'MISSING',
      });
    }

    // --- trigger guarding alias/canonical collisions -----------------------
    const [trg] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_trigger
      WHERE tgname = 'document_aliases_no_canonical_collision_trg'
        AND NOT tgisinternal
    `;
    checks.push({
      label: 'trigger document_aliases_no_canonical_collision_trg',
      ok: (trg?.count ?? 0) > 0,
      detail: (trg?.count ?? 0) > 0 ? 'present' : 'MISSING',
    });

    // --- view --------------------------------------------------------------
    const [view] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_views
      WHERE schemaname = 'public' AND viewname = 'document_by_any_arlis_id'
    `;
    checks.push({
      label: 'view document_by_any_arlis_id',
      ok: (view?.count ?? 0) > 0,
      detail: (view?.count ?? 0) > 0 ? 'present' : 'MISSING',
    });

    // --- migrations applied ------------------------------------------------
    const applied = await sql<{ name: string }[]>`
      SELECT name FROM schema_migrations ORDER BY name
    `;
    checks.push({
      label: 'migrations applied',
      ok: applied.length > 0,
      detail: applied.map((r) => r.name).join(', ') || 'NONE',
    });

    // --- report ------------------------------------------------------------
    const width = Math.max(...checks.map((c) => c.label.length));
    for (const c of checks) {
      console.log(
        `${c.ok ? 'ok  ' : 'FAIL'}  ${c.label.padEnd(width)}  ${c.detail}`,
      );
    }

    const failed = checks.filter((c) => !c.ok);
    console.log(
      `\n${checks.length - failed.length}/${checks.length} checks passed`,
    );

    if (failed.length > 0) {
      console.error(`\n${failed.length} check(s) failed`);
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('verification failed to run:', err);
  process.exit(1);
});
