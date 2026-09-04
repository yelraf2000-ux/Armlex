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
  findByEmail,
  findById,
  monthlyUsage,
  normaliseEmail,
  touchLastSeen,
  upsertGoogleUser,
  type User,
} from './users.js';
import { authorizeUrl, exchangeCode, googleEnabled, issueState, verifyState } from './google.js';

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
]);

/** A shape the UI can render, with no hash or provider id in it. */
function publicUser(user: User): { id: string; email: string; name: string | null; plan: string } {
  return { id: user.id, email: user.email, name: user.name, plan: user.plan };
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
  const body = req.body as { email?: unknown; password?: unknown; name?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? normaliseEmail(body.email) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null;

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

  const user = await createWithPassword(email, password, name);
  return reply
    .header('Set-Cookie', setCookie(user.id))
    .send({ user: publicUser(user), usage: await monthlyUsage(user) });
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

  const user = await upsertGoogleUser(identity.sub, identity.email, identity.name);
  await touchLastSeen(user.id);
  return reply.header('Set-Cookie', setCookie(user.id)).redirect('/');
}
