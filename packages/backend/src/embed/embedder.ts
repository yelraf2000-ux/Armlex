/**
 * Embedder interface. Implementations arrive in milestone 5.
 *
 * The audit found the ARLIS tax corpus is Armenian-only, which makes every
 * Russian-language query cross-lingual. Model choice is therefore not a detail:
 * it decides whether retrieval works at all, and it fixes the vector dimension
 * baked into the embeddings table.
 */
import type { Lang } from '@armlex/shared';

export interface EmbeddingModel {
  /** Stable identifier stored in embeddings.model. */
  readonly name: string;
  /** Must match the vector(N) column width. */
  readonly dimensions: number;
}

export interface Embedder extends EmbeddingModel {
  embed(texts: string[], lang: Lang): Promise<number[][]>;
}

export interface ModelSpec extends EmbeddingModel {
  provider: 'openai' | 'gemini' | 'voyage' | 'cohere';
  /** Max input tokens per request. */
  inputLimit: number;
  /** True when the API returns unit-length vectors (cosine == dot product). */
  normalized: boolean;
  /**
   * How the spec was established. Values probed against the live API are
   * trustworthy; 'documented' means taken from vendor docs and NOT verified
   * here, so it must not be relied on for correctness-critical limits.
   */
  verified: 'probed' | 'documented';
  notes?: string;
}

/**
 * Candidate registry. Dimensions and normalization for Gemini and Voyage were
 * probed against the live API on 2026-08-10; see notes for what could not be.
 */
export const KNOWN_MODELS: Record<string, ModelSpec> = {
  // --- probed ---------------------------------------------------------------
  'gemini-embedding-2': {
    name: 'gemini-embedding-2', provider: 'gemini', dimensions: 3072,
    inputLimit: 8192, normalized: true, verified: 'probed',
    notes: 'dimension matches embeddings.vector(3072) — no migration needed',
  },
  'gemini-embedding-001': {
    name: 'gemini-embedding-001', provider: 'gemini', dimensions: 3072,
    inputLimit: 2048, normalized: true, verified: 'probed',
  },
  'voyage-3-large': {
    name: 'voyage-3-large', provider: 'voyage', dimensions: 1024,
    inputLimit: 32000, normalized: true, verified: 'documented',
    notes:
      'dimensions/normalization probed; inputLimit NOT verified — the account ' +
      'is rate-limited to 10K TPM, so an oversized probe returns 429 before a ' +
      'length error. Winning this benchmark requires a schema migration to 1024.',
  },
  'voyage-3.5': {
    name: 'voyage-3.5', provider: 'voyage', dimensions: 1024,
    inputLimit: 32000, normalized: true, verified: 'documented',
  },
  'voyage-multilingual-2': {
    name: 'voyage-multilingual-2', provider: 'voyage', dimensions: 1024,
    inputLimit: 32000, normalized: true, verified: 'documented',
  },

  // --- documented only, no key present -------------------------------------
  'text-embedding-3-large': {
    name: 'text-embedding-3-large', provider: 'openai', dimensions: 3072,
    inputLimit: 8191, normalized: true, verified: 'documented',
  },
  'embed-multilingual-v3.0': {
    name: 'embed-multilingual-v3.0', provider: 'cohere', dimensions: 1024,
    inputLimit: 512, normalized: true, verified: 'documented',
    notes: '512 tokens fits ~300 chars of Armenian — smaller than our metadata header',
  },
};

/** Smallest input limit across candidates we intend to run. */
export function safeSliceCap(models: string[]): number {
  const limits = models
    .map((m) => KNOWN_MODELS[m]?.inputLimit)
    .filter((n): n is number => typeof n === 'number');
  return limits.length ? Math.min(...limits) : 8000;
}

export function getModel(name: string): EmbeddingModel | undefined {
  return KNOWN_MODELS[name];
}

/**
 * Resolve an embedder implementation by model name.
 * Milestone 5 wires the real providers in here.
 */
export function createEmbedder(name: string): Embedder {
  throw new Error(
    `no Embedder implementation yet for "${name}" — wired in milestone 5`,
  );
}
