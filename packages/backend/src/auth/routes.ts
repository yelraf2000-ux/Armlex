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
  updateProfile,
  upsertGoogleUser,
  type User,
} from './users.js';
import { authorizeUrl, exchangeCode, googleEnabled, issueState, verifyState } from './google.js';
import { markConverted } from '../answer/preview.js';
import * as verification from './verification.js';
import { claimInvitation, parseInvites, recordInvites } from './invitations.js';
import {
  inviteToWorkspace,
  isAdmin,
  readUsage,
  readWorkspace,
  removeMember,
  renameWorkspace,
  revokeInvite,
  workspaceIdFor,
} from './workspace.js';

/**
 * Paths reachable without a session.
 *
 * Listed ONE BY ONE, not by `/api/auth/` prefix. The prefix was the earlier
 * rule and it silently exempted every route added under it afterwards:
 * `/api/auth/profile` and `PATCH /api/auth/me` both read `req.user!.id` on a
 * request the guard had waved through, so both threw 500 on every call. A
 * prefix that grants public access to paths that do not exist yet fails in the
 * unsafe direction; an explicit list fails in the safe one.
 *
 * `GET /api/auth/me` is here because it is how the UI asks whether anyone is
 * signed in, before it can know. A gated answer to "am I signed in?" is a loop.
 * It reads the cookie itself and returns `{ user: null }` when there is none.
 *
 * This list is matched against the PATH ALONE, so a path that appears here is
 * public for every method. That is why changing the account lives at
 * `PATCH /api/account` rather than `PATCH /api/auth/me` — sharing the path
 * would have shared the exemption.
 *
 * Sign-out stays public so a stale or unrecognised cookie can always be
 * cleared; a sign-out that requires being signed in is a trap.
 *
 * `/api/shared/` stays a prefix — the token in the URL is the capability, and
 * that is what sharing a conversation means.
 */
