/**
 * Which language an answer must be written in.
 *
 * Deliberately a pure script count, not a language model or an inference. The
 * generator sees tens of thousands of characters of Armenian statute in every
 * request, and that mass reliably overwhelms a prompt instruction to mirror the
 * user's language — a Russian question came back with 0 Cyrillic characters and
 * 1,139 Armenian ones. A deterministic function cannot drift under that
 * pressure, so the model is told the language instead of asked to work it out.
 *
 * Latin script resolves to Armenian on purpose. The audience writes Armenian in
 * Latin letters constantly ("es uzum em xanut bacel") — that is a transliterated
 * Armenian question, not an English one, and the contextualiser already
 * normalises it into Armenian script.
 */
export type AnswerLanguage = 'hy' | 'ru';

const CYRILLIC = /[\u0400-\u04FF]/g;
const ARMENIAN = /[\u0530-\u058F]/g;

export function answerLanguage(message: string): AnswerLanguage {
  const cyrillic = (message.match(CYRILLIC) ?? []).length;
  const armenian = (message.match(ARMENIAN) ?? []).length;
  return cyrillic > armenian ? 'ru' : 'hy';
}
