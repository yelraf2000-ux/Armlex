/**
 * Pipeline B — update detection (milestone 9).
 *
 * The corpus is a snapshot of a moving target. Armenian tax law is amended
 * several times a year, and a stale corpus fails in the worst possible way for
 * a legal tool: it answers confidently, cites a real article, and quotes text
 * that has been superseded. Nothing in the answer looks wrong.
 *
 * This job re-fetches every ingested document, compares it to what we stored,
 * and reports what moved. It does NOT re-ingest by default — the spec's
 * fail-safe rule is "serve old data, never ingest garbage", and a parser that
 * breaks against a redesigned page would otherwise overwrite a good corpus with
 * an empty one on a schedule, unattended. Pass `--apply` to act on the findings.
 *
 * Comparison is on PARSED TEXT, not raw HTML. ARLIS pages carry volatile markup
 * (counters, tokens, ad slots) that changes between requests without the law
 * changing at all; hashing the raw response would report every document as
 * modified every run, and a monitor that always alarms is a monitor nobody
 * reads.
 *
 * Usage:
 *   npm run crawl              detect and report; writes crawl_log
 *   npm run crawl -- --apply   accept the findings (records the new hashes)
 *
 *   npx tsx packages/backend/src/crawl/run.ts --limit 3
 *     First N documents only. Run it through npx, not npm: `npm run crawl --
 *     --limit 3` silently swallows `--limit` as an npm flag and checks the
 *     whole corpus.
 *
 * Exit code is non-zero when any document errored, so a scheduler reports a
 * failure instead of logging a green run that found nothing because it could
 * not fetch anything.
 */
import { createHash } from 'node:crypto';
import 'dotenv/config';
import { fetchPage, saveSnapshot, parseActPage, parseActBlocks, chunkDocument } from '@armlex/scraper';
import { actLatestUrl } from '@armlex/shared';
import { db, closeDb } from '../db/pool.js';

/** Consecutive quiet days after which silence is treated as a broken detector. */
const SUSPICIOUS_SILENCE_DAYS = 10;

interface DocRow {
  id: string;
  arlis_id: number;
  title_hy: string;
  content_hash_hy: string | null;
  doc_type: string;
}

interface Finding {
  arlisId: number;
  title: string;
  status: 'unchanged' | 'changed' | 'error';
  detail?: string;
  /** Article-level diff, when the document changed. */
  added?: string[];
  removed?: string[];
  modified?: string[];
}

const hash = (s: string): string =>
  createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex');

/**
 * Article-level diff between the live page and what is stored.
 *
 * Whole-document "changed" is not actionable — an amendment usually touches one
 * article out of several hundred, and knowing which one is the difference
 * between re-embedding 1 chunk and re-embedding 474.
 */
