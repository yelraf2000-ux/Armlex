/**
 * Milestone 3 ingestion: snapshots -> Postgres.
 *
 * Reads saved ARLIS HTML from data/snapshots (never the network), parses,
 * chunks, and writes documents + aliases + chunks. Reports chunk counts, size
 * distribution and parse anomalies.
 *
 * Reports by default; writes only with `--apply`, matching `buildRefs.ts`.
 *
 * That default is not a style choice. `npm run ingest` at the repo root is
 * itself `npm run ingest -w @armlex/backend`, so flags passed as
 * `npm run ingest -- --flag` are appended to the INNER npm command with no
 * second `--`. npm then claims any flag it recognises as its own — `--dry-run`
 * and `--only` are both npm options — and never forwards them to tsx. The
 * script sees an empty argv. On 2026-08-23 that turned an intended
 * `--dry-run --only 51` into a full re-ingest of all 21 documents, which
 * replaced every `articles` row and cascade-deleted all 5,139 embeddings and
 * the whole `article_refs` graph, taking the live site's vector leg down until
 * the disk cache was reloaded.
 *
 * With writing behind `--apply`, a swallowed flag now means "do nothing".
 * Bare positionals DO survive the double hop (`npm run audit -- 51` works), so
 * only option-shaped flags are affected.
 *
 * Usage — invoke DIRECTLY so flags survive:
 *   npx tsx packages/backend/src/ingest/run.ts                    report only
 *   npx tsx packages/backend/src/ingest/run.ts --doc 109017       report one act
 *   npx tsx packages/backend/src/ingest/run.ts --apply            write to DATABASE_URL
 *
 * Individual (-Ա) acts are registered as documents with rag_eligible = false
 * and are never chunked, per the milestone-2 decision.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { config, actLatestUrl, isRagEligible } from '@armlex/shared';
import {
  parseActPage,
  parseActBlocks,
  chunkDocument,
  TAX_CORPUS,
  resolveCanonicalId,
} from '@armlex/scraper';
import type { Chunk, DocumentContext, CorpusEntry } from '@armlex/scraper';

const APPLY = process.argv.includes('--apply');

/**
 * `--doc`, not `--only`: npm claims `--only` as its own option and eats it
 * before tsx ever sees it (see the header). `--doc` survives.
 */
const docIdx = Math.max(
  process.argv.indexOf('--doc'),
  process.argv.indexOf('--only'), // legacy spelling, kept working
);
const ONLY = docIdx >= 0 ? Number(process.argv[docIdx + 1]) : undefined;

interface DocReport {
  arlisId: number;
  canonicalId: number;
  isAlias: boolean;
  title: string;
  actNumber?: string;
  docType: string;
  ragEligible: boolean;
  structure: string;
  strategy: string;
  chunks: number;
  kinds: Record<string, number>;
  chars: { min: number; p50: number; p90: number; max: number; total: number };
  tablesInChunks: number;
  tablesParsed: number;
  anomalies: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
}

