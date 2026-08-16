/**
 * The small subset of Markdown the answer prompt actually produces.
 *
 * Answers arrive with `**bold**`, `-` bullets and numbered lists, and rendering
 * them as literal characters makes a structured legal answer look like a wall
 * of noise. A full Markdown library is not warranted: the generator's output
 * shape is fixed by our own system prompt, so this handles exactly that shape
 * and treats anything else as plain text.
 *
 * Parsing is separated from rendering so it can be tested without a DOM.
 *
 * Deliberately NOT supported: raw HTML, links, images. The text comes from a
 * language model, and every unsupported construct renders as the literal
 * characters the model wrote — visibly wrong rather than silently executed.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string };

export type Block =
  | { kind: 'paragraph'; spans: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] };

/** Split a line into plain and bold runs. */
export function parseInline(line: string): Inline[] {
  const spans: Inline[] = [];
  let rest = line;

  for (;;) {
    const open = rest.indexOf('**');
    if (open === -1) break;
    const close = rest.indexOf('**', open + 2);
    if (close === -1) break;

    if (open > 0) spans.push({ kind: 'text', text: rest.slice(0, open) });
    const inner = rest.slice(open + 2, close);
    // `****` (empty) is not emphasis — keep it literal rather than emitting an
    // empty element.
    if (inner) spans.push({ kind: 'bold', text: inner });
    rest = rest.slice(close + 2);
  }

  if (rest) spans.push({ kind: 'text', text: rest });
  return spans.length > 0 ? spans : [{ kind: 'text', text: '' }];
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/**
 * Group lines into blocks.
 *
 * Consecutive list lines of the same kind merge into one list; a blank line or
 * any other content ends it. Numbered and bulleted runs stay separate, because
 * a numbered list in a legal answer usually enumerates conditions and losing
 * that distinction loses meaning.
 */
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = (): void => {
    if (!list) return;
    blocks.push({
      kind: 'list',
      ordered: list.ordered,
      items: list.items.map(parseInline),
    });
    list = null;
  };

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);

    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)![1]!;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(item);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
