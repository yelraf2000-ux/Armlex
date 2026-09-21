/**
 * Turning a live answer into a "show it working" card — by code, not by a
 * model: the answer lines are the product's own words, and the quote is cut
 * from the stored text of the article the answer cites.
 */
import { actTitle } from './titles.js';

export interface AnswerChunk {
  documentTitle: string;
  ref: string;
  text: string;
}

export interface DemoParts {
  /** The answer up to its first citation, as display lines. */
  lines: string[];
  /** «ՀՀ աշխատանքային օրենսգիրք · Հոդված 159, մաս 1». */
  source: string;
  /** A verbatim sentence of the cited provision. */
  quote: string;
  /** The whole cited article, for the number check. */
  articleText: string;
}

/** «(ՀՀ ԱՇԽԱՏԱՆՔԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 159, մաս 1)». */
const CITATION = /\(([^()]*?),\s*(Հոդված\s+\d+(?:\.\d+)?)(?:,\s*մաս\s+(\d+(?:\.\d+)?))?[^()]*\)/u;

/** The first sentence of a provision, whole or cut at a word with «…». */
export function firstSentence(text: string, max = 230): string {
  const end = text.search(/[։:](\s|$)/);
  const sentence = (end === -1 ? text : text.slice(0, end)).trim();
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** The body of part `n` of an article, or the article's first provision. */
export function partText(article: string, part: string | undefined): string | null {
  const body = article.includes('\n---\n') ? article.slice(article.indexOf('\n---\n') + 5) : article;
  if (!part) return body.split('\n').find((l) => l.trim().length > 20)?.trim() ?? null;
  const m = new RegExp(`(?:^|\\n)${part.replace('.', '\\.')}\\.\\s+([^\\n]+)`).exec(body);
  return m ? m[1]!.trim() : null;
}

export function demoParts(answer: string, chunks: AnswerChunk[]): DemoParts | { skip: string } {
  const cite = CITATION.exec(answer);
  if (!cite) return { skip: 'the answer cites no article' };
  const [, act, ref, part] = cite;

  const chunk = chunks.find(
    (c) => c.ref === ref && act!.toLocaleUpperCase('hy').includes(c.documentTitle.toLocaleUpperCase('hy').slice(0, 20)),
  ) ?? chunks.find((c) => c.ref === ref);
  if (!chunk) return { skip: `cited ${ref} is not among the delivered chunks` };

  const lines = answer
    .slice(0, cite.index)
    .replace(/\*\*/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith('- ') ? `• ${l.slice(2)}` : l));
  if (lines.length === 0 || lines.length > 5) return { skip: 'the answer before its citation is empty or too long' };
  if (lines.join(' ').length > 360) return { skip: 'the answer before its citation is too long for a card' };

  const provision = partText(chunk.text, part);
  if (!provision) return { skip: `part ${part} not found in ${ref}` };

  return {
    lines,
    source: `${actTitle(chunk.documentTitle)} · ${ref}${part ? `, մաս ${part}` : ''}`,
    quote: firstSentence(provision),
    articleText: chunk.text,
  };
}