async function analyse(
  entry: CorpusEntry,
): Promise<{ report: DocReport; chunks: Chunk[]; doc: DocumentContext } | undefined> {
  const path = join(config.snapshotDir, `act-${entry.id}-hy-latest.html`);
  let html: string;
  try {
    html = await readFile(path, 'utf8');
  } catch {
    console.error(`  [${entry.id}] SNAPSHOT MISSING — run: npm run audit -- ${entry.id}`);
    return undefined;
  }

  const page = parseActPage(html);
  const canonicalId = resolveCanonicalId(entry.id);
  const ragEligible = isRagEligible(page.actNumber);

  const doc: DocumentContext = {
    arlisId: canonicalId,
    title: page.title,
    docType: entry.expect,
    status: 'in_force',
    sourceUrl: actLatestUrl(canonicalId),
    ...(page.actNumber ? { actNumber: page.actNumber.raw } : {}),
    ...(page.adoptedAt ? { adoptedAt: page.adoptedAt } : {}),
    ...(() => {
      const amended = page.amendments
        .map((a) => a.amendedAt)
        .filter((d): d is string => Boolean(d))
        .sort()
        .at(-1);
      return amended ? { lastAmendedAt: amended } : {};
    })(),
  };

  // Individual acts are registered but never parsed or indexed.
  const shouldChunk = ragEligible && canonicalId === entry.id;
  const { chunks, strategy, anomalies } = shouldChunk
    ? chunkDocument(page, parseActBlocks(html), doc)
    : { chunks: [] as Chunk[], strategy: 'none' as const, anomalies: [] as string[] };

  if (canonicalId !== entry.id) {
    anomalies.push(`alias of ${canonicalId} — not chunked separately`);
  }
  if (!ragEligible) anomalies.push('rag_eligible=false — registered only');

  // Chunk refs become articles.article_number, which is unique per document.
  const refs = chunks.map((c) => c.ref);
  const dupes = refs.filter((r, i) => refs.indexOf(r) !== i);
  if (dupes.length > 0) {
    anomalies.push(
      `${dupes.length} duplicate chunk ref(s): ${[...new Set(dupes)].slice(0, 3).join(', ')}`,
    );
  }

  const sizes = chunks.map((c) => c.charCount).sort((a, b) => a - b);

  return {
    chunks,
    doc,
    report: {
      arlisId: entry.id,
      canonicalId,
      isAlias: canonicalId !== entry.id,
      title: page.title,
      docType: entry.expect,
      ragEligible,
      structure: page.structure,
      strategy,
      chunks: chunks.length,
      kinds: chunks.reduce<Record<string, number>>(
        (a, c) => ({ ...a, [c.kind]: (a[c.kind] ?? 0) + 1 }),
        {},
      ),
      chars: {
        min: sizes[0] ?? 0,
        p50: percentile(sizes, 0.5),
        p90: percentile(sizes, 0.9),
        max: sizes.at(-1) ?? 0,
        total: sizes.reduce((a, b) => a + b, 0),
      },
      tablesInChunks: chunks.reduce((n, c) => n + c.tableCount, 0),
      tablesParsed: page.dataTables.length,
      anomalies,
      ...(page.actNumber ? { actNumber: page.actNumber.raw } : {}),
    },
  };
}

