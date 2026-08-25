/**
 * Mechanical validation of NUMBERS asserted in an answer.
 *
 * Quotes have been checked programmatically since 2026-08-15. Numbers have
 * not: they are guarded only by prompt rule 3a ("never state a number you did
 * not read"), and a prompt rule is an instruction, not a guarantee. GOTCHAS
 * records the general form of this — anything the surrounding context can
 * drown out must be COMPUTED, not inferred — and a request carrying 30,000
 * characters of statute is exactly that context.
 *
 * The failure this exists for is documented three times over. Asked which line
 * of the turnover-tax calculation a fixed-asset sale goes on, the system has
 * answered `8.8`, `9.1` and `9.2`. All three are wrong, none appears in the
 * fragments attached to that meaning, and each arrived inside an otherwise
 * well-formed, well-cited answer. A wrong line number is the most harmful
 * output this tool can produce: it is specific, actionable, and an accountant
 * who files against it is worse off than one who was told to look it up.
 *
 * ## Why every number is checked rather than a marker vocabulary
 *
 * The obvious design is to check only numbers wearing a legal-quantity label —
 * `տող N`, `կետ N`, `N տոկոս`. That inverts the risk: a label this file forgot
 * to list becomes a number nobody checks, and a silent miss is the worst
 * failure mode for a guard. So EVERY number is extracted and the verifiable
 * ones are exempted. Because any number present in the fragments passes
 * automatically, ordinary prose numbers are exempt by construction — the ones
 * that survive are, by definition, numbers with no source.
 *
 * Markers are still used, but for SEVERITY rather than scope: an unsourced
 * number wearing a legal label is a different animal from one sitting in a
 * sentence of arithmetic.
 *
 * ## Report-only by default
 *
 * `validateNumbers` classifies; it does not rewrite. The false-positive rate is
 * unmeasured, and GOTCHAS is explicit that a guard firing on valid input
 * teaches readers to ignore it — the quote validator had to be walked back
 * twice for exactly that. Enforcement is a separate decision to be made on
 * measured data, and unlike a quote a number cannot simply be excised: the
 * sentence around it collapses.
 */

/** Digits, with the separators Armenian and Russian legal text actually uses. */
const NUMBER = /\d+(?:[   .,]\d+)*/g;

/**
 * Multiplier words, so `24 մլն` can be checked against a fragment that writes
 * the same threshold as `24 000 000`. Without this the commonest legitimate
 * paraphrase of an amount reads as a fabrication.
 */
const MULTIPLIERS: { pattern: RegExp; zeros: number }[] = [
  { pattern: /^\s*(?:հազար|тыс\.?|тысяч)/i, zeros: 3 },
  { pattern: /^\s*(?:մլն|միլիոն|млн\.?|миллион)/i, zeros: 6 },
  { pattern: /^\s*(?:մլրդ|միլիարդ|млрд\.?|миллиард)/i, zeros: 9 },
];

/**
 * Labels that make a number a claim about the law rather than about arithmetic.
 *
 * Used only to rank what a human should look at first. Deliberately generous:
 * over-including costs a severity label, while under-including costs nothing
 * here, because scope is not decided by this list.
 */
/**
 * Legal labels, grouped into FAMILIES.
 *
 * The family is what makes label-scoped matching possible. Rule 3a requires a
 * number to appear in a fragment "attached to that exact meaning", and matching
 * the bare digits ignores the second half of that sentence — which is where the
 * guard was measured to be weakest. A one-digit rate is `5`, and `5` occurs
 * somewhere in 30,000 characters of statute essentially always, so an
 * unlabelled check passed a fabricated rate 88% of the time. Requiring the
 * fragment to say `5` NEXT TO a percent marker restores the meaning.
 */
const MARKER_FAMILIES: { family: string; pattern: RegExp }[] = [
  { family: 'line', pattern: /(?:տող|строк)/i },
  { family: 'point', pattern: /(?:կետ|пункт)/i },
  { family: 'part', pattern: /(?:մաս|част)/i },
  { family: 'article', pattern: /(?:հոդված|стать)/i },
  { family: 'annex', pattern: /(?:հավելված|приложени)/i },
  { family: 'table', pattern: /(?:աղյուսակ|таблиц)/i },
  { family: 'deadline', pattern: /(?:մինչև|ամսվա|ժամկետ|срок|числа)/i },
];

/**
 * A percentage, unlike the other families, is recognised by ADJACENCY rather
 * than by a nearby word.
 *
 * Measured: «5% (որը կազմում է 10 000 դրամ)» had the computed AMOUNT labelled a
 * rate, because a percent marker sat within the window. A windowed rule cannot
 * tell the percentage from the sum it produces — but the two are never written
 * the same way. A rate is the number the marker is stuck to.
 */
