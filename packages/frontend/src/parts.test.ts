/**
 * The cut that decides how much of an article a reader sees.
 *
 * Worth pinning down hard: this is the only place the product withholds
 * statute. Cutting too much hides a condition the reader needed and the answer
 * still looks cited; cutting too little puts them back in front of thirty
 * thousand characters. Both failures are silent, so the boundaries are tested
 * rather than eyeballed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitParts, partsNamed, selectParts, runs, range } from './parts.js';

/** Shaped like the real article: a chapeau, a rate table, then a part. */
const ARTICLE_150 =
  '1. Եթե սույն հոդվածի 1.1-15-րդ մասերով այլ բան սահմանված չէ, ապա եկամտային հարկը հաշվարկվում է հետևյալ դրույքաչափերով.\n\n' +
  '| Ժամանակահատված | Դրույքաչափը |\n| --- | --- |\n| 2023 թվականի հունվարի 1-ից | 20 տոկոս |\n\n' +
  '1.1. Հարկային գործակալը Կառավարության սահմանած չափանիշներին համապատասխանող անձնակազմին վճարվող աշխատավարձից եկամտային հարկը հաշվարկում է 10 տոկոս դրույքաչափով:\n\n' +
  'Օրենսգրքի 121-րդ հոդվածի 2-րդ մասի 4-րդ կետով նախատեսված եզրակացության չեղարկման դեպքում կատարվում է վերահաշվարկ:\n\n' +
  '2. Ռոյալթիների գծով եկամտային հարկը հաշվարկվում է 10 տոկոս դրույքաչափով:';

describe('splitParts', () => {
  test('cuts an article at its numbered parts', () => {
    const parts = splitParts(ARTICLE_150);
    assert.deepEqual(parts.map((p) => p.label), ['1', '1.1', '2']);
  });

  test('a rate table stays with the part that introduces it', () => {
    // The failure this guards: a part shown without its table, which reads as
    // a rule with no rates — worse than showing the whole article.
    const [first] = splitParts(ARTICLE_150);
    assert.ok(first!.text.includes('| 2023 թվականի հունվարի 1-ից | 20 տոկոս |'));
  });

  test('a continuation paragraph stays with its part', () => {
    const parts = splitParts(ARTICLE_150);
    const p11 = parts.find((p) => p.label === '1.1')!;
    assert.ok(p11.text.includes('վերահաշվարկ'), 'the unnumbered follow-on belongs to 1.1');
  });

  test('an article with no numbered parts is left whole', () => {
    const body = 'Սույն հավելվածով սահմանվում են գործունեության տեսակները։';
    assert.deepEqual(splitParts(body), [{ label: null, text: body }]);
  });
});

describe('partsNamed', () => {
  test('reads the part out of a citation', () => {
    assert.deepEqual(partsNamed('(ՀՀ Հարկային օրենսգիրք, Հոդված 150, մաս 1.1)', 'Հոդված 150'), ['1.1']);
  });

  test('reads the declined form too', () => {
    assert.deepEqual(partsNamed('տես Հոդված 254-ի մաս 3-ը', 'Հոդված 254'), ['3']);
  });

  test('collects several parts of the same article', () => {
    const answer = 'Հոդված 267, մաս 1, կետ 1 կամ մաս 2';
    assert.deepEqual(partsNamed(answer, 'Հոդված 267'), ['1', '2']);
  });

  test('does not hand the next article’s part to this one', () => {
    // «Հոդված 130, մաս 2, Հոդված 170, մաս 4» — 4 belongs to 170, not to 130.
    const answer = 'Հոդված 130, մաս 2, Հոդված 170, մաս 4';
    assert.deepEqual(partsNamed(answer, 'Հոդված 130'), ['2']);
  });

  test('a point is not a part', () => {
    // «կետ 1» lives inside a part and says nothing about which one.
    assert.deepEqual(partsNamed('Հոդված 8, կետ 1', 'Հոդված 8'), []);
  });
});

