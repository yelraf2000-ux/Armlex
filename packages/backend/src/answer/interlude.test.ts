/**
 * What may be shown to someone waiting for an answer.
 *
 * Tested rather than eyeballed because the failure is silent and expensive: a
 * sentence lifted out of its article can state the opposite of the law and
 * still read as authoritative, inside a product whose whole claim is that it
 * never does that. The case that made this concrete is in `stands alone`
 * below — a line from the article listing the acts the Tax Code REPEALED.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sentencesOf } from './interlude.js';

/** As chunks are stored: a metadata header, `---`, then the law. */
const chunk = (body: string): string =>
  `[Document] ՀՀ ԱՇԽԱՏԱՆՔԱՅԻՆ ՕՐԵՆՍԳԻՐՔ\n[Title] Փորձ\n---\n${body}`;

describe('sentencesOf', () => {
  test('takes a concrete rule and drops its part number', () => {
    const body = '1. Աշխատաժամանակի նորմալ տևողությունը չի կարող անցնել շաբաթական 40 ժամից:';
    assert.deepEqual(sentencesOf(chunk(body)), [
      'Աշխատաժամանակի նորմալ տևողությունը չի կարող անցնել շաբաթական 40 ժամից:',
    ]);
  });

  test('ignores the metadata header', () => {
    // The header names the act and its dates; quoting it would be quoting us.
    const out = sentencesOf(chunk('1. Ամենշաբաթյա անընդմեջ հանգիստը չպետք է պակաս լինի 35 ժամից:'));
    assert.ok(out.every((s) => !s.includes('ՕՐԵՆՍԳԻՐՔ')));
  });

  test('a rule with no figure in it is not worth showing', () => {
    // Without a rate, a sum or a period it is a definition, and a definition
    // means nothing away from the term it defines.
    const body = '1. Գործատուն պարտավոր է ապահովել աշխատողի աշխատանքի անվտանգ պայմանները սահմանված կարգով:';
    assert.deepEqual(sentencesOf(chunk(body)), []);
  });

  test('a line from a list of repealed acts is never shown', () => {
    // Հոդված 445 of the Tax Code lists what it repealed. Standing alone, one
    // of its lines reads exactly like a statement of current law.
    const body = '10) «Հողի հարկի մասին» Հայաստանի Հանրապետության 1994 թվականի փետրվարի 14-ի ՀՕ-101 օրենքը.';
    assert.deepEqual(sentencesOf(chunk(body)), []);
  });

  test('a limb of an enumeration is not a sentence', () => {
    const body = 'ա. 1-ից 120 (ներառյալ) ձիաուժ է, ապա յուրաքանչյուր ձիաուժի համար` 200 դրամ,';
    assert.deepEqual(sentencesOf(chunk(body)), []);
  });

  test('nothing that points at another article', () => {
    // «սույն հոդվածի 9.1-ին մասով» — the content is elsewhere, so quoted here
    // it says nothing and implies something.
    const body =
      '9. Գույքի օտարումից ստացվող եկամուտների մասով (բացառությամբ սույն հոդվածի 11-րդ մասի) եկամտային հարկը հաշվարկվում է 10 տոկոս դրույքաչափով:';
    assert.deepEqual(sentencesOf(chunk(body)), []);
  });

  test('nothing that points backwards at the sentence before it', () => {
    const body = 'Այդ ժամանակահատվածների համար աշխատողին վճարվում է նրա միջին օրական աշխատավարձի առնվազն 50 տոկոսի չափով:';
    assert.deepEqual(sentencesOf(chunk(body)), []);
  });

  test('a row of a rate table is never mistaken for prose', () => {
    const body = '| 2023 թվականի հունվարի 1-ից | 20 տոկոս | 10 տոկոս | այլ դրույքաչափեր և պայմաններ |';
    assert.deepEqual(sentencesOf(chunk(body)), []);
  });

  test('several rules in one part come out separately', () => {
    const body =
      '1. Ամենշաբաթյա անընդմեջ հանգիստը չպետք է պակաս լինի 35 ժամից: ' +
      'Աշխատանքային օրերի միջև ամենօրյա անընդմեջ հանգստի տևողությունը չի կարող պակաս լինել 11 ժամից:';
    assert.equal(sentencesOf(chunk(body)).length, 2);
  });
});
