/**
 * Retrieval chunks and their metadata header.
 *
 * Codes and laws divide into articles; decisions and orders divide into
 * numbered points plus annexes. Both produce the SAME chunk shape with the SAME
 * header format, so indexing, reranking and citation rendering never branch on
 * document type.
 *
 * The header is prepended to the embedded text on purpose: a chunk retrieved in
 * isolation must still say which law it came from, which provision it is, and
 * whether it is current. Without that, a correct passage can still produce a
 * wrongly-attributed answer.
 */
import type { DocStatus } from '@armlex/shared';

export type ChunkKind = 'article' | 'point' | 'annex_table' | 'annex_text';

/** Document-level facts, constant across all chunks of one document. */
export interface DocumentContext {
  arlisId: number;
  title: string;
  actNumber?: string;
  docType: string;
  status: DocStatus;
  adoptedAt?: string;
  lastAmendedAt?: string;
  sourceUrl: string;
}

export interface Chunk {
  documentArlisId: number;
  kind: ChunkKind;
  /** Ordinal within the document, document order. */
  ord: number;
  /** Human reference, e.g. "Հոդված 5" or "կետ 3" or "Հավելված 2". */
  ref: string;
  articleNumber?: string;
  pointNumber?: string;
  /** մաս (part) number, when an oversized article was split. */
  partNumber?: string;
  annexLabel?: string;
  title?: string;
  /** Structural ancestry, outermost first. */
  path: string[];
  /** Body text without the header. */
  text: string;
  /** Header + text — this is what gets embedded and stored. */
  full: string;
  charCount: number;
  /** Number of markdown tables carried inside this chunk. */
  tableCount: number;
}

/**
 * Build the metadata header. Identical layout for every chunk kind so that a
 * downstream consumer can parse one format.
 */
export function formatChunkHeader(
  doc: DocumentContext,
  parts: {
    ref: string;
    title?: string;
    path?: string[];
  },
): string {
  const location = [...(parts.path ?? []), parts.ref].filter(Boolean).join(' › ');

  const dates = [
    doc.adoptedAt ? `adopted ${doc.adoptedAt}` : undefined,
    doc.lastAmendedAt ? `amended ${doc.lastAmendedAt}` : undefined,
  ]
    .filter(Boolean)
    .join(' | ');

  const lines = [
    `[Document] ${doc.title}${doc.actNumber ? ` (${doc.actNumber})` : ''}`,
    `[Type] ${doc.docType} | [Status] ${doc.status}`,
    `[Location] ${location}`,
    ...(parts.title ? [`[Title] ${parts.title}`] : []),
    ...(dates ? [`[Dates] ${dates}`] : []),
    `[Source] ${doc.sourceUrl}`,
    '---',
  ];

  return lines.join('\n');
}

export function makeChunk(
  doc: DocumentContext,
  input: {
    kind: ChunkKind;
    ord: number;
    ref: string;
    title?: string;
    path: string[];
    text: string;
    articleNumber?: string;
    pointNumber?: string;
    partNumber?: string;
    annexLabel?: string;
    tableCount?: number;
  },
): Chunk {
  const header = formatChunkHeader(doc, {
    ref: input.ref,
    ...(input.title ? { title: input.title } : {}),
    path: input.path,
  });
  const full = `${header}\n${input.text}`;

  return {
    documentArlisId: doc.arlisId,
    kind: input.kind,
    ord: input.ord,
    ref: input.ref,
    path: input.path,
    text: input.text,
    full,
    charCount: full.length,
    tableCount: input.tableCount ?? 0,
    ...(input.title ? { title: input.title } : {}),
    ...(input.articleNumber ? { articleNumber: input.articleNumber } : {}),
    ...(input.pointNumber ? { pointNumber: input.pointNumber } : {}),
    ...(input.partNumber ? { partNumber: input.partNumber } : {}),
    ...(input.annexLabel ? { annexLabel: input.annexLabel } : {}),
  };
}
