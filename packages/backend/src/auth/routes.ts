/**
 * Authentication endpoints and the request guard.
 *
 * Replaces the single shared password wholesale, as `auth.ts` said it should be
 * replaced when real users arrived. Everything under `/api/` requires a signed
 * session cookie except the handful of paths listed below.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { clearCookie, readCookie, setCookie, verify } from './cookie.js';
import { MIN_PASSWORD, verifyPassword } from './password.js';
import {
  createWithPassword,
  fillProfile,
  findByEmail,
  findById,
  monthlyUsage,
  normaliseEmail,
  touchLastSeen,
  upsertGoogleUser,
  type User,
} from './users.js';
import { authorizeUrl, exchangeCode, googleEnabled, issueState, verifyState } from './google.js';
import { markConverted } from '../answer/preview.js';
import { claimInvitation, parseInvites, recordInvites } from './invitations.js';

/**
 * Paths reachable without a session.
 *
 * `/api/auth/me` must be here for the same reason `/api/auth` was before it:
 * it is how the UI asks whether anyone is signed in, before it can know. A
 * gated answer to "am I signed in?" is a loop.
 *
 * `/api/shared/` is public by design — that is what sharing a conversation
 * means. The token in the URL is the capability.
 */
const PUBLIC_PREFIXES = ['/api/auth/', '/api/shared/'];
const PUBLIC_PATHS = new Set([
  '/api/auth',
  '/api/health',
  '/api/version',
  '/health',
  // The point of the preview is that a visitor with no account can use it. It
  // is not unprotected — it carries a per-address rate limit and the cheap
  // model — but the protection is its own, not the session's.
  '/api/preview',
  // The payment provider has no session. This one is verified by HMAC signature
  // instead, which is a stronger check than a cookie: see billing/routes.ts.
  '/api/billing/webhook',
]);

/** A shape the UI can render, with no hash or provider id in it. */
function publicUser(user: User): {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  companyName: string | null;
  companySize: string | null;
} {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    companyName: user.company_name,
    companySize: user.company_size,
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = req.url.split('?')[0] ?? '';
  if (!path.startsWith('/api/')) return;
  if (PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return;

  const userId = verify(readCookie(req.headers.cookie));
  if (!userId) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }

  const user = await findById(userId);
  if (!user) {
    // Signed cookie for an account that no longer exists — clear it rather than
    // leaving the browser to present it on every request forever.
    await reply.header('Set-Cookie', clearCookie()).code(401).send({ error: 'unauthorized' });
    return;
  }
  req.user = user;
}

/** Blunts online guessing without a rate limiter, on both routes that take a password. */
const slow = (): Promise<void> => new Promise((r) => setTimeout(r, 400));

export async function register(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as
    | { email?: unknown; password?: unknown; name?: unknown; companyName?: unknown; companySize?: unknown }
    | undefined;
  const email = typeof body?.email === 'string' ? normaliseEmail(body.email) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const companyName =
    typeof body?.companyName === 'string' && body.companyName.trim()
      ? body.companyName.trim()
      : null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply.code(400).send({ error: 'invalid_email' });
  }
  if (password.length < MIN_PASSWORD) {
    return reply.code(400).send({ error: 'weak_password', minimum: MIN_PASSWORD });
  }

  if (await findByEmail(email)) {
    // Deliberately explicit. Hiding it would protect an address from being
    // probed here while the sign-in form leaks the same fact, and would leave a
    // real person unable to tell why registration silently did nothing.
    return reply.code(409).send({ error: 'email_taken' });
  }

  const user = await createWithPassword(email, password, name, {
    companyName,
    companySize: body?.companySize,
  });

  // If they arrived from a preview, record which one. Conversion is the number
  // that decides whether the teaser is worth what it costs to run.
  const previewId = (req.body as { previewId?: unknown })?.previewId;
  if (typeof previewId === 'string') await markConverted(previewId, user.id);

  // Somebody may have invited THIS address; if so, pay them for it.
  await claimInvitation(user.id, email);

  // And this account may itself be inviting others.
  const invites = parseInvites((req.body as { invites?: unknown })?.invites);
  const bonus = await recordInvites(user.id, invites);

  // Re-read: both of the above may have changed the allowance, and the UI
  // should be told the number that is true rather than the one it expected.
  const fresh = (await findById(user.id)) ?? user;
  return reply
    .header('Set-Cookie', setCookie(fresh.id))
    .send({
      user: publicUser(fresh),
      usage: await monthlyUsage(fresh),
      invitesRecorded: invites.length,
      bonusQuestions: bonus,
    });
}

