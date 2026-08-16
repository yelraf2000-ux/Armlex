import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { answerLanguage } from './language.js';

describe('answerLanguage', () => {
  test('Russian question → ru', () => {
    assert.equal(answerLanguage('нужна ли касса в магазине'), 'ru');
  });

  test('Armenian question → hy', () => {
    assert.equal(answerLanguage('ես բուդկա եմ ուզում բացել'), 'hy');
  });

  test('transliterated Armenian → hy, not treated as a foreign language', () => {
    assert.equal(answerLanguage('es uzum em pokr xanut bacel'), 'hy');
  });

  test('mixed script resolves to the dominant one', () => {
    // A Russian question naming an Armenian term is still a Russian question.
    assert.equal(answerLanguage('какой порог для շրջանառության հարկ в этом году'), 'ru');
    // ...and an Armenian question naming a Russian word is still Armenian.
    assert.equal(answerLanguage('ինչ հարկեր պիտի վճարեմ խանութ բացելիս ИП'), 'hy');
  });

  test('empty input does not throw', () => {
    assert.equal(answerLanguage(''), 'hy');
  });
});
