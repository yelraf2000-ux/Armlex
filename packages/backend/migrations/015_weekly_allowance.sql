-- The allowance renews WEEKLY, not monthly.
--
-- One definition, called from every query that needs it. The boundary was
-- computed inline in six places; six copies of a date expression is six
-- chances for one of them to drift and start counting a different period than
-- the one the gate enforces.
--
-- Yerevan, not UTC. "From 00:00 Monday" means midnight where the users are —
-- a UTC week would roll over at 04:00 Monday local, which is both wrong and
-- the kind of wrong nobody reports because it merely looks like a bug in
-- their memory of when they last asked something.
--
-- STABLE, not IMMUTABLE: it reads now(). Marking it IMMUTABLE would let the
-- planner fold it to a constant and freeze the week in place.
CREATE FUNCTION armlex_period_start() RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Yerevan') AT TIME ZONE 'Asia/Yerevan'
$$;

-- The ledger keyed on the first day of a MONTH; it now keys on the first
-- instant of a week. Renamed rather than reused under the old name, so no
-- query can quietly keep reading it as a month.
ALTER TABLE usage_ledger RENAME COLUMN month TO period_start;
ALTER TABLE usage_ledger ALTER COLUMN period_start TYPE timestamptz
  USING period_start::timestamptz;

-- Existing rows record spending inside months that are now meaningless as
-- keys, and one of them WOULD have matched: a month that begins on a Monday
-- (2026-06-01, for one) is indistinguishable from a week start, so a stale row
-- would silently consume a live week's allowance. They record deleted
-- conversations from closed periods, so dropping them costs nothing that is
-- still being enforced.
DELETE FROM usage_ledger;