describe('selectParts', () => {
  test('shows the part the answer named, and nothing else', () => {
    const parts = selectParts(ARTICLE_150, [], ['1.1']);
    assert.deepEqual(parts.filter((p) => p.shown).map((p) => p.label), ['1.1']);
  });

  test('shows the part a verified quote falls inside', () => {
    const quote = 'Ռոյալթիների գծով եկամտային հարկը հաշվարկվում է 10 տոկոս դրույքաչափով';
    const parts = selectParts(ARTICLE_150, [quote], []);
    assert.deepEqual(parts.filter((p) => p.shown).map((p) => p.label), ['2']);
  });

  test('shows every part the answer leans on, not just the first', () => {
    // The elephant case: asked how it walks AND how it lays, both parts show
    // and the part about digestion does not.
    const parts = selectParts(ARTICLE_150, [], ['1', '2']);
    assert.deepEqual(parts.filter((p) => p.shown).map((p) => p.label), ['1', '2']);
  });

  test('with no anchor at all, the whole article is kept', () => {
    // 7.6% of real answers offer neither a quote nor a part number. A part
    // picked without evidence would be a guess dressed as a citation.
    const parts = selectParts(ARTICLE_150, [], []);
    assert.ok(parts.every((p) => p.shown));
  });

  test('a part named but absent does not blank the article', () => {
    const parts = selectParts(ARTICLE_150, [], ['9']);
    assert.ok(parts.every((p) => p.shown), 'falls back rather than showing nothing');
  });
});

describe('runs', () => {
  test('one gap prints one notice, however many parts it swallows', () => {
    const parts = selectParts(ARTICLE_150, [], ['2']);
    const blocks = runs(parts);
    assert.deepEqual(blocks.map((b) => b.shown), [false, true]);
    assert.deepEqual(blocks[0]!.labels, ['1', '1.1']);
  });

  test('adjacent shown parts read as continuous text', () => {
    const blocks = runs(selectParts(ARTICLE_150, [], ['1', '1.1']));
    assert.equal(blocks.filter((b) => b.shown).length, 1);
    assert.ok(blocks[0]!.text.includes('10 տոկոս դրույքաչափով'));
  });
});

describe('range', () => {
  test('a short gap is listed', () => {
    assert.equal(range(['1', '1.1']), '1, 1.1');
  });

  test('a long gap is a range, so the notice stays one line', () => {
    assert.equal(range(['2', '3', '4', '5', '6', '7']), '2–7');
  });
});

describe('selectParts — anchors that do not locate', () => {
  test('a naming wins over a quote that also matches elsewhere', () => {
    // The live failure: «10 տոկոս դրույքաչափով» appears in four parts of
    // Հոդված 150, so honouring both anchors showed the IT relief next to bank
    // deposits and property disposal, all presented as relied upon.
    const quote = 'եկամտային հարկը հաշվարկվում է 10 տոկոս դրույքաչափով';
    const body =
      '1. Առաջին մասը։\n\n' +
      `1.1. ՏՏ ոլորտի համար ${quote}:\n\n` +
      `9. Գույքի օտարման մասով ${quote}:`;
    const parts = selectParts(body, [quote], ['1.1']);
    assert.deepEqual(parts.filter((p) => p.shown).map((p) => p.label), ['1.1']);
  });

  test('a quote in more than one part locates nothing and is ignored', () => {
    const quote = 'եկամտային հարկը հաշվարկվում է 10 տոկոս դրույքաչափով';
    const body = `1. Առաջինը ${quote}:\n\n2. Երկրորդը ${quote}:\n\n3. Երրորդը՝ այլ բան։`;
    const parts = selectParts(body, [quote], []);
    assert.ok(parts.every((p) => p.shown), 'falls back to the whole article');
  });

  test('a quote in exactly one part still selects it', () => {
    const quote = 'Ռոյալթիների գծով եկամտային հարկը հաշվարկվում է 10 տոկոս';
    const body = `1. Առաջինը։\n\n2. ${quote} դրույքաչափով:`;
    assert.deepEqual(
      selectParts(body, [quote], []).filter((p) => p.shown).map((p) => p.label),
      ['2'],
    );
  });
});
