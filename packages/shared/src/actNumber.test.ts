/**
 * Tests for the -Ն / -Ա normativity classifier.
 * Run: npx tsx --test packages/shared/src/actNumber.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseActNumber, isRagEligible, describeEligibility } from './actNumber.js';

describe('parseActNumber', () => {
  test('law with normative suffix', () => {
    const n = parseActNumber('… ՀՕ-165-Ն 04.10.2016');
    assert.deepEqual(n, { raw: 'ՀՕ-165-Ն', series: 'ՀՕ', number: 165, suffix: 'Ն' });
  });

  test('pre-2018 law with no suffix', () => {
    const n = parseActNumber('ՀՕ-186 27.12.1997');
    assert.equal(n?.series, 'ՀՕ');
    assert.equal(n?.number, 186);
    assert.equal(n?.suffix, undefined);
  });

  test('government decision from body header', () => {
    const n = parseActNumber(
      'ՀԱՅԱՍՏԱՆԻ ՀԱՆՐԱՊԵՏՈՒԹՅԱՆ ԿԱՌԱՎԱՐՈՒԹՅՈՒՆ Ո Ր Ո Շ ՈՒ Մ 1 փետրվարի 2024 թվականի N 155-Ն',
    );
    assert.deepEqual(n, { raw: 'N 155-Ն', series: 'N', number: 155, suffix: 'Ն' });
  });

  test('individual decision', () => {
    const n = parseActNumber('ՀՀ ՎԱՐՉԱՊԵՏԻ ՈՐՈՇՈՒՄԸ … N 681-Ա');
    assert.equal(n?.suffix, 'Ա');
  });

  test('en dash instead of hyphen', () => {
    assert.equal(parseActNumber('N 1481–Ն')?.suffix, 'Ն');
    assert.equal(parseActNumber('ՀՕ–247–Ն')?.number, 247);
  });

  test('four-digit decision numbers', () => {
    const n = parseActNumber('… N 1935-Ն …');
    assert.equal(n?.number, 1935);
  });

  test('returns undefined when absent', () => {
    assert.equal(parseActNumber('no act number in this text'), undefined);
    // A bare number without the Ն/Ա suffix is not a decision reference.
    assert.equal(parseActNumber('N 155'), undefined);
  });

  test('law series wins when both patterns appear', () => {
    // Law bodies cite decision numbers; the act's own ՀՕ number is what counts.
    const n = parseActNumber('… փոփ. N 810-Ն … ՀՕ-165-Ն');
    assert.equal(n?.series, 'ՀՕ');
  });
});

describe('isRagEligible', () => {
  test('normative acts are eligible', () => {
    assert.equal(isRagEligible(parseActNumber('N 155-Ն')), true);
    assert.equal(isRagEligible(parseActNumber('ՀՕ-165-Ն')), true);
  });

  test('individual acts are excluded', () => {
    assert.equal(isRagEligible(parseActNumber('N 681-Ա')), false);
    assert.equal(isRagEligible(parseActNumber('N 486-Ա')), false);
  });

  test('pre-2018 unsuffixed acts stay eligible', () => {
    // Dropping a real 1997 tax law would be far worse than keeping noise.
    assert.equal(isRagEligible(parseActNumber('ՀՕ-186')), true);
  });

  test('unparseable act numbers default to eligible', () => {
    assert.equal(isRagEligible(undefined), true);
  });
});

describe('describeEligibility', () => {
  test('gives an auditable reason for each case', () => {
    assert.match(describeEligibility(parseActNumber('N 681-Ա')), /-Ա/);
    assert.match(describeEligibility(parseActNumber('N 155-Ն')), /-Ն/);
    assert.match(describeEligibility(parseActNumber('ՀՕ-186')), /pre-2018/);
    assert.match(describeEligibility(undefined), /default/);
  });
});