async function write(
  sql: postgres.Sql,
  doc: DocumentContext,
  chunks: Chunk[],
  entry: CorpusEntry,
  ragEligible: boolean,
  suffix: string | undefined,
): Promise<void> {
  await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO documents (
        arlis_id, doc_type, title_hy, status, adopted_at, arlis_url,
        last_checked_at, rag_eligible, act_number, act_number_suffix, hy_amended_at
      ) VALUES (
        ${doc.arlisId}, ${entry.expect}::doc_type, ${doc.title}, 'in_force',
        ${doc.adoptedAt ?? null}, ${doc.sourceUrl}, now(), ${ragEligible},
        ${doc.actNumber ?? null}, ${suffix ?? null}, ${doc.lastAmendedAt ?? null}
      )
      ON CONFLICT (arlis_id) DO UPDATE SET
        title_hy = EXCLUDED.title_hy,
        status = EXCLUDED.status,
        adopted_at = EXCLUDED.adopted_at,
        last_checked_at = now(),
        rag_eligible = EXCLUDED.rag_eligible,
        act_number = EXCLUDED.act_number,
        act_number_suffix = EXCLUDED.act_number_suffix,
        hy_amended_at = EXCLUDED.hy_amended_at,
        updated_at = now()
      RETURNING id
    `;
    const documentId = row!.id;

    // Re-ingestion replaces chunks wholesale; embeddings cascade away with them.
    await tx`DELETE FROM articles WHERE document_id = ${documentId}`;

    for (const c of chunks) {
      await tx`
        INSERT INTO articles (
          document_id, article_number, title, text_hy, status, ord,
          part_title, section_title, chapter_title, arlis_anchor_url
        ) VALUES (
          ${documentId}, ${c.ref}, ${c.title ?? null}, ${c.full}, 'in_force',
          ${c.ord}, ${c.path[0] ?? null}, ${c.path[1] ?? null},
          ${c.path[2] ?? null}, ${doc.sourceUrl}
        )
      `;
    }
  });
}

async function main(): Promise<void> {
  const targets = TAX_CORPUS.filter(
    (e) => !e.control && (ONLY === undefined || e.id === ONLY),
  );

  // Name the scope as well as the mode. A swallowed `--doc` shows up here as a
  // document count that does not match what was asked for — the signal that was
  // missing when this silently ingested all 21.
  const scope = ONLY === undefined ? 'ALL documents' : `act ${ONLY}`;
  console.log(
    `${APPLY ? 'APPLY — WRITING to the database' : 'REPORT ONLY — no database connection'}` +
      ` · ${scope} · ${targets.length} document(s) from snapshots\n`,
  );

  const reports: DocReport[] = [];
  const sql = APPLY ? postgres(config.databaseUrl, { onnotice: () => {} }) : undefined;

  try {
    for (const entry of targets) {
      const result = await analyse(entry);
      if (!result) continue;
      reports.push(result.report);

      const flag = result.report.isAlias
        ? ' [alias]'
        : result.report.ragEligible
          ? ''
          : ' [excluded]';
      console.log(
        `  [${entry.id}]${flag} ${result.report.chunks} chunks · ${result.report.strategy} · ${result.report.title.slice(0, 40)}`,
      );

      if (sql && !result.report.isAlias) {
        const page = parseActPage(
          await readFile(join(config.snapshotDir, `act-${entry.id}-hy-latest.html`), 'utf8'),
        );
        await write(
          sql,
          result.doc,
          result.chunks,
          entry,
          result.report.ragEligible,
          page.actNumber?.suffix,
        );
      }
    }

    // Aliases are registered after their canonical documents exist.
    if (sql) {
      for (const r of reports.filter((x) => x.isAlias)) {
        await sql`
          INSERT INTO document_aliases (arlis_id, document_id, reason)
          SELECT ${r.arlisId}, d.id, 'duplicate'
          FROM documents d WHERE d.arlis_id = ${r.canonicalId}
          ON CONFLICT (arlis_id) DO NOTHING
        `;
      }
    }

    report(reports);

    if (!APPLY) {
      console.log(
        '\nREPORT ONLY — nothing written. To write:\n' +
          '  npx tsx packages/backend/src/ingest/run.ts --apply\n' +
          'Invoke the file directly; `npm run ingest -- --apply` loses the flag.',
      );
    }
  } finally {
    await sql?.end();
  }
}

function report(reports: DocReport[]): void {
  const ingested = reports.filter((r) => !r.isAlias && r.ragEligible);
  const all = ingested.flatMap((r) => r.chars);
  const totalChunks = ingested.reduce((n, r) => n + r.chunks, 0);
  const totalChars = ingested.reduce((n, r) => n + r.chars.total, 0);

  console.log('\n## Chunks per document\n');
  console.log(
    '| Act id | Type | Strategy | Chunks | Kinds | min | p50 | p90 | max | Tables |',
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of reports) {
    const kinds = Object.entries(r.kinds)
      .map(([k, v]) => `${k.replace('annex_', 'anx_')}:${v}`)
      .join(' ');
    console.log(
      `| ${r.arlisId}${r.isAlias ? ' (alias)' : ''} | ${r.docType} | ${r.strategy} | ${r.chunks} | ${kinds || '—'} | ${r.chars.min} | ${r.chars.p50} | ${r.chars.p90} | ${r.chars.max} | ${r.tablesInChunks}/${r.tablesParsed} |`,
    );
  }

  console.log(`\n## Totals\n`);
  console.log(`documents ingested : ${ingested.length}`);
  console.log(`aliases registered : ${reports.filter((r) => r.isAlias).length}`);
  console.log(`total chunks       : ${totalChunks}`);
  console.log(`total characters   : ${totalChars.toLocaleString()}`);
  console.log(
    `mean chunk size    : ${Math.round(totalChars / Math.max(1, totalChunks))} chars`,
  );
  console.log(
    `tables captured    : ${ingested.reduce((n, r) => n + r.tablesInChunks, 0)} / ${ingested.reduce((n, r) => n + r.tablesParsed, 0)} parsed`,
  );
  void all;

  const anomalies = reports.filter((r) => r.anomalies.length > 0);
  console.log(`\n## Anomalies\n`);
  if (anomalies.length === 0) {
    console.log('none');
  } else {
    for (const r of anomalies) {
      console.log(`- **${r.arlisId}**: ${r.anomalies.join('; ')}`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
