/**
 * Pins the 22-question hand-test to a file.
 *
 * The 47% "full" figure is Flash-Lite grading its own answers. Step 1 in
 * PROJECT-STATE is a human check of 22 of those verdicts, and until this
 * script existed the 22 were only a RECIPE (10 full / 6 worsened / 6 none),
 * so no two sessions would test the same questions and no result could be
 * attributed to a question after the fact.
 *
 * Selection is deterministic: each bucket is sorted by url and sampled at
 * even spacing, so re-running over the same triage files reproduces the same
 * 22. `ՏՏ ոլորտի ԱՁ` is forced first in the worsened bucket — it is the
 * IT-benefits case the enumeration work started from.
 *
 * Usage:
 *   npx tsx packages/backend/src/eval/handtest-sheet.ts \
 *     data/eval/triage-results-preTier1.jsonl \
 *     data/eval/triage-results.jsonl \
 *     data/eval/handtest-22.md
 */
import { readFile, writeFile } from 'node:fs/promises';

interface Row {
  url: string;
  title: string;
  coverage: string | null;
  invalidQuotes?: number;
  articles?: string[];
  error?: string;
}

const RANK: Record<string, number> = { none: 0, partial: 1, full: 2 };
const FORCE_FIRST = 'ՏՏ ոլորտի';

async function load(path: string): Promise<Map<string, Row>> {
  const raw = await readFile(path, 'utf8');
  return new Map(
    raw.split('\n').filter(Boolean).map((l) => {
      const r = JSON.parse(l) as Row;
      return [r.url, r];
    }),
  );
}

/** Even spacing across a sorted bucket — a contiguous slice would sample one
 *  region of the site's history rather than the whole set. */
function spread<T>(items: T[], k: number): T[] {
  if (items.length <= k) return items;
  const out: T[] = [];
  for (let i = 0; i < k; i++) out.push(items[Math.round((i * (items.length - 1)) / (k - 1))]!);
  return out;
}

async function main(): Promise<void> {
  const [beforePath, afterPath, outPath] = process.argv.slice(2);
  if (!beforePath || !afterPath || !outPath) {
    console.error('usage: handtest-sheet.ts <before.jsonl> <after.jsonl> <out.md>');
    process.exit(1);
  }

  const before = await load(beforePath);
  const after = await load(afterPath);
  const questions = new Map(
    (await readFile('data/eval/accountant-am.jsonl', 'utf8'))
      .split('\n').filter(Boolean)
      .map((l) => { const r = JSON.parse(l) as { url: string; question: string }; return [r.url, r.question]; }),
  );

  const common = [...after.keys()].filter((u) => before.has(u)).sort();

  const full = common.filter((u) => after.get(u)!.coverage === 'full');
  const none = common.filter((u) => after.get(u)!.coverage === 'none');
  const worsened = common.filter((u) => {
    const rb = RANK[before.get(u)!.coverage ?? ''] ?? -1;
    const ra = RANK[after.get(u)!.coverage ?? ''] ?? -1;
    return ra < rb;
  });

  const forced = worsened.filter((u) => after.get(u)!.title.includes(FORCE_FIRST));
  const worsenedPick = [...forced, ...spread(worsened.filter((u) => !forced.includes(u)), 6 - forced.length)];

  const buckets: Array<[string, string, string[]]> = [
    ['A', `10 graded \`full\` — if 8 hold up, 47% is real; if 5, the true figure is ~25%`, spread(full, 10)],
    ['B', `6 of the ${worsened.length} that WORSENED since Tier 1`, worsenedPick],
    ['C', `6 graded \`none\` — corpus gap, or an article we hold and did not deliver?`, spread(none, 6)],
  ];

  const lines: string[] = [
    '# The 22-question hand-test',
    '',
    'Step 1 in `PROJECT-STATE.md`. The 47% `full` figure is Flash-Lite grading its',
    'own answers; nobody has checked whether a `full` verdict means an answer an',
    'accountant would send. **Only the owner can score this** — the grader cannot',
    'grade itself.',
    '',
    'Score in three buckets, nothing finer:',
    '',
    '| verdict | means |',
    '|---|---|',
    '| `SEND` | would send to a client as-is |',
    '| `USELESS` | not wrong, but does not answer the question |',
    '| `WRONG` | wrong, or refused when it should not have |',
    '',
    'Fill the `verdict` column below. Selection is deterministic — regenerate with',
    '`npx tsx packages/backend/src/eval/handtest-sheet.ts data/eval/triage-results-preTier1.jsonl data/eval/triage-results.jsonl data/eval/handtest-22.md`',
    '',
    '## Scoreboard',
    '',
    '| # | bucket | title | triage verdict | verdict | note |',
    '|---|---|---|---|---|---|',
  ];

  let n = 0;
  const detail: string[] = [];
  for (const [tag, , urls] of buckets) {
    for (const u of urls) {
      n++;
      const a = after.get(u)!;
      const b = before.get(u)!;
      const graded = tag === 'B' ? `${b.coverage} → ${a.coverage}` : (a.coverage ?? 'error');
      lines.push(`| ${n} | ${tag} | ${a.title} | ${graded} | | |`);
    }
  }

  for (const [tag, why, urls] of buckets) {
    detail.push('', `## Bucket ${tag} — ${why}`, '');
    for (const u of urls) {
      const a = after.get(u)!;
      const b = before.get(u)!;
      const q = (questions.get(u) ?? '(question text not found)').replace(/\s+/g, ' ').trim();
      detail.push(
        `### ${a.title}`,
        '',
        `- triage: **${tag === 'B' ? `${b.coverage} → ${a.coverage}` : a.coverage}**` +
          `${a.invalidQuotes ? ` · ${a.invalidQuotes} quote(s) stripped` : ''}`,
        `- source: ${decodeURIComponent(u)}`,
        `- delivered articles: ${(a.articles ?? []).join(', ') || '(none)'}`,
        '',
        '> ' + q.replace(/\n/g, '\n> '),
        '',
      );
    }
  }

  await writeFile(outPath, [...lines, ...detail].join('\n') + '\n', 'utf8');
  console.log(`wrote ${outPath}: ${n} questions (full ${full.length}, worsened ${worsened.length}, none ${none.length} available)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
