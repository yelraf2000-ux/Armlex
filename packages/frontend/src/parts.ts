/**
 * Which piece of an article a reader is actually shown.
 *
 * Opening a provision used to hand over the whole article — 9,556 characters
 * for Հոդված 150, 32,502 for Հոդված 121 — to verify one sentence. The parts
 * (մասեր) of an article average about 500 characters, so showing the part the
 * answer leans on is one screen instead of forty.
 *
 * The cut is made at boundaries the LEGISLATOR drew, never at ones we choose.
 * Trimming to the operative sentence is a legal judgment and loses conditions:
 * the 10% IT rate in Հոդված 150, մաս 1.1 reads as an unconditional rate right
 * up until you include the Government criteria and the commission's conclusion
 * that sit in the same part. A part boundary carries its own conditions with
 * it; a sentence boundary does not.
 *
 * Two anchors decide which parts those are, both taken from the delivered
 * answer and both deterministic:
 *
 *   1. a verified quote falls inside the part, or
 *   2. the answer names the part — «(ՀՀ Հարկային օրենսգիրք, Հոդված 150, մաս 1.1)».
 *
 * Measured over 263 real answers: 63% name a part, and only 7.6% offer neither
 * anchor. Those keep the whole article, because a part chosen without evidence
 * would be a guess wearing the clothes of a citation.
 */

export interface Part {
  /** `1`, `1.1`, … as the act numbers it; null for text before the first part. */
  label: string | null;
  text: string;
  shown: boolean;
}

/** A part opens on its own paragraph, numbered: `1. `, `1.1. `, `15.2. `. */
const PART_MARKER = /^([0-9]+(?:\.[0-9]+)*)\.[  ]/;

/**
 * Cut an article at its part boundaries.
 *
 * Everything from one numbered paragraph up to the next belongs to that part —
 * an article's parts run to several paragraphs and to whole rate tables, and a
 * part cut off from its table would be worse than no trimming at all.
 */
export function splitParts(body: string): { label: string | null; text: string }[] {
  const out: { label: string | null; text: string }[] = [];
  let label: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join('\n\n').trim();
    if (text !== '' || label !== null) out.push({ label, text });
    buffer = [];
  };

  for (const paragraph of body.split(/\n\s*\n/)) {
    const m = PART_MARKER.exec(paragraph.trim());
    if (m) {
      flush();
      label = m[1]!;
    }
    buffer.push(paragraph);
  }
  flush();

  return out.filter((p) => p.text !== '');
}

/**
 * The parts the answer names for one provision — `['1.1']`, `['1', '2']`.
 *
 * Read from the text as delivered, in the forms answers actually use:
 * «Հոդված 150, մաս 1.1», «Հոդված 254-ի մաս 3», «Հոդված 267, մաս 1, կետ 1 կամ
 * մաս 2». `կետ` is deliberately not matched — a point lives inside a part, and
 * naming one says nothing about which part is meant beyond what `մաս` already
 * said.
 */
export function partsNamed(answer: string, ref: string): string[] {
  if (!answer || !ref) return [];
  const found: string[] = [];

  for (let at = answer.indexOf(ref); at !== -1; at = answer.indexOf(ref, at + 1)) {
    // Stop at the next article: «Հոդված 130, մաս 2, Հոդված 170, մաս 2» must not
    // hand 170's part to 130. Otherwise a bounded window, since a citation's
    // parts follow it immediately or not at all.
    const from = at + ref.length;
    const next = answer.indexOf('Հոդված', from);
    const until = Math.min(next === -1 ? answer.length : next, from + 60);
    for (const m of answer.slice(from, until).matchAll(/մաս[ա-ֆ]*[^0-9]{0,3}([0-9]+(?:\.[0-9]+)*)/g)) {
      found.push(m[1]!);
    }
  }

  return [...new Set(found)];
}

/**
 * Mark the parts to show.
 *
 * The two anchors are not equal and are not combined. A named part is the
 * answer SAYING which part it used; a quote match is an inference from a
 * substring. So a naming, where there is one, decides alone.
 *
 * That ordering is not fastidiousness. Checked against the live answer for
 * «Հոդված 150, մաս 1.1», the quote the model emitted was
 * «10 տոկոս դրույքաչափով» — twenty-one characters, and the income tax code
 * sets a 10% rate in four separate parts. Taking quote and naming together
 * showed the reader the IT relief alongside bank deposits, property disposal
 * and share capital, each presented as something the answer relied on.
 *
 * With no naming, a quote still has to LOCATE to count: one occurring in more
 * than one part says nothing about which was meant, and is ignored rather than
 * allowed to select several. With no anchor that survives, every part is shown
 * — failing towards more text, as in `citedIndexes`.
 */
export function selectParts(body: string, quotes: string[], named: string[]): Part[] {
  const parts = splitParts(body);

  const byName = new Set(named);
  let shown = parts.map((p) => p.label !== null && byName.has(p.label));

  if (!shown.some(Boolean)) {
    const locating = quotes.filter(
      (q) => q.length > 20 && parts.filter((p) => p.text.includes(q)).length === 1,
    );
    shown = parts.map((p) => locating.some((q) => p.text.includes(q)));
  }

  return shown.some(Boolean)
    ? parts.map((p, i) => ({ ...p, shown: shown[i]! }))
    : parts.map((p) => ({ ...p, shown: true }));
}

export interface Run {
  shown: boolean;
  /** Joined text of a shown run; empty for a hidden one. */
  text: string;
  /** The part numbers in a hidden run, for naming what was left out. */
  labels: string[];
}

/** Collapse the selection into alternating blocks, so one gap prints one notice. */
export function runs(parts: Part[]): Run[] {
  const out: Run[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.shown === p.shown) {
      last.text = last.shown ? `${last.text}\n\n${p.text}` : '';
      if (p.label !== null) last.labels.push(p.label);
      continue;
    }
    out.push({ shown: p.shown, text: p.shown ? p.text : '', labels: p.label === null ? [] : [p.label] });
  }
  return out;
}

/** `['2','3','4']` → `2–4`; a short gap is listed rather than ranged. */
export function range(labels: string[]): string {
  if (labels.length <= 3) return labels.join(', ');
  return `${labels[0]}–${labels[labels.length - 1]}`;
}
