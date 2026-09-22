import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSource } from './publish.js';

test('the bare address gets the platform door', () => {
  assert.equal(withSource('Փորձեք անվճար՝ matyanai.am', 'tg'), 'Փորձեք անվճար՝ matyanai.am/tg');
  assert.equal(withSource('Փորձեք անվճար՝ matyanai.am։', 'ig'), 'Փորձեք անվճար՝ matyanai.am/ig։');
});

test('every mention, on every platform', () => {
  const body = 'matyanai.am\n\nՀարցրեք MatyanAI-ին՝ matyanai.am';
  assert.equal(withSource(body, 'fb'), 'matyanai.am/fb\n\nՀարցրեք MatyanAI-ին՝ matyanai.am/fb');
});

test('an address that already has a path or a subdomain is left alone', () => {
  assert.equal(withSource('https://matyanai.am/shared/abc', 'tg'), 'https://matyanai.am/shared/abc');
  assert.equal(withSource('matyanai.am/tg', 'fb'), 'matyanai.am/tg');
  assert.equal(withSource('mail@matyanai.am.', 'tg'), 'mail@matyanai.am.');
});
