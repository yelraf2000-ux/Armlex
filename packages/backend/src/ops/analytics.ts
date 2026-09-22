/**
 * Server-side product analytics — PostHog, the same EU project the browser
 * reports to.
 *
 * The browser sees what someone did; the server knows what happened. The
 * events that decide the funnel are recorded here, where they cannot be lost
 * to an ad blocker or a closed tab: an account created, an address verified,
 * an invitation accepted, a question answered (and how well), a subscription
 * changed. The browser side (`frontend/src/analytics.ts`) covers what only it
 * can see — what was opened, clicked and copied.
 *
 * The same rule as there: metadata only. The question, the answer and the
 * article text never leave our own database.
 *
 * On by default in production, so the deploy needs no new configuration —
 * the project key is public and already sits in the page source. Off
 * everywhere else unless `POSTHOG_KEY` is set; `POSTHOG_KEY=off` silences a
 * production box.
 */
import { PostHog } from 'posthog-node';

const PROJECT_KEY = 'phc_vhx584HthxJgHJBLFAjW8AhS2vRpczDtaC5bvzFnVaf7';
const HOST = process.env['POSTHOG_HOST'] ?? 'https://eu.i.posthog.com';

function keyFromEnv(): string | null {
  const set = process.env['POSTHOG_KEY'];
  if (set === 'off' || set === '0') return null;
  if (set) return set;
  return process.env['NODE_ENV'] === 'production' ? PROJECT_KEY : null;
}

const key = keyFromEnv();

const client = key
  ? new PostHog(key, {
      host: HOST,
      // Low traffic: a batch would otherwise sit for the default 10 s and be
      // lost to a restart. A few events, a few seconds.
      flushAt: 5,
      flushInterval: 3000,
    })
  : null;

export const analyticsEnabled = client !== null;

/**
 * One event for one person. `workspaceId` files it under the firm as well,
 * which is what a B2B funnel is counted by.
 */
export function track(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {},
  workspaceId?: string | null,
): void {
  if (!client) return;
  try {
    client.capture({
      distinctId,
      event,
      properties,
      ...(workspaceId ? { groups: { workspace: workspaceId } } : {}),
    });
  } catch {
    // Analytics never breaks a request.
  }
}

/** Flush what is queued. Called on the way out, with a short deadline. */
export async function closeAnalytics(): Promise<void> {
  if (!client) return;
  await client._shutdown(2000).catch(() => {});
}
