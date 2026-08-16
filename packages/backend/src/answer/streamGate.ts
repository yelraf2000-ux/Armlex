/**
 * Quote-aware streaming gate.
 *
 * Streaming and verbatim-quote validation pull against each other. Validation
 * needs a complete quote to check; streaming wants to emit every token the
 * moment it arrives. Emitting first and correcting later is not an option
 * here — an unverified Armenian quote would be on the reader's screen, looking
 * exactly like law, and a legal tool cannot show that even briefly.
 *
 * So the gate streams everything EXCEPT the inside of a quotation. When an
 * opening delimiter arrives it starts buffering; when the closing delimiter
 * arrives it checks that one quote and emits either the quote or the removal
 * notice. Prose flows at full speed and only quoted spans are delayed, by the
 * time it takes the model to finish the quote.
 *
 * The rule applied is `isVerbatimQuote` — the same function the batch path
 * uses, deliberately not a second implementation. Two copies of "is this
 * verbatim" would drift, and the one users actually see would be the untested
 * one.
 */
import {
  QUOTE_PATTERNS,
  isCheckableQuote,
  isVerbatimQuote,
  removalNotice,
} from './validateQuotes.js';

export interface GateResult {
  /** Text safe to send to the client now. */
  emit: string;
  /** Quotes rejected so far. */
  invalidCount: number;
}

export class QuoteStreamGate {
  private buffer = '';
  private openDelimiter: { open: string; close: string } | undefined;
  private invalid = 0;
  /** Everything emitted, for persistence and the final result. */
  private full = '';
  /** Text of every rejected quote, kept for diagnosis. */
  private readonly rejectedQuotes: string[] = [];

  constructor(
    private readonly chunkTexts: string[],
    private readonly language: 'hy' | 'ru',
  ) {}

  /** Feed one delta from the model; returns the text safe to forward. */
  feed(delta: string): string {
    let out = '';

    for (const ch of delta) {
      if (this.openDelimiter) {
        if (ch === this.openDelimiter.close) {
          out += this.closeQuote();
          continue;
        }
        this.buffer += ch;
        continue;
      }

      const opener = QUOTE_PATTERNS.find((p) => p.open === ch);
      if (opener) {
        this.openDelimiter = opener;
        this.buffer = '';
        continue;
      }
      out += ch;
    }

    this.full += out;
    return out;
  }

  /**
   * End of stream.
   *
   * An unterminated quote is still pending here — the model stopped mid-quote,
   * or hit the token limit. It gets the same check as a closed one: a quote
   * that was never finished is not verbatim unless it happens to match, and
   * releasing it unchecked would defeat the whole gate.
   */
  flush(): string {
    if (!this.openDelimiter) return '';
    const out = this.closeQuote();
    this.full += out;
    return out;
  }

  get text(): string {
    return this.full;
  }

  get invalidCount(): number {
    return this.invalid;
  }

  /**
   * The quotes that failed, verbatim.
   *
   * A count alone cannot distinguish a fabricated quote (the guard working)
   * from a reformatted one (a bug in the matcher), and those need opposite
   * fixes — both have occurred on this corpus.
   */
  get rejected(): readonly string[] {
    return this.rejectedQuotes;
  }

  private closeQuote(): string {
    const delimiter = this.openDelimiter!;
    const inner = this.buffer;
    this.buffer = '';
    this.openDelimiter = undefined;

    // Not a claim about the law — the model's own prose in quotes, or a short
    // term. Pass it through with its delimiters intact.
    if (!isCheckableQuote(inner)) {
      return `${delimiter.open}${inner}${delimiter.close}`;
    }

    if (isVerbatimQuote(inner, this.chunkTexts)) {
      return `${delimiter.open}${inner}${delimiter.close}`;
    }

    this.invalid++;
    this.rejectedQuotes.push(inner);
    return removalNotice(this.language);
  }
}
