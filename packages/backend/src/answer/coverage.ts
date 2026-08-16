/**
 * Coverage self-report — the confidence gate's actual signal.
 *
 * The spec proposed gating on reranker scores. Measured on the golden set,
 * they do not work for this: covered questions average 0.662 (min 0.496) and
 * missed ones average 0.589 (max 0.613), so the distributions overlap almost
 * entirely and the best threshold degenerates to "always confident". The reason
 * is structural rather than a tuning problem — a reranker scores TOPICAL
 * RELEVANCE, and a VAT form is highly relevant to a VAT question while
 * containing none of the rule. Relevance and sufficiency are different
 * questions.
 *
 * The model, unlike the reranker, has actually read the fragments. So it
 * declares coverage on the first line of its response, before writing anything
 * else — deliberately first, so the verdict is available immediately and is not
 * a post-hoc rationalisation of an answer it has already committed to.
 *
 * This parser strips that line from what the reader sees. The declaration is
 * machine plumbing; showing `COVERAGE: partial` to a user would be leaking the
 * implementation.
 */

export type Coverage = 'full' | 'partial' | 'none';

const HEADER = /^\s*COVERAGE:\s*(full|partial|none)\s*$/i;

/**
 * Consumes the leading `COVERAGE:` line from a token stream.
 *
 * Holds text only until the first newline, then passes everything through
 * untouched. If the model does not emit the header — a possibility that must
 * never cost the user their answer — the buffered text is released verbatim and
 * coverage stays null.
 */
export class CoverageParser {
  private buffer = '';
  private settled = false;
  private verdict: Coverage | null = null;
  /**
   * Whether we are still discarding the blank space that follows the header.
   *
   * The newline ending the header and the blank line after it usually arrive in
   * separate deltas, so trimming within a single delta is not enough — the
   * answer would start with stray leading whitespace.
   */
  private trimmingLead = false;

  feed(text: string): string {
    if (this.settled) {
      if (!this.trimmingLead) return text;
      const trimmed = text.replace(/^\s+/, '');
      if (trimmed === '') return '';
      this.trimmingLead = false;
      return trimmed;
    }

    this.buffer += text;
    const newline = this.buffer.indexOf('\n');
    if (newline === -1) {
      // Header lines are short; anything long is clearly not one, so stop
      // withholding rather than buffer an entire answer waiting for a newline.
      if (this.buffer.length < 64) return '';
      this.settled = true;
      const out = this.buffer;
      this.buffer = '';
      return out;
    }

    this.settled = true;
    const first = this.buffer.slice(0, newline);
    const rest = this.buffer.slice(newline + 1);
    this.buffer = '';

    const m = HEADER.exec(first);
    if (!m) return `${first}\n${rest}`; // no header — emit everything, lose nothing

    this.verdict = m[1]!.toLowerCase() as Coverage;
    const body = rest.replace(/^\s+/, '');
    this.trimmingLead = body === '';
    return body;
  }

  /** End of stream: release anything still held. */
  flush(): string {
    if (this.settled) return '';
    this.settled = true;
    const out = this.buffer;
    this.buffer = '';
    // A whole response shorter than one line and matching the header means the
    // model declared coverage and said nothing else; keep the verdict, emit
    // nothing.
    const m = HEADER.exec(out);
    if (m) {
      this.verdict = m[1]!.toLowerCase() as Coverage;
      return '';
    }
    return out;
  }

  get coverage(): Coverage | null {
    return this.verdict;
  }
}