const PUBLIC_PREFIXES = [
  '/api/shared/',
  // The token in the path IS the credential, exactly as with a shared link —
  // requiring a session to spend a verification link would demand the very
  // thing the link exists to grant.
  '/api/auth/verify/',
];
const PUBLIC_PATHS = new Set([
  '/api/auth',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/google',
  '/api/auth/google/callback',
  '/api/auth/resend-verification',
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
  // An account that joined a colleague's firm already has a workspace; one that
  // did not becomes the admin of its own. AFTER the claim, so an invited user
  // does not first own a workspace and then abandon it.
  await workspaceIdFor(fresh);

  /*
   * With the gate on, registration ends WITHOUT a cookie. Everything above
   * still ran — the account, the invitation payout, the workspace — because
   * the account is real, merely unproven; only the session is withheld.
   *
   * If the send fails we say so rather than pretending. An account that exists
   * behind a link that never arrived is the one state the user cannot get
   * themselves out of, and `verificationSent: false` is what lets the UI offer
   * the resend instead of a spinner.
   */
  if (verification.isRequired()) {
    const sent = await verification.issueFor(fresh, (req.body as { lang?: unknown })?.lang);
    if (!sent.sent) req.log.error({ err: sent.error, email }, 'verification mail failed');
    return reply.send({
      needsVerification: true,
      verificationSent: sent.sent,
      email: fresh.email,
      invitesRecorded: invites.length,
      bonusQuestions: bonus,
    });
  }

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

  /*
   * Checked AFTER the password, never before. Refusing an unverified address
   * on sight would answer "does this account exist" to anyone who asked, which
   * is the leak the shared `bad_credentials` message above exists to close.
   *
   * The address rides back in the response so the UI can offer a resend
   * without asking the person to type it a second time — they have already
   * proved they hold the password for it.
   */
  if (!(await verification.isVerified(user.id))) {
    return reply.code(403).send({ error: 'email_unverified', email: user.email });
  }

  await touchLastSeen(user.id);
  return reply
    .header('Set-Cookie', setCookie(user.id))
    .send({ user: publicUser(user), usage: await monthlyUsage(user) });
}

/**
 * Spend a verification link and sign the account in.
 *
 * Signing in here rather than returning them to the login form is the point:
 * the click already proves both the password (they set it minutes ago) and the
 * address. Sending them back to type it again is a step that proves nothing.
 */
export async function verifyEmail(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = (req.params as { token?: string } | undefined)?.token ?? '';
  const result = await verification.consume(token);

  if (!result.ok) return reply.code(400).send({ error: result.reason });

  const user = await findById(result.userId);
  if (!user) return reply.code(400).send({ error: 'invalid' });

  await touchLastSeen(user.id);
  return reply
    .header('Set-Cookie', setCookie(user.id))
    .send({ user: publicUser(user), usage: await monthlyUsage(user) });
}

/**
 * Send another link.
 *
 * Answers the same way whether or not the address exists. This route needs no
 * password, so a distinguishing response would turn it into the address oracle
 * that `login` is careful not to be.
 */
export async function resendVerification(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = req.body as { email?: unknown; lang?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? normaliseEmail(body.email) : '';

  await slow();

  const user = await findByEmail(email);
  if (user && !(await verification.isVerified(user.id))) {
    const sent = await verification.issueFor(user, body?.lang);
    if (!sent.sent) req.log.error({ err: sent.error, email }, 'verification resend failed');
  }
  return reply.send({ ok: true });
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

/**
 * Change the name on the account, or the workspace it belongs to.
 *
 * Separate from `saveProfile` above: that one fills blanks after a Google
 * redirect and must not overwrite, this one exists precisely to overwrite.
 */
export async function updateMe(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as
    | { name?: unknown; companyName?: unknown; companySize?: unknown }
    | undefined;

  const fields: { name?: string; companyName?: string; companySize?: unknown } = {};
  if (typeof body?.name === 'string' && body.name.trim()) fields.name = body.name.trim().slice(0, 120);
  if (typeof body?.companyName === 'string' && body.companyName.trim()) {
    fields.companyName = body.companyName.trim().slice(0, 120);
  }
  if (body?.companySize !== undefined) fields.companySize = body.companySize;

  const updated = await updateProfile(req.user!.id, fields);
  if (!updated) return reply.code(404).send({ error: 'not_found' });
  return reply.send({ user: publicUser(updated), usage: await monthlyUsage(updated) });
}

/**
 * The workspace page.
 *
 * Two reads and four writes, and every write re-checks admin against the
 * database rather than trusting the `role` the UI was handed. The UI hides
 * controls a member may not use; hiding is presentation, and presentation is
 * not authorisation.
 */
export async function getWorkspace(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  return reply.send(await readWorkspace(req.user!));
}

export async function getWorkspaceUsage(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  return reply.send(await readUsage(req.user!));
}

/** Guard shared by every mutation below. */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const workspaceId = await workspaceIdFor(req.user!);
  if (!(await isAdmin(req.user!.id, workspaceId))) {
    await reply.code(403).send({ error: 'not_admin' });
    return null;
  }
  return workspaceId;
}

export async function postWorkspaceInvite(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!(await requireAdmin(req, reply))) return;

  const body = req.body as { email?: unknown; name?: unknown } | undefined;
  const result = await inviteToWorkspace(req.user!, {
    email: body?.email,
    name: body?.name,
  });
  if (!result.ok) return reply.code(400).send({ error: result.reason });
  return reply.send(await readWorkspace(req.user!));
}

export async function deleteWorkspaceInvite(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const workspaceId = await requireAdmin(req, reply);
  if (!workspaceId) return;

  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
    return reply.code(400).send({ error: 'invalid_id' });
  }
  if (!(await revokeInvite(workspaceId, req.params.id))) {
    return reply.code(404).send({ error: 'not_found' });
  }
  return reply.send(await readWorkspace(req.user!));
}

export async function deleteWorkspaceMember(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const workspaceId = await requireAdmin(req, reply);
  if (!workspaceId) return;

  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
    return reply.code(400).send({ error: 'invalid_id' });
  }
  // Also the answer when the target IS the admin: removing the owner would
  // leave a workspace nobody can administer, and nothing here can appoint a
  // replacement yet.
  if (!(await removeMember(workspaceId, req.params.id))) {
    return reply.code(404).send({ error: 'not_found' });
  }
  return reply.send(await readWorkspace(req.user!));
}

export async function patchWorkspace(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const workspaceId = await requireAdmin(req, reply);
  if (!workspaceId) return;

  const name = (req.body as { name?: unknown })?.name;
  if (typeof name !== 'string') return reply.code(400).send({ error: 'invalid_name' });
  await renameWorkspace(workspaceId, name);
  return reply.send(await readWorkspace(req.user!));
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
  await workspaceIdFor((await findById(user.id)) ?? user);
  await touchLastSeen(user.id);
  return reply.header('Set-Cookie', setCookie(user.id)).redirect('/');
}
