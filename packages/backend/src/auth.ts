/**
 * Single shared-password gate.
 *
 * The spec allows this ("simple email login or even a shared password gate"),
 * and the reason it cannot be skipped is money rather than privacy: every
 * answer costs roughly $0.09 of Anthropic, Gemini and Voyage credit, billed to
 * whoever owns the keys. An unauthenticated public URL is a form anyone can
 * spend from — a crawler alone would drain a balance overnight.
 *
 * Deliberately not a user system. There is one password, set by APP_PASSWORD,
 * and no accounts, registration, or password reset to get wrong. When this
 * grows real users, replace it wholesale rather than extending it.
 *
 * The cookie carries an HMAC of the password under SESSION_SECRET, not the
 * password itself, so a stolen cookie does not reveal what to type — and no
 * session store is needed, which means restarts do not log anyone out.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const COOKIE = 'armlex_auth';

/**
 * Paths reachable without a session.
 *
 * `/api/auth` must be here: it is how the UI asks whether a password is needed
 * at all, before it can possibly have a cookie. Gating it created a loop where
 * the answer to "do I need to log in?" was itself 401 — and since the error
 * body has no `authRequired` field, the UI read `undefined` as "no" and showed
 * the workbench with every request failing, instead of the login screen.
 */
const PUBLIC_PATHS = new Set(['/api/login', '/api/auth', '/api/health', '/health']);

function token(): string {
  const password = process.env['APP_PASSWORD'] ?? '';
  const secret = process.env['SESSION_SECRET'] ?? '';
  return createHmac('sha256', secret).update(password).digest('hex');
}

/**
 * Is the gate switched on?
 *
 * Off when APP_PASSWORD is unset, which keeps local development frictionless.
 * `server.ts` refuses to start unguarded in production, so "unset" can never
 * silently mean "open to the internet".
 */
export function authEnabled(): boolean {
  return Boolean(process.env['APP_PASSWORD']);
}

/** Constant-time compare; a length mismatch alone must not leak via timing. */
function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!authEnabled()) return;
  const path = req.url.split('?')[0] ?? '';
  if (!path.startsWith('/api/') || PUBLIC_PATHS.has(path)) return;

  const supplied = cookieValue(req.headers.cookie, COOKIE);
  if (!supplied || !sameToken(supplied, token())) {
    await reply.code(401).send({ error: 'unauthorized' });
  }
}

export async function login(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as { password?: unknown } | undefined;
  const supplied = typeof body?.password === 'string' ? body.password : '';
  const expected = process.env['APP_PASSWORD'] ?? '';

  if (!authEnabled()) return reply.send({ ok: true, authRequired: false });

  // A small fixed delay blunts online guessing without needing a rate limiter.
  // There is exactly one password here, so an unthrottled endpoint is the whole
  // attack surface.
  await new Promise((r) => setTimeout(r, 400));

  if (!sameToken(supplied, expected)) {
    return reply.code(401).send({ error: 'wrong password' });
  }

  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    // httpOnly keeps it away from any script on the page; SameSite=Lax stops it
    // riding along on cross-site requests. 30 days: this is a tool someone
    // returns to, and re-typing a shared password weekly teaches nothing.
    `${COOKIE}=${token()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${secure}`,
  );
  return reply.send({ ok: true });
}

/** Lets the UI decide whether to show the password screen before asking. */
export function authStatus(): { authRequired: boolean } {
  return { authRequired: authEnabled() };
}
