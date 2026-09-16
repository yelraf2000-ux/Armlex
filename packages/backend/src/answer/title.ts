/**
 * A name for a conversation, from its first question alone.
 *
 * Why it exists: the register showed a conversation under the full text of the
 * question that started it, truncated. Two questions about payroll begin with
 * the same nine words, so a list of them read as a list of near-duplicates and
 * the only way to tell them apart was to open each one.
 *
 * Why it is a separate call rather than a field on the contextualiser: it must
 * not be on the critical path. It is fired alongside contextualisation and
 * nothing waits for it — the answer streams whether or not a name has arrived,
 * and a failure here costs a name, never a turn.
 *
 * Armenian, always: the name goes into a sidebar that is Armenian, and a
 * Russian question used to put a Russian line in it.
 *
 * Haiku, `temperature: 0`, 32 tokens. The whole call is a few hundred
 * milliseconds and a fraction of a cent against a question that costs both in
 * quantity.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';

/** Long enough to be specific, short enough for a 244px column. */
const MAX_CHARS = 48;

const SYSTEM = [
  'Name the conversation this question starts, as a file would be named.',
  '',
  'Rules:',
  '- 2 to 5 words. Never a sentence, never a question, no final full stop.',
  '- ALWAYS IN ARMENIAN, whatever language the question was written in — a',
  '  Russian or transliterated question still gets an Armenian name, because',
  '  the register it appears in is Armenian.',
  '- Name the SUBJECT, not the act of asking: "ԱԱՀ-ի դրույքաչափ", not',
  '  "Հարց ԱԱՀ-ի մասին".',
  '- Keep the distinguishing detail. Two questions about payroll must not end',
  '  up with the same name — "Ուշացած աշխատավարձ" beats "Աշխատավարձ".',
  '- Output the name alone. No quotes, no preamble, no explanation.',
].join('\n');

/**
 * Returns null rather than throwing: every caller treats a missing name as
 * "fall back to the question", which is what the register did before this
 * existed and is a perfectly good name.
 */
export async function titleFor(message: string): Promise<string | null> {
  try {
    const res = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: 32,
      temperature: 0,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: message.slice(0, 2000) }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
      // Models wrap a title in quotes about one time in twenty, and a stray
      // pair of them in the register looks like a bug rather than a name.
      .replace(/^["'«»„“”]+|["'«»„“”]+$/g, '')
      .replace(/[.。]$/, '')
      .trim();

    if (!text) return null;
    // A model that ignored "2 to 5 words" and returned a sentence would put a
    // paragraph in the sidebar. Truncating is kinder than showing it, and
    // kinder than dropping a name that is merely too long.
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1).trimEnd()}…` : text;
  } catch {
    return null;
  }
}
