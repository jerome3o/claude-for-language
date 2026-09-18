-- Student onboarding around the invite link.
--
-- invites.welcome_message: an optional note from the inviter that becomes the
--   first chat message in the auto-created conversation when the invite is
--   redeemed, and is shown on the invitee's first-open screen.
-- invites.opened_at: when the /join link was first opened (the public lookup),
--   so the tutor can tell "link opened, not signed in" from "never opened".

ALTER TABLE invites ADD COLUMN welcome_message TEXT;
ALTER TABLE invites ADD COLUMN opened_at TEXT;
