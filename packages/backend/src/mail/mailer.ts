/**
 * Transactional email.
 *
 * Environment:
 *   RESEND_API_KEY  enables sending. Absent, nothing is sent.
 *   EMAIL_FROM      e.g. "MatyanAI <noreply@matyanai.am>". Absent, nothing is
 *                   sent — Resend rejects an unverified sender anyway, and
 *                   failing here names the reason instead of surfacing a 403
 *                   from an API the caller did not know it was talking to.
 *
 * `isEnabled()` follows the shape google.ts and lemonsqueezy.ts already use:
 * a feature whose credentials are absent reports itself off, and the caller
 * degrades rather than throwing. That matters more here than for those two.
 * Verification gates ACCOUNT CREATION — if this module threw, or queued mail
 * nobody could send, an unconfigured deployment would accept registrations and
 * then strand every one of them behind a link that never arrives. Instead
 * `auth/verification.ts` skips the gate entirely when sending is off.
 */
const ENDPOINT = 'https://api.resend.com/emails';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export function isEnabled(): boolean {
  return Boolean(process.env['RESEND_API_KEY'] && process.env['EMAIL_FROM']);
}

/**
 * Send, or report why not. Never throws: a provider outage must not turn a
 * successful registration into a 500 for a user whose account already exists.
 */
export async function send(mail: Mail): Promise<{ ok: boolean; error?: string }> {
  if (!isEnabled()) return { ok: false, error: 'mail_disabled' };

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env['RESEND_API_KEY']}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env['EMAIL_FROM'],
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      // Body, not just status: Resend's 403 for an unverified sending domain
      // and its 422 for a malformed address are the two failures worth telling
      // apart, and only the body distinguishes them.
      const body = await res.text().catch(() => '');
      return { ok: false, error: `${res.status} ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
