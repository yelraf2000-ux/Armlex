/**
 * Measure what part-level (մաս) sub-article chunking would produce, BEFORE
 * committing to a re-embed.
 *
 * Armenian legal hierarchy inside an article:
 *   `1.`  մաս      (part)      <- the right split level
 *   `1)`  կետ      (point)     <- too fine, shreds the article
 *   `ա.`  ենթակետ  (sub-point) <- far too fine
 *
 * Splitting only at `N.` line starts, never inside a markdown table.
 *
 * Usage: npx tsx packages/backend/src/embed/partsplit-analysis.ts
 */
import 'dotenv/config';
import postgres from 'postgres';
import { config } from '@armlex/shared';

const HEADER_SEP = '\n---\n';

/** Part marker: "1. " at line start. NOT "1) " (point) or "ա. " (sub-point). */
const PART_RE = /^(\d{1,3})\.\s+\S/;

interface Piece {
  partNumber: string | null;
  text: string;
}

/**
 * Split an article body at part boundaries, keeping markdown tables intact.
 * A table row can begin with a digit, so line-start matching alone would cut
 * a rate table in half — which is the one failure this project must not have.
 */
export function splitIntoParts(body: string): Piece[] {
  const lines = body.split('\n');
  const pieces: Piece[] = [];
  let current: Piece = { partNumber: null, text: '' };
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Track table regions: markdown rows start with '|'.
    if (trimmed.startsWith('|')) inTable = true;
    else if (inTable && trimmed === '') inTable = false;

    const m = !inTable ? PART_RE.exec(trimmed) : null;
    if (m) {
      if (current.text.trim()) pieces.push(current);
      current = { partNumber: m[1]!, text: line };
    } else {
      current.text += (current.text ? '\n' : '') + line;
    }
  }
  if (current.text.trim()) pieces.push(current);
  return pieces;
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

function describe(label: string, sizes: number[]): void {
  const s = [...sizes].sort((a, b) => a - b);
  const total = s.reduce((a, b) => a + b, 0);
  console.log(
    `${label.padEnd(26)} n=${String(s.length).padStart(5)}  ` +
      `p50=${String(pct(s, 0.5)).padStart(6)}  p90=${String(pct(s, 0.9)).padStart(6)}  ` +
      `max=${String(s.at(-1)).padStart(6)}  >8k=${s.filter((x) => x > 8000).length}  ` +
      `total=${(total / 1000).toFixed(0)}k`,
  );
}

async function main(): Promise<void> {
  const sql = postgres(config.databaseUrl, { onnotice: () => {} });
  try {
    const rows = await sql<{ arlis_id: number; article_number: string; text_hy: string }[]>`
      SELECT d.arlis_id, a.article_number, a.text_hy
      FROM articles a JOIN documents d ON d.id = a.document_id
      ORDER BY a.id
    `;
    console.log(`chunks in DB: ${rows.length}\n`);

    const current = rows.map((r) => r.text_hy.length);
    describe('current (article-level)', current);

    // Try several thresholds: only split articles LARGER than the threshold,
    // so small articles keep their full context.
    for (const threshold of [4000, 6000, 8000, 12000]) {
      const sizes: number[] = [];
      let splitCount = 0;
      let producedParts = 0;

      for (const r of rows) {
        const sepIdx = r.text_hy.indexOf(HEADER_SEP);
        const header = sepIdx === -1 ? '' : r.text_hy.slice(0, sepIdx + HEADER_SEP.length);
        const body = sepIdx === -1 ? r.text_hy : r.text_hy.slice(sepIdx + HEADER_SEP.length);

        if (r.text_hy.length <= threshold) {
          sizes.push(r.text_hy.length);
          continue;
        }
        const parts = splitIntoParts(body);
        // Only useful if it actually divides; a single piece means no part
        // markers were found (e.g. a pure table article).
        if (parts.length < 2) {
          sizes.push(r.text_hy.length);
          continue;
        }
        splitCount++;
        producedParts += parts.length;
        for (const p of parts) sizes.push(header.length + p.text.length);
      }
      describe(`split >${threshold}ch`, sizes);
      console.log(
        `${''.padEnd(26)} ${splitCount} articles split -> ${producedParts} parts\n`,
      );
    }

    // Which oversized chunks would NOT be helped (no part markers)?
    console.log('=== oversized chunks that part-splitting cannot divide ===');
    let unhelped = 0;
    for (const r of rows) {
      if (r.text_hy.length <= 8000) continue;
      const sepIdx = r.text_hy.indexOf(HEADER_SEP);
      const body = sepIdx === -1 ? r.text_hy : r.text_hy.slice(sepIdx + HEADER_SEP.length);
      if (splitIntoParts(body).length < 2) {
        unhelped++;
        if (unhelped <= 8) {
          console.log(`  ${String(r.text_hy.length).padStart(6)}ch  ${r.arlis_id} ${r.article_number}`);
        }
      }
    }
    console.log(`  total: ${unhelped}`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
