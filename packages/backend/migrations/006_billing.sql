-- Subscriptions.
--
-- Payment runs through a Merchant of Record (Lemon Squeezy): they are the legal
-- seller, they collect and remit VAT, and they pay out. So nothing here stores
-- a card, a bank account, or a billing address — this database holds only which
-- plan an account is on and enough of the provider's ids to reconcile with it.
--
-- `users.plan` already existed and already drives the monthly allowance. These
-- columns say WHY it has the value it has, which is what makes a failed renewal
-- or a cancellation something the system can act on rather than guess at.

ALTER TABLE users ADD COLUMN subscription_id text UNIQUE;

-- The provider's own status string, stored verbatim rather than mapped to a
-- boolean. "active", "past_due", "cancelled", "expired" and "on_trial" call for
-- four different behaviours, and collapsing them to `is_paying` throws away the
-- distinction on the way in.
ALTER TABLE users ADD COLUMN subscription_status text;

-- When the current period ends. A cancelled subscription keeps its plan until
-- this passes: someone who paid through the end of the month has paid through
-- the end of the month.
ALTER TABLE users ADD COLUMN plan_expires_at timestamptz;

CREATE INDEX users_subscription_idx ON users (subscription_id)
  WHERE subscription_id IS NOT NULL;

-- Every webhook the provider sends, kept.
--
-- Two reasons. Webhooks arrive more than once by design — the provider retries
-- until it gets a 2xx — so an event id is how "already handled" is answered
-- without guessing. And when a customer says they paid and the account says
-- otherwise, this table is the only place the truth is recorded on our side.
CREATE TABLE billing_events (
  id           text PRIMARY KEY,
  event_name   text NOT NULL,
  user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_events_user_idx ON billing_events (user_id, received_at DESC);
