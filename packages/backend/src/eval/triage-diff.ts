/**
 * Before/after comparison of two triage runs over the same real questions.
 *
 * The golden set says whether RETRIEVAL moved; this says whether ANSWERS did,
 * on the 250 authentic accountant questions — coverage distribution, which
 * questions changed verdict, and whether the enumeration articles the index
 * change targeted are now actually reached.
 *
 * Usage:
 *   npx tsx packages/backend/src/eval/triage-diff.ts \
 *     data/eval/triage-results-before.jsonl data/eval/triage-results.jsonl
 */
import { readFile } from 'node:fs/promises';

interface Row {
  url: string;
  title: string;
  coverage: string | null;
  invalidQuotes?: number;
  articles?: string[];
  error?: string;
}

const RANK: Record<string, number> = { none: 0, partial: 1, full: 2 };

async function load(path: string): Promise<Map<string, Row>> {
  const raw = await readFile(path, 'utf8');
  return new Map(raw.split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l) as Row; return [r.url, r]; }));
}

function dist(rows: Row[]): Record<string, number> {
  const d: Record<string, number> = { full: 0, partial: 0, none: 0, error: 0 };
  for (const r of rows) d[r.error ? 'error' : (r.coverage ?? 'error')]!++;
  return d;
}

function pct(n: number, total: number): string {
  return `${String(n).padStart(3)} (${((100 * n) / total).toFixed(0).padStart(2)}%)`;
}

async function main(): Promise<void> {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.error('usage: triage-diff.ts <before.jsonl> <after.jsonl>');
    process.exit(1);
  }
  const before = await load(beforePath);
  const after = await load(afterPath);
  const common = [...after.keys()].filter((u) => before.has(u));
  const n = common.length;
  console.log(`questions compared: ${n}\n`);

  const db = dist(common.map((u) => before.get(u)!));
  const da = dist(common.map((u) => after.get(u)!));
  console.log('coverage        before         after');
  for (const k of ['full', 'partial', 'none', 'error']) {
    console.log(`${k.padEnd(10)} ${pct(db[k]!, n)}   →  ${pct(da[k]!, n)}`);
  }

  // Verdict movement.
  let up = 0, down = 0, same = 0;
  const moved: string[] = [];
  for (const u of common) {
    const b = before.get(u)!, a = after.get(u)!;
    const rb = RANK[b.coverage ?? ''] ?? -1, ra = RANK[a.coverage ?? ''] ?? -1;
    if (ra === rb) { same++; continue; }
    ra > rb ? up++ : down++;
    moved.push(`  ${(b.coverage ?? 'err').padEnd(7)} → ${(a.coverage ?? 'err').padEnd(7)} ${a.title.slice(0, 60)}`);
  }
  console.log(`\nverdict movement: improved ${up}, worsened ${down}, unchanged ${same}`);
  for (const m of moved.sort()) console.log(m);

  // Did the targeted enumeration articles start reaching retrieval?
  const reach = (rows: Row[], ref: string): number =>
    rows.filter((r) => (r.articles ?? []).some((a) => a.endsWith(`#${ref}`))).length;
  console.log('\nretrieval reach of the enumeration articles (questions where retrieved):');
  for (const ref of ['Հոդված 258', 'Հոդված 254', 'Հոդված 64', 'Հոդված 267']) {
    const b = reach(common.map((u) => before.get(u)!), ref);
    const a = reach(common.map((u) => after.get(u)!), ref);
    console.log(`  ${ref.padEnd(12)} ${String(b).padStart(3)} → ${String(a).padStart(3)}`);
  }

  const iq = (rows: Row[]): number => rows.filter((r) => (r.invalidQuotes ?? 0) > 0).length;
  console.log(`\ninvalid-quote answers: ${iq(common.map((u) => before.get(u)!))} → ${iq(common.map((u) => after.get(u)!))}`);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
