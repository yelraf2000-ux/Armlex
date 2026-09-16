/**
 * Something to read while an answer is being prepared.
 *
 * Time to first token is about seven seconds — two model calls and a retrieval
 * — and until now that was a typing indicator and nothing else.
 *
 * Every word of it is STATUTE, lifted verbatim from the corpus and shown with
 * its article number. Nothing here is written by a model or by us, and that is
 * not fastidiousness: this product's whole claim is that it never states law it
 * cannot point at, and a reader who sees a legal sentence inside MatyanAI will
 * take it as law whether or not it is labelled as filler. A hand-written list
 * of "interesting facts" would be unsourced legal claims, and it would go stale
 * the first time a rate changed without anyone noticing.
 *
 * Drawn from the two CODES — the Tax Code and the Labour Code. They are what
 * this audience works in; the rest of the corpus is government decisions and
 * SRC orders, whose quotable sentences are mostly instructions for filling in
 * boxes on a declaration.
 */
import { sql } from '../db/client.js';

export interface Interlude {
  /** The sentence, exactly as the act has it. */
  text: string;
  ref: string;
  documentTitle: string;
  arlisId: number;
}

/** Armenian ends a sentence with ։; the corpus also uses : in this position. */
const SENTENCE_END = /(?<=[։:])\s+/;

/** A sentence short enough to read in a glance, long enough to stand alone. */
const MIN = 55;
const MAX = 230;

/**
 * Worth reading on its own.
 *
 * A sentence qualifies only if it states something CONCRETE — a rate, a sum, a
 * period — because the alternative is a definition that means nothing outside
 * the article it defines a term for. And it is rejected if it leans on
 * elsewhere: «սույն հոդվածի 9.1-ին մասով», «Օրենսգրքի 65-րդ հոդվածով» are
 * sentences whose content is in another article, so quoted alone they say
 * nothing and imply something.
 */
function standsAlone(s: string): boolean {
  if (s.length < MIN || s.length > MAX) return false;
  if (s.includes('|')) return false; // a row lifted out of a rate table

  /*
   * A whole sentence, not a limb of a list.
   *
   * Enumerated points — «ա. 1-ից 120 ձիաուժ է, ապա 200 դրամ,», «6) անձինք
   * կնքել են…» — are grammatically mid-sentence and say something different
   * once their stem is gone. One of them was a line from Հոդված 445, which is
   * the list of acts the Tax Code REPEALED: shown on its own it would have
   * presented a repealed law as current. Requiring a capital at the start and
   * a sentence stop at the end excludes the whole class.
   */
  if (!/^[Ա-Ֆ«]/.test(s)) return false;
  if (!/[։:]$/.test(s)) return false;

  if (!/[0-9]+[  ]?(տոկոս|դրամ|օր|ամս|ամիս|տարի|ժամ|րոպե|անգամ)/.test(s)) return false;
  if (/սույն|օրենսգրքի|հոդվածով սահմանված|լրացվում է|Հաշվարկի/i.test(s)) return false;

  /*
   * Nothing that points backwards. «Այդ աշխատողների աշխատաժամանակի միջին
   * տևողությունը…» and «նշված ժամկետը կարող է երկարաձգվել 15 օրով» are about
   * whichever workers or deadline the PREVIOUS sentence established, so alone
   * they read as general rules and are not.
   */
  if (/^(Այդ|Այս|Դրանց|Դրանք|Նշված|Նույն)[ ]/.test(s)) return false;
  if (/նշված ժամկետ/i.test(s)) return false;

  return true;
}

/** Strip the metadata header; the law is what follows `---`. */
function body(text: string): string {
  const i = text.indexOf('\n---\n');
  return i === -1 ? text : text.slice(i + 5);
}

/**
 * A part opens with its number — `1. `, `1.1. ` — which is addressing, not
 * prose, and reads as a stray digit once the sentence is on its own.
 */
function trimPartNumber(s: string): string {
  return s.replace(/^[0-9]+(?:\.[0-9]+)*\.[  ]*/, '').trim();
}

export function sentencesOf(text: string): string[] {
  return body(text)
    .split('\n')
    .flatMap((line) => line.split(SENTENCE_END))
    .map((s) => trimPartNumber(s.replace(/\s+/g, ' ')))
    .filter(standsAlone);
}

/**
 * Built once and held, because the corpus changes on ingest and not otherwise.
 * An hour is far shorter than the gap between ingests and long enough that this
 * never runs twice in a session.
 */
let cache: { at: number; items: Interlude[] } | null = null;
const TTL_MS = 60 * 60 * 1000;

export async function interludes(): Promise<Interlude[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items;

  const rows = await sql<{ text: string; ref: string; title: string; arlis_id: number }[]>`
    SELECT a.text_hy AS text, a.article_number AS ref, d.title_hy AS title, d.arlis_id
    FROM articles a
    JOIN documents d ON d.id = a.document_id
    WHERE a.status = 'in_force' AND d.status = 'in_force' AND d.doc_type = 'code'`;

  // Deduplicated: a sentence recurs across articles (and within one), and the
  // same words twice in a short rotation reads as a stuck screen.
  const seen = new Set<string>();
  const items: Interlude[] = [];
  for (const row of rows) {
    for (const text of sentencesOf(row.text)) {
      if (seen.has(text)) continue;
      seen.add(text);
      items.push({ text, ref: row.ref, documentTitle: row.title, arlisId: row.arlis_id });
    }
  }

  cache = { at: Date.now(), items };
  return items;
}

/** A handful, in no particular order, for one wait. */
export async function someInterludes(n = 6): Promise<Interlude[]> {
  const all = [...(await interludes())];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  return all.slice(0, n);
}