export async function login(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as { email?: unknown; password?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? normaliseEmail(body.email) : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  await slow();

  const user = await findByEmail(email);
  // One message for both "no such account" and "wrong password": the pair of
  // them is what turns a leaked address list into a confirmed-user list.
  if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) {
    return reply.code(401).send({ error: 'bad_credentials' });
  }

  await touchLastSeen(user.id);
  return reply
    .header('Set-Cookie', setCookie(user.id))
    .send({ user: publicUser(user), usage: await monthlyUsage(user) });
}

export async function logout(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
  return reply.header('Set-Cookie', clearCookie()).send({ ok: true });
}

/**
 * Attach a company profile to an account that has none.
 *
 * Exists because Google sign-up leaves the page. The answers given before that
 * redirect cannot travel with the registration call — the browser holds them
 * and posts them here once the account is back. Also the repair path for the
 * accounts created before this form existed.
 *
 * Fills empty fields only (`fillProfile`), so a stale value the browser was
 * still holding can never overwrite something the person has since corrected.
 */
export async function saveProfile(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as { companyName?: unknown; companySize?: unknown } | undefined;
  const companyName =
    typeof body?.companyName === 'string' && body.companyName.trim()
      ? body.companyName.trim()
      : null;

  const updated = await fillProfile(req.user!.id, {
    companyName,
    companySize: body?.companySize,
  });
  if (!updated) return reply.code(404).send({ error: 'not_found' });
  return reply.send({ user: publicUser(updated) });
}

/** Who am I, and how much of this month's allowance is left? */
export async function me(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = verify(readCookie(req.headers.cookie));
  const user = userId ? await findById(userId) : null;
  if (!user) return reply.send({ user: null, google: googleEnabled() });
  return reply.send({
    user: publicUser(user),
    usage: await monthlyUsage(user),
    google: googleEnabled(),
  });
}

export async function googleStart(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!googleEnabled()) return reply.code(404).send({ error: 'google_not_configured' });
  return reply.redirect(authorizeUrl(issueState()));
}

export async function googleCallback(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!googleEnabled()) return reply.code(404).send({ error: 'google_not_configured' });

  const q = req.query as { code?: string; state?: string; error?: string };
  // The user pressed cancel on Google's screen. Not an error worth a stack
  // trace — send them back to the sign-in page.
  if (q.error) return reply.redirect('/?auth=cancelled');
  if (!q.code || !verifyState(q.state)) return reply.redirect('/?auth=failed');

  const identity = await exchangeCode(q.code);
  if (!identity) return reply.redirect('/?auth=failed');
  // An unverified Google address could belong to someone else; accepting it
  // would let a stranger attach to an existing password account by email.
  if (!identity.emailVerified) return reply.redirect('/?auth=unverified');

  const before = await findByEmail(identity.email);
  const user = await upsertGoogleUser(identity.sub, identity.email, identity.name);
  // Only a genuinely NEW account settles an invitation — otherwise every later
  // Google sign-in would pay the inviter again.
  if (!before) await claimInvitation(user.id, identity.email);
  await touchLastSeen(user.id);
  return reply.header('Set-Cookie', setCookie(user.id)).redirect('/');
}
