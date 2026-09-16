/**
 * The invitation email.
 *
 * Sent for both kinds of invitation, which differ in what the recipient is
 * being offered:
 *
 *   referral   a colleague recommends the tool during their own signup. Both
 *              sides gain questions, but only once the invitee registers.
 *   workspace  an admin adds someone to their firm's shared workspace.
 *
 * The link carries an invitation token, so the page it opens already knows the
 * address and the name the inviter typed and asks only for a password. Without
 * one the invitee had to fill the whole signup form, retyping answers a
 * colleague had already given — and any deviation in the address meant the
 * invitation silently applied to nobody.
 *
 * Sending never throws. An invitation that is recorded but unsent is a
 * recoverable annoyance; a 500 that loses the invitation is not.
 */
import * as mailer from './mailer.js';

export type InviteKind = 'referral' | 'workspace';

function origin(): string {
  return (process.env['PUBLIC_ORIGIN'] ?? 'http://localhost:5173').replace(/\/+$/, '');
}

interface Copy {
  subject: (who: string) => string;
  heading: string;
  referral: (who: string) => string;
  workspace: (who: string) => string;
  what: string;
  button: string;
  useThis: string;
  free: string;
  ignore: string;
}

/** One language. The interface is Armenian only, so the post is too. */
const COPY: Copy = {
  subject: (who) => `${who}-ը հրավիրում է Ձեզ MatyanAI`,
  heading: 'Ձեզ հրավիրել են MatyanAI',
  referral: (who) => `${who}-ը խորհուրդ է տալիս MatyanAI-ն։`,
  workspace: (who) => `${who}-ը Ձեզ ավելացրել է իր թիմին MatyanAI-ում։`,
  what: 'MatyanAI-ն պատասխանում է ՀՀ հարկային և աշխատանքային օրենսդրության հարցերին՝ հենվելով օրենքի իրական տեքստի վրա, հոդվածների հղումներով։',
  button: 'Ընդունել հրավերը',
  useThis: 'Կմնա միայն գաղտնաբառ ընտրել — անունն ու հասցեն արդեն լրացված են։',
  free: 'Միանալով՝ թիմի ընդհանուր հարցերին կավելացնեք շաբաթական 5 հարց։',
  ignore: 'Եթե սա Ձեզ չի վերաբերում, պարզապես անտեսեք այս նամակը։',
};

/**
 * Escapes anything that reaches the HTML body from a user.
 *
 * The inviter's own name goes into this mail, and it is a free-text field they
 * typed. Without this, a name containing markup would be rendered as markup in
 * somebody else's inbox.
 */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendInvite(opts: {
  to: string;
  inviter: string;
  kind: InviteKind;
  /** Raw invitation token. Its presence is what makes the link an acceptance
   *  link rather than a bare trip to the homepage. */
  token?: string;
}): Promise<{ sent: boolean; error?: string }> {
  if (!mailer.isEnabled()) return { sent: false, error: 'mail_disabled' };

  const c = COPY;
  const who = opts.inviter.trim() || 'MatyanAI';
  const lead = opts.kind === 'workspace' ? c.workspace(who) : c.referral(who);
  // Falls back to the homepage for an invitation minted before tokens existed:
  // those emails are already sent, but a resend should still lead somewhere.
  const link = opts.token ? `${origin()}/invite/${opts.token}` : origin();

  const html = [
    '<div style="margin:0;padding:32px 16px;background:#F7F8FA;font-family:-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#111418">',
    '<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:8px;padding:32px">',
    `<h1 style="margin:0 0 16px;font-size:22px;font-weight:600">${escapeHtml(c.heading)}</h1>`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#444C57">${escapeHtml(lead)}</p>`,
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#444C57">${escapeHtml(c.what)}</p>`,
    `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#2250DC;color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px">${escapeHtml(c.button)}</a></p>`,
    `<p style="margin:0 0 4px;font-size:13px;color:#444C57"><strong>${escapeHtml(c.useThis)}</strong></p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#79818E">${escapeHtml(c.free)}</p>`,
    `<p style="margin:0;font-size:13px;color:#79818E">${escapeHtml(c.ignore)}</p>`,
    '</div></div>',
  ].join('');

  const text = `${c.heading}\n\n${lead}\n${c.what}\n\n${link}\n\n${c.useThis}\n${c.free}\n${c.ignore}`;

  const res = await mailer.send({ to: opts.to, subject: c.subject(who), html, text });
  return res.ok ? { sent: true } : { sent: false, error: res.error ?? 'send_failed' };
}
