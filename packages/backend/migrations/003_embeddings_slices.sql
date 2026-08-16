-- Allow multiple embedding vectors per chunk (one per slice).
--
-- Oversized chunks are split into slices before embedding (see embed/split.ts)
-- because a 67k-token article exceeds every model's input limit. The benchmark
-- scores a chunk by its BEST-matching slice — max-pooling, not mean-pooling —
-- and that is where the measured 91.3% hit@5 comes from.
--
-- The original UNIQUE (article_id, model) forced one row per chunk, which
-- would have meant either discarding slices or averaging them. Averaging
-- changes retrieval behaviour, so the production index would no longer return
-- what the benchmark measured. Storing every slice keeps them identical.

ALTER TABLE embeddings
  ADD COLUMN slice_index integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN embeddings.slice_index IS
  'Slice ordinal within the chunk. 0 for chunks small enough to embed whole.';

-- Replace the chunk-level uniqueness with slice-level.
ALTER TABLE embeddings
  DROP CONSTRAINT IF EXISTS embeddings_article_id_model_key;

ALTER TABLE embeddings
  ADD CONSTRAINT embeddings_article_model_slice_key
  UNIQUE (article_id, model, slice_index);

-- Retrieval always filters by model before ranking; without this the planner
-- scans every model's vectors when more than one is loaded.
CREATE INDEX IF NOT EXISTS embeddings_model_idx ON embeddings (model);
