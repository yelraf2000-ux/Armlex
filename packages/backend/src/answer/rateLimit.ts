/**
 * Rate limiting for the one endpoint anybody on the internet can call.
 *
 * `/api/preview` generates a real answer for a visitor with no account. That is
 * the whole point of it, and it is also a form anyone can spend from — the
 * precise hazard the shared password used to cover and the per-user allowance
 * now covers everywhere else. A preview costs about $0.012, so an unthrottled
 * endpoint is roughly $12 per thousand requests to whoever holds the keys.
 *
 * In memory, on purpose. A Postgres counter would add a round trip to every
 * request to defend against something a single small instance can hold in a
 * Map, and Render runs one instance. **If this ever scales to several
 * instances the limit becomes per-instance and must move to the database** —
 * written down here because that failure is silent: the endpoint keeps working
 * and simply costs N times more.
 */

/** Requests allowed per address, per window. */
const LIMIT = 4;
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Bounded so a flood of distinct addresses cannot grow this without limit. */
const MAX_TRACKED = 20_000;

const hits = new Map<string, number[]>();

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  /** When the oldest hit in the window expires, for a Retry-After header. */
  resetMs: number;
}

export function checkRate(key: string, now = Date.now()): RateVerdict {
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, (recent[0] ?? now) + WINDOW_MS - now),
    };
  }

  recent.push(now);
  hits.set(key, recent);

  // Opportunistic sweep, so the map cannot grow unbounded without a timer.
  if (hits.size > MAX_TRACKED) {
    for (const [k, times] of hits) {
      const live = times.filter((t) => t > cutoff);
      if (live.length === 0) hits.delete(k);
      else hits.set(k, live);
      if (hits.size <= MAX_TRACKED) break;
    }
  }

  return { allowed: true, remaining: LIMIT - recent.length, resetMs: WINDOW_MS };
}

/** Test seam. */
export function resetRateLimits(): void {
  hits.clear();
}

export const PREVIEW_LIMIT = LIMIT;
