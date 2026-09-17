/**
 * The logo in outgoing mail.
 *
 * Worth a test because every failure here is invisible from the app: a relative
 * src renders nothing in any mail client, a missing alt shows a broken box when
 * images are held back, and a missing width attribute lets Outlook draw the
 * stored 3x file at full size across the message.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mailLogo } from './brand.js';
import { render as verificationMail } from '../auth/verification.js';
import { render as resetMail } from '../auth/reset.js';

describe('mailLogo', () => {
  test('points at the logo on the same site as the mail link, absolutely', () => {
    const html = mailLogo('https://matyanai.am/verify/abc123');
    assert.match(html, /src="https:\/\/matyanai\.am\/logo-lockup\.png"/);
  });

  test('follows the link to another host, so staging mail shows staging', () => {
    assert.match(mailLogo('https://staging.example.am/reset/x'), /src="https:\/\/staging\.example\.am\/logo-lockup\.png"/);
  });

  test('names the product for clients that hold images back', () => {
    assert.match(mailLogo('https://matyanai.am/'), /alt="MatyanAI"/);
  });

  test('carries size attributes, which Outlook reads instead of CSS', () => {
    const html = mailLogo('https://matyanai.am/');
    assert.match(html, /width="164"/);
    assert.match(html, /height="36"/);
  });

  test('a link that is not a URL gives no image rather than a broken one', () => {
    assert.equal(mailLogo('not a url'), '');
  });
});

describe('the logo is in the mails', () => {
  test('verification mail opens with it', () => {
    const { html } = verificationMail('https://matyanai.am/verify/token');
    assert.ok(html.indexOf('logo-lockup.png') < html.indexOf('<h1'), 'above the heading');
  });

  test('reset mail opens with it', () => {
    const { html } = resetMail('https://matyanai.am/reset/token');
    assert.ok(html.indexOf('logo-lockup.png') < html.indexOf('<h1'), 'above the heading');
  });
});