const PERCENT_ADJACENT = /^\s*(?:%|տոկոս|процент)/i;

function familyOf(text: string): string | null {
  return MARKER_FAMILIES.find((f) => f.pattern.test(text))?.family ?? null;
}

/**
 * The legal family a number is presented under, at a position in a text.
 *
 * Deliberately shared between the answer side and the fragment side. Two
 * implementations of "what is this number labelled as" would drift, and the
 * one nobody tested would be the one deciding whether a rate is verified —
 * the same reason `isVerbatimQuote` is shared with the streaming path.
 */
export function familyAt(text: string, at: number, length: number): string | null {
  const after = text.slice(at + length, at + length + MARKER_WINDOW);
  if (PERCENT_ADJACENT.test(after)) return 'percent';
  const before = text.slice(Math.max(0, at - MARKER_WINDOW), at);
  return familyOf(markerSide(before, 'before')) ?? familyOf(markerSide(after, 'after'));
}

/**
 * How far a marker may sit from the number it labels.
 *
 * A wide window bleeds across clauses: in «Հարկը կկազմի 1500000 դրամ, տես 9.2
 * տողը» a 40-character window let «տողը» label the computed AMOUNT as well as
 * the line number, merging the two classes this distinction exists to separate.
 * The window is therefore short and cut at the nearest clause boundary — a
 * label binds to the number beside it, not to one across a comma.
 */
const MARKER_WINDOW = 90;
const CLAUSE_BOUNDARY = /[,;.։:\n]/;

/**
 * One member of a numeric enumeration, with the Armenian ordinal suffix that
 * legal text attaches to it (`18-20-րդ`, `5.10`).
 */
const LIST_MEMBER = /\d+(?:[.,-]\d+)*(?:-[Ա-և]{1,4})?/;
const LIST_LEAD = new RegExp(`^(?:[\\s,ևи]*${LIST_MEMBER.source})+`, 'u');
const LIST_TRAIL = new RegExp(`(?:${LIST_MEMBER.source}[\\s,ևи]*)+$`, 'u');

/**
 * The text a marker may be looked for in, on one side of a number.
 *
 * Two things happen here, and the second was found by a failing test rather
 * than by reasoning. Cutting at a clause boundary keeps a label bound to the
 * number beside it. But an ENUMERATION carries one label for all its members —
 * «5.10, 6.10, 7.10, 8.8, 9.10 տողերը» labels five line numbers with a single
 * «տողերը» at the end — and the commas between them are list separators, not
 * clause boundaries. Cutting at them orphaned every member but the last, which
 * would have made the guard fire on the one line number in that sentence that
 * is genuinely in the law.
 *
 * So sibling list members are consumed first, and only then is the clause cut
 * applied to whatever real prose remains.
 */
function markerSide(text: string, side: 'before' | 'after'): string {
  const window = side === 'before' ? text.slice(-MARKER_WINDOW) : text.slice(0, MARKER_WINDOW);
  const past = side === 'before' ? window.replace(LIST_TRAIL, '') : window.replace(LIST_LEAD, '');
  const parts = past.split(CLAUSE_BOUNDARY);
  return (side === 'before' ? parts[parts.length - 1] : parts[0]) ?? '';
}

/**
 * Is this number a thousands-grouped integer rather than a hierarchical
 * reference?
 *
 * `115,000,000` and `9.2` are both "digits with a separator", and they need
 * opposite treatment: the first is an amount that a fragment may legitimately
 * write as `115 000 000`, the second is a form line whose separator is part of
 * its identity. The distinguishing feature is grouping — thousands separators
 * always produce groups of exactly three.
 */
function isGrouped(text: string): boolean {
  const parts = text.split(/[^\d]+/).filter(Boolean);
  return parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
}

export type NumberSeverity = 'legal' | 'other';

export interface NumberCheck {
  /** The number exactly as written in the answer. */
  text: string;
  /** Digits only, separators removed. */
  digits: string;
  valid: boolean;
  severity: NumberSeverity;
  /** Where it was found, when valid. */
  source?: 'fragment' | 'user';
  /** ~40 characters either side, for a human reading the report. */
  context: string;
}

export interface NumberValidation {
  checks: NumberCheck[];
  /** Unsourced numbers wearing a legal label — the harmful class. */
  legalCount: number;
  /** Unsourced numbers without one — mostly arithmetic, pending measurement. */
  otherCount: number;
}

/** Strip separators so `115,000,000`, `115 000 000` and `115000000` compare equal. */
function digitsOf(s: string): string {
  return s.replace(/[^\d]/g, '');
}

