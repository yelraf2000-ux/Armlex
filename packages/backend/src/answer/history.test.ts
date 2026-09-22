/**
 * Trimming a long conversation down to what still fits.
 *
 * Run: npx tsx --test packages/backend/src/answer/history.test.ts
 */
import { test, describe as suite } from 'node:test';
import assert from 'node:assert/strict';
import { fitHistory, isContextOverflow, HISTORY_BUDGET_CHARS } from './history.js';

const turn = (role: 'user' | 'assistant', n: number, size = 10) => ({
  role,
  content: `${role[0]}${n}`.padEnd(size, '.'),
});

/** A conversation of `pairs` exchanges, each message `size` characters. */
const conversation = (pairs: number, size = 10) =>
  Array.from({ length: pairs * 2 }, (_, i) =>
    turn(i % 2 === 0 ? 'user' : 'assistant', Math.floor(i / 2) + 1, size),
  );

suite('fitHistory', () => {
  test('an ordinary consultation is sent whole', () => {
    const turns = conversation(6, 2000);
    const fitted = fitHistory(turns);
    assert.equal(fitted.dropped, 0);
    assert.deepEqual(fitted.turns, turns);
  });

  test('a runaway conversation keeps its most recent turns', () => {
    const turns = conversation(10, 1000);
    const fitted = fitHistory(turns, 4000);
    assert.equal(fitted.turns.length + fitted.dropped, turns.length);
    assert.ok(fitted.dropped > 0);
    // The last turn is always the newest one.
    assert.deepEqual(fitted.turns.at(-1), turns.at(-1));
    assert.ok(
      fitted.turns.reduce((n, t) => n + t.content.length, 0) <= 4000,
      'within budget',
    );
  });

  test('never opens with an assistant turn — the API refuses that', () => {
    // A budget that would otherwise cut mid-exchange.
    for (let budget = 500; budget <= 5000; budget += 500) {
      const fitted = fitHistory(conversation(10, 1000), budget);
      if (fitted.turns.length > 0) {
        assert.equal(fitted.turns[0]!.role, 'user', `budget ${budget}`);
      }
    }
  });

  test('one oversized answer does not empty the conversation', () => {
    const turns = [turn('user', 1, 100), turn('assistant', 1, 50_000)];
    const fitted = fitHistory(turns, 1000);
    assert.equal(fitted.turns.length, 0, 'a lone assistant turn cannot lead');
    assert.equal(fitted.dropped, 2);

    const withQuestion = [...turns, turn('user', 2, 80_000)];
    const kept = fitHistory(withQuestion, 1000);
    assert.equal(kept.turns.length, 1);
    assert.equal(kept.turns[0]!.role, 'user');
  });

  test('an empty history stays empty', () => {
    assert.deepEqual(fitHistory([]), { turns: [], dropped: 0 });
  });

  test('the budget leaves room for the fragments and the answer', () => {
    // ~1.7 tokens per Armenian character, 200,000 of context.
    assert.ok(HISTORY_BUDGET_CHARS * 1.7 < 200_000 - 85_000 - 16_000);
  });
});

suite('isContextOverflow', () => {
  test('recognises how the providers say it', () => {
    assert.ok(isContextOverflow(new Error('prompt is too long: 214038 tokens > 200000 maximum')));
    assert.ok(isContextOverflow({ message: 'stop_reason: model_context_window_exceeded' }));
    assert.ok(isContextOverflow({ message: "This model's maximum context length is 200000 tokens" }));
  });

  test('leaves other failures to the generic handler', () => {
    assert.equal(isContextOverflow(new Error('Your credit balance is too low')), false);
    assert.equal(isContextOverflow(undefined), false);
  });
});
