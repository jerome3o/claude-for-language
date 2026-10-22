-- Suspend & snooze (shared/decks/holds.ts, services/card-holds.ts; docs/STUDY_SESSION.md
-- "Suspend & snooze"): a per-account list of cards held out of study. Never a review event,
-- never a change to a card's state — the queue simply leaves held cards out.
--   kind 'suspend' = until unsuspended (until NULL);
--   kind 'snooze'  = until the LOCAL date in `until` ("YYYY-MM-DD", the day the card is back).
-- id = the client's id (idempotent upload). A new hold on a card clears the older active
-- ones (cleared_at); Unsuspend / Wake now clears it too. Active = cleared_at IS NULL (and,
-- for a snooze, its date not passed — the device decides that with its own local date).
CREATE TABLE IF NOT EXISTS card_holds (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('suspend', 'snooze')),
  until TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  cleared_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_card_holds_user ON card_holds(user_id, cleared_at);
CREATE INDEX IF NOT EXISTS idx_card_holds_card ON card_holds(card_id);

-- "Don't show a word's other card types on the same day" (Anki's sibling burying):
-- 1 = on, NULL / 0 = off (the default).
ALTER TABLE users ADD COLUMN bury_siblings INTEGER;
