/**
 * Polite HTTP client for ARLIS.
 *
 * - Serialises every request through a single queue with a fixed delay, so no
 *   amount of concurrency upstream can accidentally hammer the site.
 * - Identifiable User-Agent.
 * - Retries only on 5xx / network errors, with backoff.
 * - Optionally writes a raw HTML snapshot so we can reparse without refetching.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@armlex/shared';

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
/** Serialises the whole process onto one polite request chain. */
let gate: Promise<unknown> = Promise.resolve();

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  elapsedMs: number;
}

async function fetchOnce(url: string): Promise<FetchResult> {
  const wait = config.crawlDelayMs - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);

  const started = Date.now();
  const res = await fetch(url, {
    headers: {
      'User-Agent': config.userAgent,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'hy,ru;q=0.8,en;q=0.6',
    },
    redirect: 'follow',
  });
  const html = await res.text();
  lastRequestAt = Date.now();

  return {
    url,
    finalUrl: res.url,
    status: res.status,
    html,
    elapsedMs: Date.now() - started,
  };
}

export async function fetchPage(
  url: string,
  opts: { retries?: number; snapshotName?: string } = {},
): Promise<FetchResult> {
  const retries = opts.retries ?? 2;

  const run = async (): Promise<FetchResult> => {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await fetchOnce(url);

        // Retry transient server failures; surface 4xx to the caller as-is.
        if (result.status >= 500) {
          lastErr = new Error(`HTTP ${result.status}`);
        } else {
          if (opts.snapshotName) await saveSnapshot(opts.snapshotName, result.html);
          return result;
        }
      } catch (err) {
        lastErr = err;
      }

      if (attempt < retries) await sleep(config.crawlDelayMs * (attempt + 2));
    }

    throw lastErr ?? new Error(`failed to fetch ${url}`);
  };

  // Chain onto the gate so requests never overlap, and keep the chain alive
  // even when a request rejects.
  const queued = gate.then(run, run);
  gate = queued.catch(() => undefined);
  return queued;
}

export async function saveSnapshot(name: string, html: string): Promise<string> {
  await mkdir(config.snapshotDir, { recursive: true });
  const path = join(config.snapshotDir, `${name}.html`);
  await writeFile(path, html, 'utf8');
  return path;
}
