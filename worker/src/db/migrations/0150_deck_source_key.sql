-- Source decks (shared/decks/source-decks.ts, docs/STUDY_SESSION.md "Source decks"): a card added
-- from around the app ("+ Add as card" in a reader, a chat, the explorer, Claude's create_flashcards…)
-- goes straight into a deck per source — "From readers", "From chats", … — made on first use by the
-- content service (ensureSourceDeck) and found again by this stable key, never by name (he may
-- rename the deck). NULL = an ordinary deck. One deck per user and key.
ALTER TABLE decks ADD COLUMN source_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_decks_user_source_key ON decks (user_id, source_key) WHERE source_key IS NOT NULL;