async function diffArticles(
  documentId: string,
  liveChunks: { ref: string; text: string }[],
): Promise<Pick<Finding, 'added' | 'removed' | 'modified'>> {
  const stored = await db()<{ article_number: string; text_hy: string }[]>`
    SELECT article_number, text_hy FROM articles WHERE document_id = ${documentId}
  `;

  // Both sides carry the same metadata header, but it embeds the amendment
  // date — so a document re-amended anywhere would show EVERY chunk as
  // modified. Comparing bodies only keeps the diff to provisions whose text
  // actually moved.
  const bodyOf = (text: string): string => {
    const marker = text.indexOf('\n---\n');
    return marker === -1 ? text : text.slice(marker + 5);
  };

  const storedByRef = new Map(stored.map((s) => [s.article_number.trim(), hash(bodyOf(s.text_hy))]));
  const liveByRef = new Map(liveChunks.map((c) => [c.ref.trim(), hash(bodyOf(c.text))]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [ref, h] of liveByRef) {
    const before = storedByRef.get(ref);
    if (before === undefined) added.push(ref);
    else if (before !== h) modified.push(ref);
  }
  for (const ref of storedByRef.keys()) if (!liveByRef.has(ref)) removed.push(ref);

  return { added, removed, modified };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : undefined;

  const all = await db()<DocRow[]>`
    SELECT id, arlis_id, title_hy, content_hash_hy, doc_type::text AS doc_type
    FROM documents
    WHERE rag_eligible AND status = 'in_force'
    ORDER BY arlis_id
  `;
  // Sliced in JS rather than via an interpolated LIMIT fragment — the fragment
  // form silently did nothing and the "limited" trial run hit all 20 documents.
  const docs = limit && limit > 0 ? all.slice(0, limit) : all;

  console.log(`crawl: checking ${docs.length} documents (delay per request is enforced by the http client)\n`);

  const findings: Finding[] = [];

  for (const doc of docs) {
    const url = actLatestUrl(doc.arlis_id, 'hy');
    try {
      const res = await fetchPage(url);
      if (res.status !== 200) {
        findings.push({ arlisId: doc.arlis_id, title: doc.title_hy, status: 'error', detail: `HTTP ${res.status}` });
        continue;
      }

      // Chunk exactly as ingestion would, so the comparison is against what we
      // would actually store rather than an approximation of it.
      const page = parseActPage(res.html);
      const { chunks } = chunkDocument(page, parseActBlocks(res.html), {
        arlisId: doc.arlis_id,
        title: page.title || doc.title_hy,
        docType: doc.doc_type,
        status: 'in_force',
        sourceUrl: url,
        ...(page.adoptedAt ? { adoptedAt: page.adoptedAt } : {}),
      });

      // A parse that suddenly yields nothing means the page structure moved,
      // NOT that the act was repealed. Treating it as a content change would
      // wipe a good document; it is an error that needs a human.
      if (chunks.length === 0) {
        findings.push({
          arlisId: doc.arlis_id,
          title: doc.title_hy,
          status: 'error',
          detail: 'parsed to zero chunks — page structure may have changed',
        });
        continue;
      }

      // The baseline is what we STORED, derived on the fly — not a hash column.
      //
      // `content_hash_hy` was never populated by ingestion, so comparing against
      // it reported all 20 documents as changed on the first run. Adding a
      // "record the baseline" step would have been worse than useless: it would
      // stamp the CURRENT page as the baseline, so any amendment made between
      // ingestion and the first crawl would be silently absorbed and never
      // reported. Comparing live chunks against stored chunks has no such blind
      // spot and needs no migration.
      const diff = await diffArticles(doc.id, chunks);
      const changedRefs =
        (diff.added?.length ?? 0) + (diff.removed?.length ?? 0) + (diff.modified?.length ?? 0);

      if (changedRefs === 0) {
        findings.push({ arlisId: doc.arlis_id, title: doc.title_hy, status: 'unchanged' });
        await db()`UPDATE documents SET last_checked_at = now() WHERE id = ${doc.id}`;
        continue;
      }

      const liveHash = hash(chunks.map((c) => `${c.ref}\n${c.text}`).join('\n'));
      findings.push({ arlisId: doc.arlis_id, title: doc.title_hy, status: 'changed', ...diff });

      // Keep the evidence regardless of --apply: whatever changed, we want the
      // HTML that showed it, without refetching.
      await saveSnapshot(`act-${doc.arlis_id}-hy-latest`, res.html);

      if (apply) {
        await db()`
          UPDATE documents
          SET content_hash_hy = ${liveHash}, last_checked_at = now()
          WHERE id = ${doc.id}
        `;
      }
    } catch (err) {
      findings.push({
        arlisId: doc.arlis_id,
        title: doc.title_hy,
        status: 'error',
        detail: String(err).slice(0, 200),
      });
    }
  }

  // --- report --------------------------------------------------------------

  const changed = findings.filter((f) => f.status === 'changed');
  const errors = findings.filter((f) => f.status === 'error');

  console.log(`unchanged : ${findings.filter((f) => f.status === 'unchanged').length}`);
  console.log(`changed   : ${changed.length}`);
  console.log(`errors    : ${errors.length}\n`);

  for (const c of changed) {
    console.log(`CHANGED ${c.arlisId} — ${c.title.slice(0, 60)}`);
    if (c.added?.length) console.log(`   added    : ${c.added.join(', ')}`);
    if (c.removed?.length) console.log(`   removed  : ${c.removed.join(', ')}`);
    if (c.modified?.length) console.log(`   modified : ${c.modified.join(', ')}`);
  }
  for (const e of errors) console.log(`ERROR   ${e.arlisId} — ${e.detail}`);

  await db()`
    INSERT INTO crawl_log (new_docs, changed_docs, errors)
    VALUES (0, ${changed.length}, ${db().json(errors.map((e) => ({ arlisId: e.arlisId, detail: e.detail })))})
  `;

  // --- monitoring ----------------------------------------------------------
  //
  // Silence is the failure mode that hides. A detector that has broken —
  // wrong URL shape, changed markup, an expired assumption — reports "nothing
  // changed" forever, and looks exactly like a quiet period in legislation.
  const [silence] = await db()<{ days: number | null }[]>`
    SELECT EXTRACT(DAY FROM now() - max(run_at))::int AS days
    FROM crawl_log WHERE changed_docs > 0
  `;
  const quietDays = silence?.days ?? null;
  if (quietDays !== null && quietDays >= SUSPICIOUS_SILENCE_DAYS) {
    console.log(
      `\nWARNING: no document has changed in ${quietDays} days. Armenian tax law ` +
        `is amended several times a year — verify the detector still works before ` +
        `trusting this silence.`,
    );
  }

  if (!apply && changed.length > 0) {
    console.log(`\nDetection only — nothing was updated. Re-run with --apply to accept these changes.`);
    console.log(`Then: npm run ingest && re-embed && load && buildRefs.`);
  }

  await closeDb();

  // Non-zero exit on error so a scheduler surfaces the failure instead of
  // logging a green run that found nothing because it could not fetch anything.
  if (errors.length > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
