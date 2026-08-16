/**
 * Chunker tests, run against real ARLIS snapshots.
 *
 * The two stress-test documents are chosen deliberately:
 *   180531 — an SRC order citing Tax Code articles 380.1 and 381 (cross-refs
 *            must survive chunking intact, or reference extraction breaks)
 *   178425 — a law that is nothing but rate tables (numeric integrity)
 *
 * Run: npx tsx --test packages/scraper/src/chunk/chunker.test.ts
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, actLatestUrl } from '@armlex/shared';
import { parseActPage, parseActBlocks } from '../parse/actPage.js';
import { chunkDocument } from './chunker.js';
import type { Chunk, DocumentContext } from './types.js';

async function chunkSnapshot(id: number): Promise<{
  chunks: Chunk[];
  strategy: string;
  anomalies: string[];
  sourceText: string;
}> {
  const html = await readFile(
    join(config.snapshotDir, `act-${id}-hy-latest.html`),
    'utf8',
  );
  const page = parseActPage(html);
  const blocks = parseActBlocks(html);
  const doc: DocumentContext = {
    arlisId: id,
    title: page.title,
    docType: 'test',
    status: 'in_force',
    sourceUrl: actLatestUrl(id),
    ...(page.actNumber ? { actNumber: page.actNumber.raw } : {}),
    ...(page.adoptedAt ? { adoptedAt: page.adoptedAt } : {}),
  };
  const res = chunkDocument(page, blocks, doc);
  return { ...res, sourceText: blocks.map((b) => b.text).join(' ') };
}

const digits = (s: string): string[] => s.match(/\d[\d.,]*/g) ?? [];

describe('metadata header is uniform across chunk kinds', async () => {
  let all: Chunk[] = [];

  before(async () => {
    for (const id of [109017, 180531, 178425, 223829]) {
      all.push(...(await chunkSnapshot(id)).chunks);
    }
  });

  test('every chunk carries the full header', () => {
    assert.ok(all.length > 400, 'expected chunks from all four documents');
    for (const c of all) {
      assert.ok(c.full.startsWith('[Document] '), `bad header: ${c.ref}`);
      assert.match(c.full, /\n\[Type\] .+ \| \[Status\] /);
      assert.match(c.full, /\n\[Location\] /);
      assert.match(c.full, /\n\[Source\] https:\/\/www\.arlis\.am\//);
      assert.ok(c.full.includes('\n---\n'), `no header terminator: ${c.ref}`);
    }
  });

  test('header is identical in shape for articles, points and tables', () => {
    const shapeOf = (c: Chunk): string =>
      c.full
        .slice(0, c.full.indexOf('\n---\n'))
        .split('\n')
        .map((l) => l.slice(0, l.indexOf(']') + 1))
        .join(',');

    const shapes = new Set(
      (['article', 'point', 'annex_table'] as const)
        .map((k) => all.find((c) => c.kind === k))
        .filter((c): c is Chunk => Boolean(c))
        .map(shapeOf),
    );
    // Optional [Title] line is the only permitted variation.
    assert.ok(shapes.size <= 2, `header shapes diverge: ${[...shapes].join(' / ')}`);
  });

  test('body text is never empty', () => {
    assert.equal(all.filter((c) => c.text.trim() === '').length, 0);
  });
});

describe('Tax Code (109017) — article chunking', async () => {
  test('every article is represented, hierarchy preserved', async () => {
    const { chunks, strategy } = await chunkSnapshot(109017);
    assert.equal(strategy, 'articles');

    // Oversized articles are split into parts (մաս), so chunks > articles.
    // The invariant that matters is that no article is LOST: all 474 must
    // still appear, each chunk still knowing its article and its ancestry.
    // (Was 457 — see actPage.test.ts for why that number was wrong.)
    const articleNumbers = new Set(chunks.map((c) => c.articleNumber));
    assert.equal(articleNumbers.size, 474, 'an article went missing in splitting');
    assert.ok(chunks.length >= 474);

    // Every article chunk knows its Մ Ա Ս / Բ Ա Ժ Ի Ն / Գ Լ ՈՒ Խ ancestry.
    assert.equal(chunks.filter((c) => c.path.length < 3).length, 0);
    assert.ok(chunks.every((c) => c.articleNumber));
  });

  test('part refs are unique — no article splits into duplicate parts', async () => {
    // Long articles contain sub-enumerations that restart at "1.", which a
    // naive split turned into three separate "Հոդված 341, մաս 1" chunks.
    // Part numbers must increase monotonically within an article.
    const { chunks } = await chunkSnapshot(109017);
    const refs = chunks.map((c) => c.ref);
    const dupes = refs.filter((r, i) => refs.indexOf(r) !== i);
    assert.deepEqual([...new Set(dupes)], [], 'duplicate part refs produced');
  });

  test('all 51 rate tables land inside chunks', async () => {
    const { chunks } = await chunkSnapshot(109017);
    assert.equal(
      chunks.reduce((n, c) => n + c.tableCount, 0),
      51,
    );
  });
});

describe('SRC order 180531 — cross-references survive chunking', async () => {
  test('cites Tax Code articles 380.1 and 381 inside chunk bodies', async () => {
    const { chunks } = await chunkSnapshot(180531);
    const body = chunks.map((c) => c.text).join('\n');

    // These are the references the milestone-4 cross-ref extractor must find.
    assert.match(body, /380\.1/, 'reference to art. 380.1 lost in chunking');
    assert.match(body, /381/, 'reference to art. 381 lost in chunking');
  });

  test('produces point and annex chunks, not one slab', async () => {
    const { chunks, strategy } = await chunkSnapshot(180531);
    assert.equal(strategy, 'points');
    assert.ok(chunks.length >= 4, `too coarse: ${chunks.length} chunks`);
    assert.ok(chunks.some((c) => c.kind === 'annex_text'));
    // No chunk should be so large it defeats retrieval.
    assert.ok(chunks.every((c) => c.charCount < 20_000));
  });
});

describe('Law 178425 — rate tables', async () => {
  test('tables are whole units, never split', async () => {
    const { chunks } = await chunkSnapshot(178425);
    const tables = chunks.filter((c) => c.kind === 'annex_table');
    assert.ok(tables.length > 0, 'no table chunks produced');

    for (const t of tables) {
      const lines = t.text.split('\n').filter(Boolean);
      assert.ok(lines[0]?.startsWith('|'), 'table chunk does not start with a row');
      assert.match(lines[1] ?? '', /^\|\s*---/, 'missing markdown separator row');
      assert.ok(lines.length >= 3, 'table chunk truncated to a stub');
    }
  });

  test('no numbers are lost or altered by chunking', async () => {
    const { chunks, sourceText } = await chunkSnapshot(178425);
    const inChunks = new Set(digits(chunks.map((c) => c.text).join(' ')));
    const missing = digits(sourceText).filter((d) => !inChunks.has(d));
    assert.deepEqual(
      missing.slice(0, 10),
      [],
      `${missing.length} numeric token(s) dropped during chunking`,
    );
  });
});
