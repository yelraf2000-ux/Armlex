-- Milestone 2 follow-ups: duplicate ARLIS ids, and excluding individual acts.

-- ---------------------------------------------------------------------------
-- rag_eligible
--
-- ARLIS publishes two kinds of decision/order: normative (-Ն), which state
-- general binding rules, and individual (-Ա), which appoint a person, approve
-- a draft or authorise one shipment. Both are "in force"; only the first can
-- answer a tax question. Individual acts are still *registered* so update
-- detection can see them and so we never refetch them by mistake — they are
-- simply never parsed, embedded, or retrieved.
--
-- Retrieval MUST filter on this flag in addition to status = 'in_force'.
-- ---------------------------------------------------------------------------
ALTER TABLE documents
  ADD COLUMN rag_eligible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN documents.rag_eligible IS
  'False for individual (-Ա) acts: registered for change tracking but never parsed, embedded or retrieved.';

-- The act number the classification is derived from, so the decision is
-- auditable rather than implicit.
ALTER TABLE documents
  ADD COLUMN act_number text,
  ADD COLUMN act_number_suffix char(1)
    CHECK (act_number_suffix IS NULL OR act_number_suffix IN ('Ն', 'Ա'));

-- Partial index: retrieval only ever scans the eligible, in-force subset.
CREATE INDEX documents_retrievable_idx
  ON documents (id)
  WHERE rag_eligible AND status = 'in_force';

-- ---------------------------------------------------------------------------
-- document_aliases
--
-- One logical document can be reachable under several ARLIS act ids: each
-- consolidated revision gets its own id, and search sometimes surfaces a
-- different id than the one the codes list links to. Ingestion resolves any
-- encountered id to the canonical document through this table, so a duplicate
-- can never be indexed twice.
-- ---------------------------------------------------------------------------
CREATE TABLE document_aliases (
  arlis_id    integer PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  -- Why this id is an alias: 'revision' (a consolidated snapshot),
  -- 'duplicate' (a parallel record for the same act), 'renumbered'.
  reason      text NOT NULL DEFAULT 'revision',
  noted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_aliases_document_idx ON document_aliases (document_id);

-- An alias must not collide with a canonical documents.arlis_id. Postgres
-- cannot express this as a cross-table constraint declaratively, so it is
-- enforced by trigger.
CREATE OR REPLACE FUNCTION document_aliases_no_canonical_collision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM documents d
    WHERE d.arlis_id = NEW.arlis_id AND d.id <> NEW.document_id
  ) THEN
    RAISE EXCEPTION
      'arlis_id % is already the canonical id of another document', NEW.arlis_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_aliases_no_canonical_collision_trg
  BEFORE INSERT OR UPDATE ON document_aliases
  FOR EACH ROW EXECUTE FUNCTION document_aliases_no_canonical_collision();

-- Convenience: resolve any ARLIS id (canonical or alias) to one document row.
CREATE OR REPLACE VIEW document_by_any_arlis_id AS
  SELECT d.*, d.arlis_id AS matched_arlis_id, 'canonical'::text AS match_kind
    FROM documents d
  UNION ALL
  SELECT d.*, a.arlis_id AS matched_arlis_id, a.reason AS match_kind
    FROM document_aliases a
    JOIN documents d ON d.id = a.document_id;
