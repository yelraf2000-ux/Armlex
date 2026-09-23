/**
 * Product analytics — PostHog, EU cloud.
 *
 * What goes out: page views, a dozen named events and a masked session
 * replay. What never goes out: the question, the answer, the article text.
 * Accountants type client facts into the box, so every event carries
 * metadata only — coverage, latency, counts — and the replay masks every
 * input and the text of the transcript, the sources column, the preview and
 * the register. The content stays in our own Postgres, which already holds it.
 *
 * Anonymous visitors get no cookie: persistence is memory until they sign
 * in, at which point the identity is theirs and persists. The price is that
 * a visitor who reloads before registering is a new visitor — accepted, for
 * not having to put a consent banner in front of a question box.
 *
 * The key is a public project token (it ships in every page's source
 * anyway). It comes from `.env.production`, so `npm run dev` sends nothing.
 */
import posthog from 'posthog-js';
import type { Account } from './Login.js';

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com';

/** Text that is content, not chrome. Replay renders it as blocks. */
const MASKED =
  '.turn-text, .norm-body, .norm-title, .entry-opening, .lp-answer, .lp-result-title, ' +
  '.session-q, .session-snippet, .stage-line, [data-ph-mask]';

/**
 * Single-use tokens live in the address for a moment — /verify, /invite,
 * /reset — and a shared conversation's link is its only secret. None of them
 * belongs in an analytics row.
 */
const TOKEN_PATH = /\/(verify|invite|reset|shared)\/[A-Za-z0-9_-]+/g;

function scrub(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(TOKEN_PATH, '/$1/…') : value;
}

const URL_KEYS = ['$current_url', '$pathname', '$initial_current_url', '$initial_pathname', '$prev_pageview_pathname'];

/**
 * Set when someone signs in, cleared when they sign out. It decides, before
 * PostHog starts, whether this browser remembers an identity: a signed-in
 * person's id is read back from storage on every load, so `identify` is a
 * no-op rather than a merge of yet another anonymous id — which, done on
 * every reload, would push their person past PostHog's distinct-id limit.
 * A visitor has no marker and gets memory persistence: nothing stored.
 */
const SIGNED_IN = 'matyan.analytics';
/** `localStorage.setItem('matyan.analytics.debug', '1')` prints every event to the console. */
const DEBUG = 'matyan.analytics.debug';

function flag(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function setFlag(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: the identity simply is not remembered across loads.
  }
}

let on = false;

/**
 * A build running on this machine, not the service.
 *
 * `.env.production` is read by `vite build` only, so `npm run dev` was already
 * silent — but a production build served from the backend on :3001 carries the
 * key and reported an afternoon of clicking-through as real traffic. At two
 * visitors a day that is not noise, it is most of the data. PostHog's "filter
 * out internal users" toggle would hide it after the fact; not sending it is
 * cheaper and cannot be left switched off.
 */
function localBuild(): boolean {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.local');
}

export function initAnalytics(): void {
  if (!KEY || on || localBuild()) return;
  posthog.init(KEY, {
    api_host: HOST,
    defaults: '2026-08-30',
    persistence: flag(SIGNED_IN) ? 'localStorage+cookie' : 'memory',
    debug: flag(DEBUG),
    person_profiles: 'identified_only',
    capture_pageview: 'history_change',
    // Named events only. Autocapture would report every click with the text
    // of what was clicked, and in this interface that text is often the law
    // or the question.
    autocapture: false,
    capture_dead_clicks: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: MASKED,
    },
    before_send: (event) => {
      if (!event) return event;
      for (const bag of [event.properties, event.$set, event.$set_once]) {
        if (!bag) continue;
        for (const k of URL_KEYS) if (k in bag) bag[k] = scrub(bag[k]);
      }
      return event;
    },
  });
  on = true;
  // In debug mode the client is reachable from the console, so what is about
  // to be sent can be inspected (`posthog.on('eventCaptured', …)`).
  if (flag(DEBUG)) (window as unknown as { posthog: typeof posthog }).posthog = posthog;
}

/** A named event. Properties are metadata — never text the user wrote or read. */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (on) posthog.capture(event, properties);
}

/**
 * Who this is, once the server says so.
 *
 * Also the moment persistence moves from memory to the browser: an account
 * holder is a user of the service, and remembering them across visits is the
 * ordinary working of it. The workspace is the group — the firm is what the
 * B2B sale is to, so "active workspaces" is the number to watch.
 */
export function identifyAccount(account: Account): void {
  if (!on || !account.user) return;
  const u = account.user;
  if (!flag(SIGNED_IN)) {
    setFlag(SIGNED_IN, true);
    posthog.set_config({ persistence: 'localStorage+cookie' });
  }
  posthog.identify(u.id, {
    email: u.email,
    name: u.name ?? undefined,
    plan: u.plan,
    company_name: u.companyName ?? undefined,
    company_size: u.companySize ?? undefined,
    role: account.role,
  });
  if (account.workspaceId) {
    posthog.group('workspace', account.workspaceId, {
      name: u.companyName ?? undefined,
      plan: u.plan,
    });
  }
}

/** Signed out: back to an anonymous visitor with nothing remembered. */
export function forgetAccount(): void {
  if (!on) return;
  setFlag(SIGNED_IN, false);
  posthog.reset();
  posthog.set_config({ persistence: 'memory' });
}
