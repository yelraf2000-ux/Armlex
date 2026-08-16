/**
 * Eyeball rate-table extraction fidelity against a saved snapshot.
 *
 * Usage: npx tsx packages/scraper/src/audit/inspectTables.ts act-109017-hy-latest [n]
 * Prints the n largest content tables as markdown, plus a numeric-integrity
 * check comparing digit runs in the source cells vs the rendered markdown.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { config } from '@armlex/shared';
import { tableToMarkdown, normalise } from '../parse/actPage.js';

const name = process.argv[2] ?? 'act-109017-hy-latest';
const count = Number(process.argv[3] ?? 2);

const html = await readFile(join(config.snapshotDir, `${name}.html`), 'utf8');
const $ = cheerio.load(html);

const candidates = $('#act_body table')
  .toArray()
  .filter((el) => $(el).parents('table').length === 0)
  .filter((el) => $(el).find('tr').length > 1)
  .map((el) => ({ el, rows: $(el).find('tr').length }))
  .sort((a, b) => b.rows - a.rows)
  .slice(0, count);

const digits = (s: string): string[] => s.match(/\d[\d.,]*/g) ?? [];

for (const { el, rows } of candidates) {
  const $t = $(el);
  const md = tableToMarkdown($, $t);

  const srcDigits = digits(normalise($t.text()));
  const mdDigits = digits(md);
  const missing = srcDigits.filter((d) => !mdDigits.includes(d));

  console.log(`\n${'='.repeat(70)}`);
  console.log(`rows=${rows}  numbers in source=${srcDigits.length}  in markdown=${mdDigits.length}`);
  console.log(missing.length === 0 ? 'NUMERIC INTEGRITY: ok' : `NUMERIC INTEGRITY: MISSING ${missing.slice(0, 10).join(', ')}`);
  console.log('='.repeat(70));
  console.log(md.split('\n').slice(0, 14).join('\n'));
  console.log(`... (${md.split('\n').length} lines total)`);
}