/**
 * Every digit string a fragment could legitimately match this number by.
 *
 * A decimal-looking number such as `9.2` keeps its literal form as well as its
 * digit form. Reducing it to `92` alone would let a fragment mentioning point
 * 92 vouch for line 9.2 — precisely the fabrication being hunted.
 */
function candidates(text: string, following: string): string[] {
  const out = new Set<string>([digitsOf(text)]);
  for (const { pattern, zeros } of MULTIPLIERS) {
    if (pattern.test(following)) out.add(digitsOf(text) + '0'.repeat(zeros));
  }
  return [...out];
}

/**
 * Is this number present in one of the texts?
 *
 * Matching is separator-insensitive, so the comparison survives ARLIS's
 * formatting differing from the model's. But a number is present only as a
 * WHOLE run: `20` must not be vouched for by `2026`, or one stray year in a
 * fragment would validate every deadline in the answer.
 */
function presentIn(
  haystacks: string[],
  forms: string[],
  literal: string,
  family: string | null,
): boolean {
  const literalDigits = digitsOf(literal);
  // A hierarchical reference: separated, but not thousands-grouped.
  const literalIsRef = /[^\d]/.test(literal) && !isGrouped(literal);

  for (const h of haystacks) {
    for (const m of h.matchAll(NUMBER)) {
      const run = m[0];
      let digitsMatch = run === literal;
      if (!digitsMatch) {
        const d = digitsOf(run);
        // A reference like `9.2` is only vouched for by another hierarchical
        // form of the same digits — never by the bare run `92`.
        if (literalIsRef) {
          digitsMatch = /[^\d]/.test(run) && !isGrouped(run) && d === literalDigits;
        } else {
          digitsMatch = forms.includes(d);
        }
      }
      if (!digitsMatch) continue;

      // The digits match. If the answer presented the number under a legal
      // label, the fragment must carry a label of the SAME family beside it —
      // otherwise `5` from an unrelated provision would vouch for a `5 տոկոս`
      // rate the law never states.
      if (family === null) return true;
      if (familyAt(h, m.index, run.length) === family) return true;
    }
  }
  return false;
}

/**
 * Classify every number in an answer.
 *
 * @param answer      the generated answer, after quote validation
 * @param chunkTexts  the fragment texts supplied to generation
 * @param userTexts   the user's own messages and fact summary — a turnover the
 *                    user stated is a legitimate number for the answer to
 *                    repeat, and flagging it would be pure noise
 * @param refs        the identifiers of the delivered chunks (`109017#Հոդված
 *                    298`). An article number is sourced by the fact that we
 *                    RETRIEVED that article, and the number frequently does not
 *                    appear inside the article's own body text. Measured: 7 of
 *                    20 firings on real answers were correct citations of
 *                    correctly retrieved articles, flagged only because the
 *                    validator could not see the reference it had delivered.
 */
export function validateNumbers(
  answer: string,
  chunkTexts: string[],
  userTexts: string[] = [],
  refs: string[] = [],
): NumberValidation {
  const checks: NumberCheck[] = [];

  for (const m of answer.matchAll(NUMBER)) {
    const text = m[0];
    const at = m.index;
    const before = answer.slice(Math.max(0, at - 40), at);
    const after = answer.slice(at + text.length, at + text.length + 40);

    // A number the model used to number its OWN list asserts nothing about the
    // law: `1.` at the start of a line is answer structure, not a citation.
    if (/(?:^|\n)[ \t]*$/.test(before) && /^[.)]\s/.test(after)) continue;

    const family = familyAt(answer, at, text.length);

    const forms = candidates(text, after);
    // A ref reads `109017#Հոդված 298`, so it carries its own `Հոդված` label and
    // is matched under the ordinary family rule rather than as a special case.
    const inFragments =
      presentIn(chunkTexts, forms, text, family) || presentIn(refs, forms, text, family);
    // The USER's own figures are matched WITHOUT the label requirement: a
    // person states "my turnover is 30 million", not "my turnover, article 258,
    // is 30 million", and demanding they use legal vocabulary would flag their
    // own facts back at them.
    const inUser = inFragments ? false : presentIn(userTexts, forms, text, null);

    checks.push({
      text,
      digits: digitsOf(text),
      valid: inFragments || inUser,
      severity: family !== null ? 'legal' : 'other',
      ...(inFragments
        ? { source: 'fragment' as const }
        : inUser
          ? { source: 'user' as const }
          : {}),
      context: `${before}⟦${text}⟧${after}`.replace(/\s+/g, ' '),
    });
  }

  const unsourced = checks.filter((c) => !c.valid);
  return {
    checks,
    legalCount: unsourced.filter((c) => c.severity === 'legal').length,
    otherCount: unsourced.filter((c) => c.severity === 'other').length,
  };
}
