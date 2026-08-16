import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations, stripHeader } from './extractRefs.js';

/** A chunk as the chunker actually emits it: metadata header, `---`, body. */
const withHeader = (body: string): string =>
  [
    '[Document] ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ',
    '[Type] code | [Status] in_force',
    '[Location] ԲԱԺԻՆ 8 › ԳԼՈՒԽ 3 › Հոդված 267',
    '[Source] https://www.arlis.am/hy/acts/109017/latest',
    '---',
    body,
  ].join('\n');

const numbers = (text: string): string[] =>
  extractCitations(text).map((c) => c.articleNumber).sort();

describe('stripHeader', () => {
  test('removes the metadata block up to and including ---', () => {
    assert.equal(stripHeader(withHeader('Բովանդակություն')), 'Բովանդակություն');
  });

  test('leaves text without a header untouched', () => {
    assert.equal(stripHeader('Ուղղակի տեքստ'), 'Ուղղակի տեքստ');
  });
});

describe('extractCitations', () => {
  test('the breadcrumb in the header is not a citation', () => {
    // "› ԳԼՈՒԽ 3 › Հոդված 267" names this chunk's own location. Reading it
    // would make every article cite itself and turn chapter numbers into
    // article numbers.
    assert.deepEqual(extractCitations(withHeader('Տեքստ առանց հղումների:')), []);
  });

  test('«սույն հոդվածի 3-րդ մասով» is a self-reference, not a cross-reference', () => {
    // The number here belongs to the PART, not to a cited article. Requiring
    // the number to precede «հոդված» is what keeps this out.
    assert.deepEqual(numbers(withHeader('բացառությամբ սույն հոդվածի 3-րդ մասով սահմանված դեպքերի:')), []);
  });

  test('single citation', () => {
    assert.deepEqual(numbers(withHeader('Օրենսգրքի 254-րդ հոդվածով սահմանված կարգով:')), ['254']);
  });

  test('list joined by և', () => {
    assert.deepEqual(
      numbers(withHeader('Օրենսգրքի 52-րդ և 53-րդ հոդվածներով նախատեսված:')),
      ['52', '53'],
    );
  });

  test('comma list with mixed ordinals and decimal article numbers', () => {
    // -ին after a final 1, -րդ otherwise; 402.1 and 402.2 are distinct articles.
    assert.deepEqual(
      numbers(withHeader('402.1-ին, 402.2-րդ և 422-րդ հոդվածներով սահմանված:')),
      ['402.1', '402.2', '422'],
    );
  });

  test('range expands to every article in it', () => {
    assert.deepEqual(
      numbers(withHeader('Օրենսգրքի 407-410-րդ հոդվածներով:')),
      ['407', '408', '409', '410'],
    );
  });

  test('an implausibly wide range is kept as endpoints, not expanded', () => {
    // Far likelier that the pattern joined two unrelated numbers than that one
    // provision cites 200 articles — expanding it would poison retrieval.
    assert.deepEqual(numbers(withHeader('Օրենսգրքի 100-400-րդ հոդվածներով:')), ['100', '400']);
  });

  test('a dotted range is not treated as a numeric interval', () => {
    // 402.1–402.9 are insertion markers, not a decimal span.
    assert.deepEqual(numbers(withHeader('402.1-402.9-րդ հոդվածներով:')), ['402.1', '402.9']);
  });

  test('«Օրենսգրքի» scopes the citation to the Tax Code', () => {
    const [c] = extractCitations(withHeader('Օրենսգրքի 254-րդ հոդվածով:'));
    assert.equal(c?.scope, 'tax-code');
  });

  test('a bare citation stays inside the current document', () => {
    const [c] = extractCitations(withHeader('սահմանված է 15-րդ հոդվածով:'));
    assert.equal(c?.scope, 'same-document');
  });

  test('inflected forms of հոդված are all matched', () => {
    for (const form of ['հոդվածով', 'հոդվածի', 'հոդվածներով', 'հոդվածում', 'հոդված']) {
      assert.deepEqual(numbers(withHeader(`Օրենսգրքի 254-րդ ${form} սահմանված:`)), ['254'], form);
    }
  });

  test('duplicates collapse but distinct scopes stay distinct', () => {
    const cs = extractCitations(
      withHeader('Օրենսգրքի 254-րդ հոդվածով, ինչպես նաև Օրենսգրքի 254-րդ հոդվածով:'),
    );
    assert.equal(cs.length, 1);
  });

  test('several citations in one provision are all found', () => {
    assert.deepEqual(
      numbers(
        withHeader(
          'Օրենսգրքի 254-րդ հոդվածով սահմանված շեմը, հաշվի առած Օրենսգրքի 106-րդ հոդվածի դրույթները, ' +
            'բացառությամբ սույն հոդվածի 3-րդ մասի, և Օրենսգրքի 267-րդ հոդվածով:',
        ),
      ),
      ['106', '254', '267'],
    );
  });

  test('a number not attached to հոդված is ignored', () => {
    assert.deepEqual(numbers(withHeader('24 միլիոն դրամը գերազանցող 3-րդ մասով:')), []);
  });
});
