/**
 * Point the bot's updates at our webhook. Run once on the server, after
 * TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are in the environment:
 *
 *   npx tsx packages/backend/src/social/set-webhook.ts
 *
 * Prints Telegram's view of the webhook afterwards — never the token.
 */
const token = process.env['TELEGRAM_BOT_TOKEN'];
const secret = process.env['TELEGRAM_WEBHOOK_SECRET'];
const base = process.env['PUBLIC_URL'] ?? 'https://matyanai.am';
if (!token || !secret) {
  console.error('TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must both be set');
  process.exit(1);
}

const api = (method: string, body?: unknown): Promise<Response> =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

const set = (await (
  await api('setWebhook', {
    url: `${base}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ['channel_post', 'callback_query'],
    drop_pending_updates: true,
  })
).json()) as { ok: boolean; description?: string };
console.log('setWebhook:', set.ok ? 'ok' : `failed — ${set.description}`);

const info = (await (await api('getWebhookInfo')).json()) as {
  result?: { url?: string; pending_update_count?: number; last_error_message?: string; allowed_updates?: string[] };
};
console.log('url:', info.result?.url);
console.log('allowed:', info.result?.allowed_updates?.join(', '));
console.log('pending:', info.result?.pending_update_count, info.result?.last_error_message ?? '');
