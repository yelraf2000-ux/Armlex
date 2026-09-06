-- Who is signing up, and how big is their firm.
--
-- Asked at registration because it is the one moment a person will answer it.
-- Company size is not curiosity: it maps a signup directly onto a pricing tier
-- (Team 2-9 / Firm 10-24 / Enterprise 25+), so the sales list can be sorted by
-- it without a single conversation, and it tells us whether the B2B thesis is
-- meeting reality or whether every signup is a sole practitioner.
--
-- Stored as the bucket the person picked, not as a number they estimated.
-- "10-30" is an honest answer; "17" would be a fabricated precision, and a
-- range is what someone can actually pick without thinking.

ALTER TABLE users ADD COLUMN company_name text;
ALTER TABLE users ADD COLUMN company_size text
  CHECK (company_size IS NULL OR company_size IN ('1-5', '5-10', '10-30', '30+'));

-- What every account said, newest first — the segment mix at a glance.
CREATE INDEX users_company_size_idx ON users (company_size, created_at DESC)
  WHERE company_size IS NOT NULL;
