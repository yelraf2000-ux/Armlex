/**
 * A dead vector leg must REFUSE, not return "nothing found".
 *
 * On 2026-08-25 the Gemini embedding balance ran out. Every query's vector leg
 * returned HTTP 429, retrieval fell back to FTS and found nothing, and the
 * model — correctly, given no fragments — told a user that no norm covering
 * their question exists, naming the Tax Code chapters it would have needed.
 * A billing failure rendered as a confident legal negative.
 *
 * The console warning that was supposed to prevent this had been there since
 * 2026-08-15. It fired. Nobody was reading the server log, and the user was
 * shown an answer. Hence a thrown error rather than a printed one.
 *
 * Run: npx tsx --test packages/backend/src/retrieval/vectorUnavailable.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VectorLegUnavailableError } from './retrieve.js';

describe('VectorLegUnavailableError', () => {
  test('carries the reason, so a billing failure is not read as a rate limit', () => {
    const e = new VectorLegUnavailableError('embedding API returned HTTP 429');
    assert.equal(e.reason, 'embedding API returned HTTP 429');
    assert.match(e.message, /vector retrieval unavailable/);
  });

  test('is distinguishable from an ordinary error by instanceof', () => {
    // The route branches on this to send `search_unavailable` rather than the
    // generic "chat failed" — the whole point is that this failure is named.
    const e: unknown = new VectorLegUnavailableError('GEMINI_API_KEY is not set');
    assert.ok(e instanceof VectorLegUnavailableError);
    assert.ok(e instanceof Error);
  });

  test('the name survives, which is what a log filter matches on', () => {
    assert.equal(new VectorLegUnavailableError('x').name, 'VectorLegUnavailableError');
  });
});
