/**
 * Google sign-in, authorization-code flow.
 *
 * No SDK: the flow is two HTTPS calls and Node has `fetch`. A dependency here
 * would carry its own release cadence and CVE surface for about forty lines of
 * work.
 *
 * Configured entirely by environment, and DORMANT until it is: if the client
 * id or secret is missing the button never appears and the routes return 404,
 * so the rest of the auth system ships and works without waiting on anyone to
 * create a Google Cloud project.
 *
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   PUBLIC_ORIGIN   e.g. https://matyanai.am  (redirect URI is derived)
 *
 * The redirect URI registered in Google Cloud must be exactly
 * `<PUBLIC_ORIGIN>/api/auth/google/callback`.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export function googleEnabled(): boolean {
  return Boolean(process.env['GOOGLE_CLIENT_ID'] && process.env['GOOGLE_CLIENT_SECRET']);
}

export function redirectUri(): string {
  const origin = (process.env['PUBLIC_ORIGIN'] ?? 'http://localhost:5173').replace(/\/+$/, '');
  return `${origin}/api/auth/google/callback`;
}

/**
 * Which door the user came through.
 *
 * `signin` may only sign in an account that already exists; `register` may
 * create one. Google's own screen cannot tell them apart, so the answer has to
 * survive the round trip — and it has to survive it UNFORGEABLY, which is why
 * it rides inside the signed state rather than as a second query parameter.
 * A plain `?intent=` would be editable by the person it is meant to constrain.
 */
export type AuthIntent = 'signin' | 'register';

function sign(payload: string): string {
  return createHmac('sha256', process.env['SESSION_SECRET'] ?? '').update(payload).digest('hex');
}

/**
 * CSRF protection for the redirect, without a server-side store.
 *
 * The `state` parameter is the intent plus a random nonce plus an HMAC over
 * both. Google hands it back untouched, and a value we did not sign cannot
 * have originated here — so a forged callback is rejected without needing to
 * remember anything between the two requests.
 */
export function issueState(intent: AuthIntent): string {
  const payload = `${intent}.${randomBytes(16).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
}

/** The intent this state was signed with, or null if it was not signed here. */
export function verifyState(state: string | undefined): AuthIntent | null {
  if (!state) return null;
  const [intent, nonce, mac] = state.split('.');
  if (!intent || !nonce || !mac) return null;
  if (intent !== 'signin' && intent !== 'register') return null;

  const a = Buffer.from(mac);
  const b = Buffer.from(sign(`${intent}.${nonce}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return intent;
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env['GOOGLE_CLIENT_ID'] ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Sign-in only: no refresh token, no offline access, nothing to store.
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

/**
 * Exchange the authorization code for an identity.
 *
 * The id_token's payload is read WITHOUT verifying its signature, which is safe
 * only because of where it came from: a direct, server-to-server TLS response
 * from Google's token endpoint to a request carrying our client secret. The
 * token never passed through the browser. Were this token supplied by a client,
 * the signature check against Google's JWKS would be mandatory.
 */
export async function exchangeCode(code: string): Promise<GoogleIdentity | null> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env['GOOGLE_CLIENT_ID'] ?? '',
      client_secret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    console.error(`[auth] google token exchange failed: HTTP ${res.status}`);
    return null;
  }

  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) return null;

  const payloadPart = body.id_token.split('.')[1];
  if (!payloadPart) return null;

  let claims: { sub?: string; email?: string; name?: string; email_verified?: boolean | string };
  try {
    claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims.sub || !claims.email) return null;

  return {
    sub: claims.sub,
    email: claims.email,
    name: claims.name ?? null,
    // Google sends this as a boolean or the string "true" depending on the flow.
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
  };
}
