/**
 * Populate `article_refs` from the cross-references written in article text.
 *
 * Pure extraction lives in `extractRefs.ts` and is unit-tested; this file only
 * resolves the extracted citations to article ids and writes the edges.
 *
 * Dry run by default. Pass `--apply` to write. A bad ref table is worse than an
 * empty one — retrieval expands one hop through these edges, so a wrong edge
 * silently drags an unrelated provision into the generation context, where it
 * looks exactly as authoritative as a correct one.
 *
 * Usage:
 *   npx tsx packages/backend/src/ingest/buildRefs.ts            # report only
 *   npx tsx packages/backend/src/ingest/buildRefs.ts --apply    # write
 */
import postgres from 'postgres';
import { config } from '@armlex/shared';
import { extractCitations } from './extractRefs.js';

/** ARLIS id of the Tax Code — the target of every «Օրենսգրքի …» citation. */
const TAX_CODE_ARLIS_ID = 109017;

const sql = postgres(config.databaseUrl, { onnotice: () => {} });

interface ArticleRow {
  id: string;
  document_id: string;
  arlis_id: number;
  article_number: string;
  text_hy: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const articles = await sql<ArticleRow[]>`
    SELECT a.id, a.document_id, d.arlis_id, a.article_number, a.text_hy
    FROM articles a
    JOIN documents d ON d.id = a.document_id
    WHERE d.rag_eligible AND d.status = 'in_force' AND a.status = 'in_force'
  `;

  // Resolution index. Citations name a bare number ("254"); chunks are stored
  // with the full ref ("Հոդված 254"), so the index is keyed by the pair that
  // identifies an article uniquely: which act, and which number in it.
  const byActAndNumber = new Map<string, string>();
  for (const a of articles) {
    const m = /^Հոդված\s+(\S+?)\.?$/u.exec(a.article_number.trim());
    if (m) byActAndNumber.set(`${a.arlis_id}|${m[1]}`, a.id);
  }

  /** Acts that have any Հոդված chunks — decisions and orders do not. */
  const actsWithArticles = new Set(
    [...byActAndNumber.keys()].map((k) => Number(k.split('|')[0])),
  );

  const edges = new Set<string>();
  let citations = 0;
  let unresolved = 0;
  let selfRefs = 0;
  let missingTarget = 0;
  let unnamedAct = 0;
  const unresolvedSample: string[] = [];

  for (const a of articles) {
    for (const c of extractCitations(a.text_hy)) {
      citations++;
      const targetAct = c.scope === 'tax-code' ? TAX_CODE_ARLIS_ID : a.arlis_id;
      const to = byActAndNumber.get(`${targetAct}|${c.articleNumber}`);

      if (!to) {
        unresolved++;
        // Two very different reasons, and only one of them is a defect.
        //
        // A government decision is chunked into points and annexes and has no
        // Հոդված chunks at all, so a bare "17-րդ հոդվածով" inside one cannot
        // mean its own text — it means some act the sentence does not name.
        // That stays unresolved on purpose: a guessed edge would pull an
        // unrelated provision into generation looking just as authoritative
        // as a correct one.
        //
        // The other reason is a target genuinely absent from the corpus.
        if (actsWithArticles.has(targetAct)) missingTarget++;
        else unnamedAct++;
        if (unresolvedSample.length < 8) {
          unresolvedSample.push(`${a.arlis_id}#${a.article_number} → ${targetAct}#Հոդված ${c.articleNumber}`);
        }
        continue;
      }
      // An article citing itself carries no information for one-hop expansion.
      if (to === a.id) {
        selfRefs++;
        continue;
      }
      edges.add(`${a.id}|${to}`);
    }
  }

  console.log(`articles scanned : ${articles.length}`);
  console.log(`citations found  : ${citations}`);
  console.log(`  resolved edges : ${edges.size} (unique)`);
  console.log(`  self-refs      : ${selfRefs} (dropped — no information for expansion)`);
  console.log(`  unresolved     : ${unresolved}`);
  console.log(`    act not named : ${unnamedAct} (citing doc has no articles — cannot be a self-reference)`);
  console.log(`    target absent : ${missingTarget} (article not in the corpus, likely repealed)`);
  if (unresolvedSample.length) {
    console.log('\nunresolved sample (target article not in the corpus):');
    for (const u of unresolvedSample) console.log(`  ${u}`);
  }

  // Most-cited articles: a sanity check on the extraction. The provisions
  // everything defers to should be the ones a tax practitioner would name.
  const inDegree = new Map<string, number>();
  for (const e of edges) {
    const to = e.split('|')[1]!;
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }
  const label = new Map(articles.map((a) => [a.id, `${a.arlis_id}#${a.article_number}`]));
  const top = [...inDegree.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
  console.log('\nmost-cited articles:');
  for (const [id, n] of top) console.log(`  ${String(n).padStart(4)}  ${label.get(id)}`);

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to populate article_refs.');
    await sql.end();
    return;
  }

  const rows = [...edges].map((e) => {
    const [from, to] = e.split('|');
    return { from_article_id: from!, to_article_id: to! };
  });

  await sql.begin(async (tx) => {
    // Rebuild wholesale rather than merging. Edges are derived data with no
    // independent value, so a full replace keeps the table consistent with the
    // current extractor instead of accumulating the output of every past
    // version of it.
    await tx`DELETE FROM article_refs`;
    for (let i = 0; i < rows.length; i += 1000) {
      await tx`INSERT INTO article_refs ${tx(rows.slice(i, i + 1000))} ON CONFLICT DO NOTHING`;
    }
  });

  const [tally] = await sql<{ count: string }[]>`SELECT count(*) FROM article_refs`;
  console.log(`\nwrote article_refs: ${tally?.count ?? '?'} rows`);
  await sql.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
