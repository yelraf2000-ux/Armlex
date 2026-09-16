/**
 * The preview shown for a provision the answer named but did not quote.
 *
 * Worth pinning down: it is the one piece of statute the panel shows that is
 * NOT a verified quote, so it has to be visibly a truncation and must never
 * swallow the table plumbing that many articles here open onto.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { opening } from './chunkText.js';

describe('opening', () => {
  test('a short provision is shown whole, with no ellipsis', () => {
    const body = '1. Շրջանառության հարկ վճարողներ են համարվում ռեզիդենտ կազմակերպությունները։';
    assert.equal(opening(body), body);
  });

  test('stops at the first blank line, so a rate table is never previewed', () => {
    const body =
      '1. Եթե սույն հոդվածով այլ բան սահմանված չէ, եկամտային հարկը հաշվարկվում է հետևյալ դրույքաչափերով.\n\n' +
      '| Ժամանակահատված | Դրույքաչափը |\n| --- | --- |\n| 2020 | 23 տոկոս |';
    const out = opening(body);
    assert.ok(!out.includes('|'), 'no table plumbing');
    assert.ok(out.startsWith('1. Եթե սույն հոդվածով'));
  });

  test('a long paragraph is cut on a word and marked as cut', () => {
    const body = 'ա '.repeat(300);
    const out = opening(body, 100);
    assert.ok(out.length <= 101, `cut to length, got ${out.length}`);
    assert.ok(out.endsWith('…'), 'says it was cut');
  });

  test('runs of whitespace collapse, so the preview is one line', () => {
    assert.equal(opening('1.   Հարկ    վճարողները\n   են։'), '1. Հարկ վճարողները են։');
  });

  test('a single unbroken run still gets cut rather than overflowing', () => {
    // No spaces to break on: better a hard cut than a line that runs off.
    const out = opening('ա'.repeat(400), 100);
    assert.equal(out.length, 101);
    assert.ok(out.endsWith('…'));
  });

  test('a table-only article gets no preview rather than a row of pipes', () => {
    // Հավելված 3, աղյուսակ 5 and its kin are a heading and a grid, nothing else.
    const body = '| Եկամտի տեսակ | Դրույքաչափ [3.2] |\n| --- | --- |\n| Տոկոսներ | 10 տոկոս |';
    assert.equal(opening(body), '');
  });

  test('an amendment annotation is skipped for the rule underneath it', () => {
    // Հոդված 147 opens on one of these, and it was being shown as the article.
    const body =
      '(վերնագիրը փոփ. 24.10.25 ՀՕ-324-Ն)\n\n' +
      '1. Ֆիզիկական անձի համախառն եկամտից նվազեցվում են հետևյալ եկամուտները։';
    assert.equal(opening(body), '1. Ֆիզիկական անձի համախառն եկամտից նվազեցվում են հետևյալ եկամուտները։');
  });

  test('a parenthesis inside a sentence does not disqualify it', () => {
    // Only a WHOLLY bracketed paragraph is editorial; statute is full of
    // parentheticals — «Նվազեցվող (չհարկվող) եկամուտները» is the rule itself.
    const body = 'Նվազեցվող (չհարկվող) եկամուտները սահմանվում են սույն հոդվածով։';
    assert.equal(opening(body), body);
  });
});
