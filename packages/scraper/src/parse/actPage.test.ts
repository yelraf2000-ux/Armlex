/**
 * Regression tests pinning the ARLIS structural assumptions discovered in the
 * milestone-2 audit. A site redesign is reportedly planned; when these fail,
 * the parser — not the caller — is what needs updating.
 *
 * Run: node --test --import tsx packages/scraper/src/parse/actPage.test.ts
 *
 * Requires the Tax Code snapshot. Regenerate with:
 *   npm run audit -- 109017
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@armlex/shared';
import { parseActPage, parseArmenianDate, parseDottedDate } from './actPage.js';
import type { ActPage } from './actPage.js';

const SNAPSHOT = join(config.snapshotDir, 'act-109017-hy-latest.html');

describe('date parsing', () => {
  test('Armenian long-form date', () => {
    assert.equal(
      parseArmenianDate('Ընդունված է 2016 թվականի հոկտեմբերի 4-ին'),
      '2016-10-04',
    );
  });

  test('dotted date from amendment labels', () => {
    assert.equal(parseDottedDate('18.06.2026, ՀՕ-257-Ն'), '2026-06-18');
  });

  test('returns undefined rather than guessing', () => {
    assert.equal(parseArmenianDate('no date here'), undefined);
    assert.equal(parseDottedDate('no date here'), undefined);
  });
});

describe('Tax Code (act 109017) structure', async () => {
  let page: ActPage | undefined;

  before(async () => {
    try {
      await access(SNAPSHOT);
    } catch {
      return; // snapshot absent; tests below skip
    }
    page = parseActPage(await readFile(SNAPSHOT, 'utf8'));
  });

  const needs = (): ActPage => {
    if (!page) {
      throw new Error(`snapshot missing: ${SNAPSHOT} — run: npm run audit -- 109017`);
    }
    return page;
  };

  test('parses every article heading', () => {
    const p = needs();
    // Was pinned at 457, which was WRONG — that count silently excluded every
    // article whose heading cell carries ARLIS's ⚖ court-practice anchor.
    // 474 is cross-checked two ways: a raw `Հոդված N` scan of the snapshot
    // finds 463 distinct numbers, all of which parse, plus 11 more written
    // with U+2024 dot leaders that the raw scan cannot see but the parser
    // normalises. 463 + 11 = 474, with no duplicates.
    assert.equal(p.articles.length, 474);
    assert.equal(new Set(p.articles.map((a) => a.number)).size, 474);
  });

  test('articles marked with the ⚖ court-practice anchor are not dropped', () => {
    // The heading cell reads "⚖Հոդված 2." — a `^Հոդված` anchor rejects it, and
    // the loss is invisible downstream because a missing article is
    // indistinguishable from a question the corpus does not cover.
    const p = needs();
    const numbers = new Set(p.articles.map((a) => a.number));
    for (const n of ['2', '4', '102', '103', '104', '105', '109', '238', '398', '408']) {
      assert.ok(numbers.has(n), `article ${n} dropped — ⚖ heading-prefix handling regressed`);
    }
  });

  test('handles U+2024 dot-leader article numbers', () => {
    const p = needs();
    for (const n of ['36.1', '293.1', '377']) {
      assert.ok(
        p.articles.some((a) => a.number === n),
        `article ${n} missing — dot-character normalisation regressed`,
      );
    }
  });

  test('attributes full hierarchy to every article', () => {
    const p = needs();
    const orphans = p.articles.filter(
      (a) => !a.chapter || !a.section || !a.part,
    );
    assert.equal(orphans.length, 0, `${orphans.length} articles lack hierarchy`);
  });

  test('separates rate tables from heading tables', () => {
    const p = needs();
    // Heading tables must never be reported as data tables.
    assert.ok(p.dataTables.length > 20, 'expected real rate tables');
    assert.ok(p.dataTables.length < 100, 'heading tables leaked into dataTables');
    assert.ok(p.dataTables.every((t) => t.rows > 1));
  });

  test('reads adoption date and amendment history', () => {
    const p = needs();
    assert.equal(p.adoptedAt, '2016-10-04');
    assert.ok(p.amendments.length > 100, 'amendment history not parsed');
    assert.ok(p.amendments.some((a) => a.amendedAt));
  });

  test('detects Armenian body language', () => {
    const p = needs();
    assert.equal(p.bodyLang, 'hy');
    assert.equal(p.langCharCounts.ru, 0, 'ARLIS unexpectedly served Russian');
  });
});
