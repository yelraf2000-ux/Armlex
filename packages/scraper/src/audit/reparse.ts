/**
 * Reparse a saved snapshot without touching the network.
 * Usage: npx tsx packages/scraper/src/audit/reparse.ts act-109017-hy-latest
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@armlex/shared';
import { parseActPage } from '../parse/actPage.js';

const name = process.argv[2];
if (!name) {
  console.error('usage: reparse.ts <snapshot-name-without-.html>');
  process.exit(1);
}

const html = await readFile(join(config.snapshotDir, `${name}.html`), 'utf8');
const page = parseActPage(html);

const numbers = page.articles.map((a) => a.number);
console.log(
  JSON.stringify(
    {
      title: page.title,
      bodyLang: page.bodyLang,
      langCharCounts: page.langCharCounts,
      adoptedAt: page.adoptedAt,
      articles: page.articles.length,
      uniqueNumbers: new Set(numbers).size,
      firstFive: page.articles.slice(0, 5),
      withChapter: page.articles.filter((a) => a.chapter).length,
      withSection: page.articles.filter((a) => a.section).length,
      withPart: page.articles.filter((a) => a.part).length,
      dataTables: page.dataTables.length,
      biggestTables: [...page.dataTables]
        .sort((a, b) => b.rows - a.rows)
        .slice(0, 3),
      amendments: page.amendments.length,
      latestAmendments: page.amendments.slice(0, 3),
    },
    null,
    2,
  ),
);
