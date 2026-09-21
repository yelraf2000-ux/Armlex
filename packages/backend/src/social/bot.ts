/**
 * The few Telegram Bot API calls the social flow needs. Never logs the URL —
 * it carries the token.
 */

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description ?? `HTTP ${res.status}`}`);
  return json.result as T;
}

/** Telegram's limit on a photo caption. */
export const CAPTION_LIMIT = 1024;
