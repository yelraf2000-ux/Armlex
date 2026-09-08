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
 * There is no invitation token, and deliberately so: `claimInvitation` matches
 * on the ADDRESS at registration time. That means the mail must say, plainly,
 * to register with this same address — someone who signs up with a personal
 * account instead gets in fine and silently earns nobody anything.
 *
 * Sending never throws. An invitation that is recorded but unsent is a
 * recoverable annoyance; a 500 that loses the invitation is not.
 */
import * as mailer from './mailer.js';

export type InviteKind = 'referral' | 'workspace';

type Lang = 'hy' | 'ru' | 'en';

function normaliseLang(raw: unknown): Lang {
  return raw === 'ru' || raw === 'en' ? raw : 'hy';
}

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

const COPY: Record<Lang, Copy> = {
  hy: {
    subject: (who) => `${who}-ը հրավիրում է Ձեզ MatyanAI`,
    heading: 'Ձեզ հրավիրել են MatyanAI',
    referral: (who) => `${who}-ը խորհուրդ է տալիս MatyanAI-ն։`,
    workspace: (who) => `${who}-ը Ձեզ ավելացրել է իր թիմին MatyanAI-ում։`,
    what: 'MatyanAI-ն պատասխանում է ՀՀ հարկային և աշխատանքային օրենսդրության հարցերին՝ հենվելով օրենքի իրական տեքստի վրա, հոդվածների հղումներով։',
    button: 'Բացել MatyanAI-ն',
    useThis: 'Կարևոր․ գրանցվեք հենց այս էլ. հասցեով, որպեսզի հրավերը գործի։',
    free: 'Անվճար փաթեթը ներառում է ամսական 5 հարց։',
    ignore: 'Եթե սա Ձեզ չի վերաբերում, պարզապես անտեսեք այս նամակը։',
  },
  ru: {
    subject: (who) => `${who} приглашает вас в MatyanAI`,
    heading: 'Вас пригласили в MatyanAI',
    referral: (who) => `${who} рекомендует вам MatyanAI.`,
    workspace: (who) => `${who} добавил вас в свою команду в MatyanAI.`,
    what: 'MatyanAI отвечает на вопросы по налоговому и трудовому законодательству РА, опираясь на реальный текст закона, со ссылками на статьи.',
    button: 'Открыть MatyanAI',
    useThis: 'Важно: зарегистрируйтесь именно на этот адрес, иначе приглашение не сработает.',
    free: 'Бесплатный тариф включает 5 вопросов в месяц.',
    ignore: 'Если это не к вам, просто проигнорируйте письмо.',
  },
  en: {
    subject: (who) => `${who} invited you to MatyanAI`,
    heading: 'You have been invited to MatyanAI',
    referral: (who) => `${who} recommends MatyanAI.`,
    workspace: (who) => `${who} added you to their team on MatyanAI.`,
    what: 'MatyanAI answers questions on Armenian tax and labour law, grounded in the actual text of the law, with links to the articles.',
    button: 'Open MatyanAI',
    useThis: 'Important: register with this exact address, or the invitation will not apply.',
    free: 'The free plan includes 5 questions a month.',
    ignore: 'If this is not for you, simply ignore this message.',
  },
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
  lang?: unknown;
}): Promise<{ sent: boolean; error?: string }> {
  if (!mailer.isEnabled()) return { sent: false, error: 'mail_disabled' };

  const c = COPY[normaliseLang(opts.lang)];
  const who = opts.inviter.trim() || 'MatyanAI';
  const lead = opts.kind === 'workspace' ? c.workspace(who) : c.referral(who);
  const link = origin();

  const html = [
    '<div style="margin:0;padding:32px 16px;background:#EDE8DC;font-family:Georgia,serif;color:#33191E">',
    '<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:10px;padding:32px">',
    `<h1 style="margin:0 0 16px;font-size:22px;font-weight:normal">${escapeHtml(c.heading)}</h1>`,
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#4A3524">${escapeHtml(lead)}</p>`,
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#4A3524">${escapeHtml(c.what)}</p>`,
    `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#A8142B;color:#EDE8DC;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px">${escapeHtml(c.button)}</a></p>`,
    `<p style="margin:0 0 4px;font-size:13px;color:#4A3524"><strong>${escapeHtml(c.useThis)}</strong></p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#8B8474">${escapeHtml(c.free)}</p>`,
    `<p style="margin:0;font-size:13px;color:#8B8474">${escapeHtml(c.ignore)}</p>`,
    '</div></div>',
  ].join('');

  const text = `${c.heading}\n\n${lead}\n${c.what}\n\n${link}\n\n${c.useThis}\n${c.free}\n${c.ignore}`;

  const res = await mailer.send({ to: opts.to, subject: c.subject(who), html, text });
  return res.ok ? { sent: true } : { sent: false, error: res.error ?? 'send_failed' };
}
