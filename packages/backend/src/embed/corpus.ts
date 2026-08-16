/**
 * Rebuild the chunk corpus from snapshots, without a database.
 *
 * The benchmark deliberately runs DB-free: the embedding dimension is not
 * decided yet, so nothing should be written to pgvector until it is. Chunking
 * is deterministic, so this reproduces exactly the 885 chunks that were
 * ingested.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, actLatestUrl, isRagEligible } from '@armlex/shared';
import {
  parseActPage,
  parseActBlocks,
  chunkDocument,
  TAX_CORPUS,
  resolveCanonicalId,
} from '@armlex/scraper';
import type { Chunk, DocumentContext } from '@armlex/scraper';

/** A chunk plus the identity used to score it. */
export interface CorpusChunk {
  /** Stable id: "<arlisId>#<ref>" — matches the ingested (document, ref) pair. */
  id: string;
  arlisId: number;
  ref: string;
  kind: string;
  text: string;
  charCount: number;
}

export async function loadCorpusFromSnapshots(): Promise<CorpusChunk[]> {
  const out: CorpusChunk[] = [];

  for (const entry of TAX_CORPUS) {
    if (entry.control) continue;
    const canonicalId = resolveCanonicalId(entry.id);
    if (canonicalId !== entry.id) continue; // alias: already covered

    let html: string;
    try {
      html = await readFile(
        join(config.snapshotDir, `act-${entry.id}-hy-latest.html`),
        'utf8',
      );
    } catch {
      continue;
    }

    const page = parseActPage(html);
    if (!isRagEligible(page.actNumber)) continue;

    const doc: DocumentContext = {
      arlisId: canonicalId,
      title: page.title,
      docType: entry.expect,
      status: 'in_force',
      sourceUrl: actLatestUrl(canonicalId),
      ...(page.actNumber ? { actNumber: page.actNumber.raw } : {}),
      ...(page.adoptedAt ? { adoptedAt: page.adoptedAt } : {}),
    };

    const { chunks } = chunkDocument(page, parseActBlocks(html), doc);
    for (const c of chunks) out.push(toCorpusChunk(canonicalId, c));
  }

  return out;
}

function toCorpusChunk(arlisId: number, c: Chunk): CorpusChunk {
  return {
    id: `${arlisId}#${c.ref}`,
    arlisId,
    ref: c.ref,
    kind: c.kind,
    text: c.full,
    charCount: c.charCount,
  };
}
