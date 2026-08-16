/**
 * Armenian act numbering and the normative/individual distinction.
 *
 * Armenian acts carry a number like `ՀՕ-165-Ն` (law) or `N 155-Ն` (government
 * decision / ministerial order). The trailing letter is what matters here:
 *
 *   -Ն  (նորմատիվ)  normative — general, binding rules. RAG-eligible.
 *   -Ա  (անհատական) individual — procedural one-offs: appointing a person,
 *                   approving a draft, authorising a single shipment. These are
 *                   "in force" but legally useless for answering tax questions,
 *                   and they outnumber normative decisions substantially.
 *
 * Acts adopted before the 2018 «Նորմատիվ իրավական ակտերի մասին» law often carry
 * no suffix at all (e.g. `ՀՕ-186` from 1997). Those are not individual acts —
 * the suffix convention simply did not exist yet — so they stay eligible and
 * are reported as `unknown` suffix so the audit can surface them.
 */

export type ActSuffix = 'Ն' | 'Ա';

export interface ParsedActNumber {
  /** The matched text, e.g. "ՀՕ-165-Ն" or "N 155-Ն". */
  raw: string;
  /** 'ՀՕ' for laws/codes, 'N' for decisions and orders. */
  series: 'ՀՕ' | 'N';
  number: number;
  /** Undefined for pre-2018 acts that predate the convention. */
  suffix?: ActSuffix;
  /** Character offset in the searched text; set by parseActNumberAll. */
  index?: number;
}

// Laws: ՀՕ-165-Ն. Decisions/orders: N 155-Ն. Hyphen may be an en/em dash.
//
// No trailing \b after the suffix: JavaScript's \b is ASCII-only, and Armenian
// letters count as non-word characters, so `Ն` followed by a space or end of
// string produces no boundary and the match silently fails.
const LAW_RE = /ՀՕ\s*[-–—]\s*(\d+)(?:\s*[-–—]\s*([ՆԱ]))?/;
const DECISION_RE = /\bN\s*[-–—]?\s*(\d+)\s*[-–—]\s*([ՆԱ])/;

/**
 * Every act number in the text, in order of appearance.
 *
 * Needed because a document's body cites *other* acts' numbers constantly:
 * amendment notes in the header ("(օրենքը խմբ. 26.02.15 ՀՕ-5-Ն)") and in the
 * footer. Callers pick by position — see extractActNumber in the parser.
 */
export function parseActNumberAll(text: string): ParsedActNumber[] {
  const out: ParsedActNumber[] = [];

  for (const m of text.matchAll(new RegExp(LAW_RE, 'g'))) {
    if (!m[1]) continue;
    out.push({
      raw: m[0].replace(/\s+/g, ''),
      series: 'ՀՕ',
      number: Number(m[1]),
      index: m.index ?? 0,
      ...(m[2] ? { suffix: m[2] as ActSuffix } : {}),
    });
  }

  for (const m of text.matchAll(new RegExp(DECISION_RE, 'g'))) {
    if (!m[1] || !m[2]) continue;
    out.push({
      raw: `N ${m[1]}-${m[2]}`,
      series: 'N',
      number: Number(m[1]),
      suffix: m[2] as ActSuffix,
      index: m.index ?? 0,
    });
  }

  return out.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

export function parseActNumber(text: string): ParsedActNumber | undefined {
  const law = LAW_RE.exec(text);
  if (law?.[1]) {
    return {
      raw: law[0].replace(/\s+/g, ''),
      series: 'ՀՕ',
      number: Number(law[1]),
      ...(law[2] ? { suffix: law[2] as ActSuffix } : {}),
    };
  }

  const dec = DECISION_RE.exec(text);
  if (dec?.[1] && dec[2]) {
    return {
      raw: `N ${dec[1]}-${dec[2]}`,
      series: 'N',
      number: Number(dec[1]),
      suffix: dec[2] as ActSuffix,
    };
  }

  return undefined;
}

/**
 * Whether a document should be parsed, embedded and served by retrieval.
 *
 * Only an explicit -Ա suffix disqualifies a document. Everything else — -Ն,
 * no suffix, or no parseable number — stays eligible, because wrongly dropping
 * a real norm is far worse than carrying a little dead weight.
 */
export function isRagEligible(actNumber: ParsedActNumber | undefined): boolean {
  return actNumber?.suffix !== 'Ա';
}

export function describeEligibility(
  actNumber: ParsedActNumber | undefined,
): string {
  if (!actNumber) return 'no act number found — eligible by default';
  if (actNumber.suffix === 'Ա') return 'individual act (-Ա) — excluded from RAG';
  if (actNumber.suffix === 'Ն') return 'normative act (-Ն)';
  return 'no suffix (pre-2018 convention) — eligible';
}
