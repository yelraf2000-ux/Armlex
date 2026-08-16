/**
 * Renders the parsed answer. Parsing lives in `markdown.ts` and is tested there.
 *
 * Everything is rendered as text nodes — React escapes them — so a model that
 * emits HTML gets literal angle brackets on screen rather than markup in the
 * page.
 */
import type { Block, Inline } from './markdown.js';
import { parseBlocks } from './markdown.js';

function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.kind === 'bold' ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'paragraph') {
    return <p><Spans spans={block.spans} /></p>;
  }
  const items = block.items.map((spans, i) => (
    <li key={i}><Spans spans={spans} /></li>
  ));
  return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
}

export function MarkdownView({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md">
      {blocks.map((b, i) => <BlockView key={i} block={b} />)}
    </div>
  );
}
