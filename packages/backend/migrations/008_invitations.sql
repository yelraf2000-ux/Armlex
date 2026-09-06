-- Invitations, and the bonus questions they earn.
--
-- Two awards, and they are deliberately paid at different moments:
--
--   +10  once, for completing the invitation step with at least one invite
--   +5   per invitation, WHEN THAT PERSON ACTUALLY REGISTERS
--
-- Paying the per-invite bonus on SEND would be free money: four throwaway
-- addresses would mint 20 questions, and every one of those costs real API
-- credit. Paying it on registration means the reward tracks the thing the
-- referral is actually for. The +10 is safe to pay immediately because it is
-- capped at once per account.

ALTER TABLE users ADD COLUMN bonus_questions int NOT NULL DEFAULT 0;

CREATE TABLE invitations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email             text NOT NULL,
  name              text,
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Set when someone registers with this address. Both columns move together;
  -- the pair is what stops an invitation paying its bonus twice.
  accepted_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  accepted_at       timestamptz,

  -- One invitation per address per inviter. Re-inviting the same person is not
  -- a second reward, and without this the cap is four invitations at a time
  -- rather than four people.
  UNIQUE (inviter_id, email)
);

-- The lookup done on every registration: is this address already invited?
CREATE INDEX invitations_email_idx ON invitations (email) WHERE accepted_user_id IS NULL;
CREATE INDEX invitations_inviter_idx ON invitations (inviter_id, created_at DESC);
