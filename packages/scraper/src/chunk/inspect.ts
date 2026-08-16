/**
 * Inspect chunking of one snapshot, offline.
 * Usage: npx tsx packages/scraper/src/chunk/inspect.ts 180531 [--show 2]
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, actLatestUrl } from '@armlex/shared';
import { parseActPage, parseActBlocks } from '../parse/actPage.js';
import { chunkDocument } from './chunker.js';
import type { DocumentContext } from './types.js';

const id = Number(process.argv[2]);
if (!id) {
  console.error('usage: inspect.ts <arlisId> [--show N]');
  process.exit(1);
}
const showIdx = process.argv.indexOf('--show');
const show = showIdx >= 0 ? Number(process.argv[showIdx + 1] ?? 1) : 0;

const html = await readFile(
  join(config.snapshotDir, `act-${id}-hy-latest.html`),
  'utf8',
);
const page = parseActPage(html);
const blocks = parseActBlocks(html);

const doc: DocumentContext = {
  arlisId: id,
  title: page.title,
  docType: 'unknown',
  status: 'in_force',
  sourceUrl: actLatestUrl(id),
  ...(page.actNumber ? { actNumber: page.actNumber.raw } : {}),
  ...(page.adoptedAt ? { adoptedAt: page.adoptedAt } : {}),
};

const { chunks, strategy, anomalies } = chunkDocument(page, blocks, doc);

const sizes = chunks.map((c) => c.charCount).sort((a, b) => a - b);
const pct = (p: number): number => sizes[Math.floor((sizes.length - 1) * p)] ?? 0;

console.log(`act ${id} — ${page.title.slice(0, 56)}`);
console.log(`structure=${page.structure} strategy=${strategy} blocks=${blocks.length}`);
console.log(
  `chunks=${chunks.length} kinds=${JSON.stringify(
    chunks.reduce<Record<string, number>>(
      (a, c) => ({ ...a, [c.kind]: (a[c.kind] ?? 0) + 1 }),
      {},
    ),
  )}`,
);
console.log(
  `chars min=${sizes[0]} p50=${pct(0.5)} p90=${pct(0.9)} max=${sizes.at(-1)} total=${sizes.reduce((a, b) => a + b, 0).toLocaleString()}`,
);
console.log(
  `tables in chunks=${chunks.reduce((n, c) => n + c.tableCount, 0)} / parsed=${page.dataTables.length}`,
);
console.log(`anomalies: ${anomalies.length ? anomalies.join('; ') : 'none'}`);

for (let i = 0; i < show && i < chunks.length; i++) {
  const c = chunks[i]!;
  console.log(`\n${'='.repeat(72)}\n${c.full.slice(0, 900)}`);
}
