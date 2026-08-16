-- ArmLex initial schema (milestone 1).
-- Mirrors the schema sketch in CLAUDE.md, with adjustments noted inline.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE doc_type AS ENUM (
  'code', 'law', 'gov_decision', 'ministerial_order', 'src_clarification'
);

CREATE TYPE doc_status AS ENUM ('in_force', 'repealed', 'suspended', 'unknown');

CREATE TYPE lang AS ENUM ('hy', 'ru', 'en');

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
  id              bigserial PRIMARY KEY,
  arlis_id        integer NOT NULL UNIQUE,
  doc_type        doc_type NOT NULL,

  title_hy        text NOT NULL,
  title_ru        text,
  title_en        text,

  status          doc_status NOT NULL DEFAULT 'unknown',

  adopted_at      date,
  effective_at    date,
  repealed_at     date,

  arlis_url       text NOT NULL,
  last_checked_at timestamptz,

  content_hash_hy text,
  content_hash_ru text,
  content_hash_en text,

  -- Per-language amendment dates. Translations lag the Armenian original, so
  -- these are compared before any translated text is trusted for retrieval.
  hy_amended_at   date,
  ru_amended_at   date,
  en_amended_at   date,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_status_idx ON documents (status);
CREATE INDEX documents_doc_type_idx ON documents (doc_type);

-- ---------------------------------------------------------------------------
-- articles  (retrieval chunk = one article, or one article-part when huge)
-- ---------------------------------------------------------------------------
CREATE TABLE articles (
  id               bigserial PRIMARY KEY,
  document_id      bigint NOT NULL REFERENCES documents (id) ON DELETE CASCADE,

  -- Text, not integer: ARLIS uses numbers like "160.1" for inserted articles.
  article_number   text NOT NULL,
  part_number      integer,

  -- Structural ancestry, captured from the letterspaced ARLIS headings
  -- (Մ Ա Ս / Բ Ա Ժ Ի Ն / Գ Լ ՈՒ Խ). Useful for display and for filtering.
  part_title       text,
  section_title    text,
  chapter_title    text,

  title            text,
  text_hy          text,
  text_ru          text,
  text_en          text,

  status           doc_status NOT NULL DEFAULT 'in_force',
  effective_from   date,
  effective_to     date,

  -- Ordinal position within the document, so we can render/neighbour reliably
  -- even when article numbers are non-monotonic.
  ord              integer NOT NULL,

  arlis_anchor_url text,

  -- Full-text search vectors. Armenian has no Postgres dictionary, so it uses
  -- 'simple' (acceptable for v1 per spec); Russian uses the russian config.
  tsv_hy tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(text_hy, ''))) STORED,
  tsv_ru tsvector GENERATED ALWAYS AS (to_tsvector('russian', coalesce(text_ru, ''))) STORED,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (document_id, article_number, part_number)
);

CREATE INDEX articles_document_idx ON articles (document_id);
CREATE INDEX articles_status_idx ON articles (status);
CREATE INDEX articles_tsv_hy_idx ON articles USING gin (tsv_hy);
CREATE INDEX articles_tsv_ru_idx ON articles USING gin (tsv_ru);
-- Trigram index supports fuzzy article-number lookups on the fast path.
CREATE INDEX articles_number_trgm_idx ON articles USING gin (article_number gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- article_refs  (parsed cross-references)
-- ---------------------------------------------------------------------------
CREATE TABLE article_refs (
  from_article_id bigint NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  to_article_id   bigint NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  PRIMARY KEY (from_article_id, to_article_id)
);

CREATE INDEX article_refs_to_idx ON article_refs (to_article_id);

-- ---------------------------------------------------------------------------
-- embeddings
-- ---------------------------------------------------------------------------
CREATE TABLE embeddings (
  id         bigserial PRIMARY KEY,
  article_id bigint NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  lang_used  lang NOT NULL,
  model      text NOT NULL,
  vector     vector(3072) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, model)
);

-- pgvector's HNSW/IVFFlat indexes cap out at 2000 dimensions for `vector`, but
-- `halfvec` supports up to 4096. text-embedding-3-large is 3072, so the index
-- is built over a halfvec cast. Queries must use the same expression to hit it:
--   ORDER BY vector::halfvec(3072) <=> $1::halfvec(3072)
CREATE INDEX embeddings_vector_hnsw_idx
  ON embeddings
  USING hnsw ((vector::halfvec(3072)) halfvec_cosine_ops);

-- ---------------------------------------------------------------------------
-- chat sessions
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  fact_summary text
);

CREATE TABLE messages (
  id         bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_session_idx ON messages (session_id, created_at);

CREATE TABLE session_chunks (
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  article_id bigint NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  score      real NOT NULL,
  turn_added integer NOT NULL,
  PRIMARY KEY (session_id, article_id)
);

-- ---------------------------------------------------------------------------
-- evaluation + crawl bookkeeping
-- ---------------------------------------------------------------------------
CREATE TABLE eval_questions (
  id                   bigserial PRIMARY KEY,
  question             text NOT NULL,
  expected_article_ids bigint[] NOT NULL DEFAULT '{}',
  lang                 lang NOT NULL,
  notes                text
);

CREATE TABLE crawl_log (
  id           bigserial PRIMARY KEY,
  run_at       timestamptz NOT NULL DEFAULT now(),
  new_docs     integer NOT NULL DEFAULT 0,
  changed_docs integer NOT NULL DEFAULT 0,
  errors       jsonb NOT NULL DEFAULT '[]'::jsonb
);
