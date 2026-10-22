-- "Forget this card" (shared/scheduler forget events, services/card-forgets.ts; docs/STUDY_SESSION.md
-- "Forget"): the card starts again from NEW at `forgotten_at` and every earlier review stops counting
-- for its schedule. A forget is an EVENT, but kept apart from review_events (whose rating is 0..3) so
-- no review count, streak, stat, insight or old client ever sees it as a review: it is merged into
-- the card's events only to replay its state. id = the client's id (idempotent upload).
-- Undo (right after, on the device that forgot) sets undone_at: the forget stops counting everywhere.
CREATE TABLE IF NOT EXISTS card_forgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  forgotten_at TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_card_forgets_user ON card_forgets(user_id, undone_at);
CREATE INDEX IF NOT EXISTS idx_card_forgets_card ON card_forgets(card_id);
