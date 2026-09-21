/**
 * Telegram delivery for the team group.
 *
 * Configured by two variables on the server: `TELEGRAM_BOT_TOKEN` (from
 * @BotFather) and `TELEGRAM_CHAT_ID` (the team group the bot was added to).
 * Without both, nothing is sent and callers are told so — the message is still
 * stored, and the form still works.
 */

export function isEnabled(): boolean {
  return Boolean(process.env['TELEGRAM_BOT_TOKEN'] && process.env['TELEGRAM_CHAT_ID']);
}

/**
 * Send plain text to the team group. Never throws: a Telegram outage must not
 * turn a visitor's question into an error page — the row is already saved.
 * Plain text, no parse mode, so nothing a visitor types can be read as markup.
 */
export async function sendToTeam(text: string): Promise<boolean> {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = process.env['TELEGRAM_CHAT_ID'];
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // The status only: the URL carries the token and must never be logged.
      console.error(`[telegram] sendMessage failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[telegram] sendMessage failed: ${(err as Error).name}`);
    return false;
  }
}
