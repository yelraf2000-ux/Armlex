-- A token on each invitation, so the link in the email identifies WHICH
-- invitation was accepted.
--
-- Until now an invitation was matched by address at registration: the invitee
-- filled the whole signup form and `claimInvitation` found the row afterwards.
-- That works, but it asks a person for a name and a company their colleague
-- already typed, and it silently earns nobody anything if they register with a
-- different address than the one invited.
--
-- With a token the link carries the identity, so the invitee is asked only for
-- a password.

-- Hashed, never stored in the clear. The token admits its holder to an account
-- at a known address inside somebody's firm — a bearer credential, exactly like
-- the email-verification token, and stored the same way for the same reason.
ALTER TABLE invitations ADD COLUMN token_hash text UNIQUE;

-- NULL for every invitation that predates this migration. Those emails have
-- already gone out with no link in them, and inventing a token now would not
-- put it in a message already delivered. They keep working through the old
-- path: register normally, and `claimInvitation` matches on the address.
CREATE INDEX invitations_token ON invitations (token_hash) WHERE token_hash IS NOT NULL;
