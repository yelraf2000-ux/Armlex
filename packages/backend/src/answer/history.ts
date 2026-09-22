/**
 * How much of a conversation goes back to the model.
 *
 * `chat.ts` used to resend the whole transcript every turn, on top of ~34,000
 * characters of statute per turn. Armenian tokenises at ~1.7 tokens/character,
 * so a long consultation walks into `model_context_window_exceeded` — and that
 * arrived as an unhandled 502: a professional mid-consultation, told nothing,
 * with no way to continue except to guess that a new conversation would work.
 *
 * Trimming is safe here in a way it would not be in a general chat product,
 * because the two things a later turn actually needs from earlier ones are
 * carried separately: `fact_summary` holds what the user established, and the
 * contextualiser rewrites each question to stand on its own. What is dropped is
 * the wording of old turns, not the facts in them.
 */

/** Prior turns, oldest first — the shape `generate` takes. */
export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The character budget for history.
 *
 * Sonnet takes 200,000 tokens. A turn spends roughly: fragments up to ~50,000
 * characters of Armenian (~85,000 tokens), the system prompt (~5,000), and
 * 16,000 reserved for the answer. That leaves ~90,000 tokens, and 40,000
 * Armenian characters is ~68,000 — inside it with room for a heavier retrieval
 * turn. A consultation of a dozen exchanges is nowhere near this; only the
 * runaway sessions that used to crash are touched.
 */
export const HISTORY_BUDGET_CHARS = 40_000;

export interface FittedHistory {
  turns: HistoryTurn[];
  /** How many older turns were left out. Zero for almost every conversation. */
  dropped: number;
}

/**
 * The most recent turns that fit the budget, oldest first.
 *
 * Whole turns only — half an answer is worse context than none. The kept run
 * must also begin with a user turn: the Messages API refuses a conversation
 * that opens with an assistant message, so a trim that left one exposed would
 * replace the overflow error with a 400.
 */
export function fitHistory(
  turns: HistoryTurn[],
  budget = HISTORY_BUDGET_CHARS,
): FittedHistory {
  let used = 0;
  let from = turns.length;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const cost = turns[i]!.content.length;
    // Nothing kept yet means this is the newest turn, and it is kept whatever
    // it costs: one oversized answer must not empty the conversation.
    if (used + cost > budget && from < turns.length) break;
    used += cost;
    from = i;
  }
  while (from < turns.length && turns[from]!.role === 'assistant') from += 1;
  return { turns: turns.slice(from), dropped: from };
}

/**
 * Did this fail because the conversation no longer fits?
 *
 * Anthropic reports it as a 400 naming the prompt length, or as a
 * `model_context_window_exceeded` stop reason; Gemini and the SDK phrase it
 * differently again. Matched on text because the shape is not guaranteed, and
 * the cost of a miss is only that the reader sees the generic error instead of
 * the useful one.
 */
export function isContextOverflow(err: unknown): boolean {
  const e = (err ?? {}) as { message?: unknown };
  const text = typeof e.message === 'string' ? e.message : String(err ?? '');
  return (
    /model_context_window_exceeded/i.test(text) ||
    /prompt is too long/i.test(text) ||
    /context (window|length) (exceeded|too long)/i.test(text) ||
    /maximum context length/i.test(text)
  );
}

/** What the reader is told when it happens anyway. Armenian, and actionable. */
export const CONTEXT_OVERFLOW_MESSAGE =
  'Այս խորհրդատվությունը չափազանց երկար է դարձել և այլևս չի տեղավորվում։ ' +
  'Սկսեք նոր խորհրդատվություն՝ Ձեր հարցը կրկին տալով. նախորդ պատասխանները մնում են պատմության մեջ։';
