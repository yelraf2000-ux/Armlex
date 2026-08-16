import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, parseInline } from './markdown.js';

describe('parseInline', () => {
  test('splits bold runs from plain text', () => {
    assert.deepEqual(parseInline('до **20 числа** включительно'), [
      { kind: 'text', text: 'до ' },
      { kind: 'bold', text: '20 числа' },
      { kind: 'text', text: ' включительно' },
    ]);
  });

  test('an unclosed ** stays literal', () => {
    // A model emitting stray asterisks must not silently swallow the rest of
    // the sentence into emphasis.
    assert.deepEqual(parseInline('ставка **20'), [{ kind: 'text', text: 'ставка **20' }]);
  });

  test('empty emphasis is left alone', () => {
    assert.deepEqual(parseInline('a****b'), [{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }]);
  });

  test('Armenian text inside emphasis survives intact', () => {
    const spans = parseInline('**շրջանառության հարկ** վճարողները');
    assert.deepEqual(spans[0], { kind: 'bold', text: 'շրջանառության հարկ' });
  });
});

describe('parseBlocks', () => {
  test('consecutive lines form one paragraph', () => {
    const b = parseBlocks('первая строка\nвторая строка');
    assert.equal(b.length, 1);
    assert.equal(b[0]?.kind, 'paragraph');
  });

  test('a blank line separates paragraphs', () => {
    assert.equal(parseBlocks('раз\n\nдва').length, 2);
  });

  test('bullets merge into a single list', () => {
    const b = parseBlocks('- первый\n- второй\n- третий');
    assert.equal(b.length, 1);
    assert.equal(b[0]?.kind, 'list');
    assert.equal(b[0]?.kind === 'list' && b[0].items.length, 3);
    assert.equal(b[0]?.kind === 'list' && b[0].ordered, false);
  });

  test('numbered and bulleted runs stay separate lists', () => {
    // A numbered list usually enumerates legal conditions; merging it into a
    // bulleted one loses that distinction.
    const b = parseBlocks('1. первое\n2. второе\n- маркер');
    assert.equal(b.length, 2);
    assert.equal(b[0]?.kind === 'list' && b[0].ordered, true);
    assert.equal(b[1]?.kind === 'list' && b[1].ordered, false);
  });

  test('a paragraph after a list ends the list', () => {
    const b = parseBlocks('- пункт\nобычный текст');
    assert.equal(b.length, 2);
    assert.equal(b[0]?.kind, 'list');
    assert.equal(b[1]?.kind, 'paragraph');
  });

  test('bold inside a list item is parsed', () => {
    const b = parseBlocks('- ставка **20%** применяется');
    const item = b[0]?.kind === 'list' ? b[0].items[0] : undefined;
    assert.ok(item?.some((s) => s.kind === 'bold' && s.text === '20%'));
  });

  test('an Armenian legal quote in « » is untouched', () => {
    // Quotes are verbatim law; markdown must never reformat their contents.
    const quote = '«Շրջանառության հարկ վճարողները ներկայացնում են հաշվարկներ»';
    const b = parseBlocks(quote);
    assert.equal(b[0]?.kind === 'paragraph' && b[0].spans[0]?.text, quote);
  });

  test('empty input yields no blocks', () => {
    assert.deepEqual(parseBlocks(''), []);
  });

  test('a numbered legal reference mid-sentence is not a list', () => {
    // "1." only starts a list at the beginning of a line.
    const b = parseBlocks('согласно статье 254 п. 1. это так');
    assert.equal(b[0]?.kind, 'paragraph');
  });
});
