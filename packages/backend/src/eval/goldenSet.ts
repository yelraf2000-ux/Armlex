/**
 * Load the verified golden set: question -> expected article keys.
 *
 * Extracted so the scorer, the confidence calibration and the threshold sweep
 * all read the file the same way. Three private copies of a CSV parser is three
 * chances for the benchmark and the calibration to disagree about what a
 * question's expected answer is — and a benchmark that disagrees with itself
 * cannot settle an argument, which is its only job.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const EVAL_DIR = join(process.cwd(), 'data', 'eval');

/** Minimal RFC4180 reader: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

/**
 * Article-level key.
 *
 * The golden set pins parts ("Հոդված 254, մաս 3") but retrieval resolves to the
 * article, so both sides are normalised to the article before comparison.
 */
export const toArticleKey = (k: string): string =>
  k.replace(/,\s*(մաս|ներածական)\b.*$/u, '').trim();

/** question -> set of expected "<arlisId>#<ref>" keys, article-normalised. */
export async function loadGoldenSet(
  file = 'golden_verified.csv',
): Promise<Map<string, Set<string>>> {
  const rows = parseCsvRows(await readFile(join(EVAL_DIR, file), 'utf8')).slice(1);
  const expected = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.length < 4) continue;
    const q = r[0]!;
    const set = expected.get(q) ?? expected.set(q, new Set()).get(q)!;
    set.add(toArticleKey(`${r[2]}#${r[3]}`));
  }
  return expected;
}

/** Cached query vectors, so an eval run needs no live embedding calls. */
export async function loadQueryVectors(
  model = 'gemini-embedding-2',
): Promise<Map<string, number[]>> {
  const raw = await readFile(
    join(process.cwd(), 'data', 'vectors', `${model}.queries.jsonl`),
    'utf8',
  );
  const out = new Map<string, number[]>();
  for (const line of raw.split('\n').filter(Boolean)) {
    const v = JSON.parse(line) as { id: string; vector: number[] };
    out.set(v.id, v.vector);
  }
  return out;
}

/**
 * Which script a question is written in.
 *
 * Reported by every eval that prints a headline number, because the golden set
 * is 42 Russian / 1 Armenian while real traffic measured on accountant.am is
 * 3 Russian / 247 Armenian. A metric taken here describes a language mix our
 * users do not send, and that caveat belongs next to the number, not in a doc
 * nobody rereads.
 */
export function questionScript(q: string): 'ru' | 'hy' {
  const cyrillic = (q.match(/[Ѐ-ӿ]/g) ?? []).length;
  const armenian = (q.match(/[԰-֏]/g) ?? []).length;
  return cyrillic > armenian ? 'ru' : 'hy';
}
