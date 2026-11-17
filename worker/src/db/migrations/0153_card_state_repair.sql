-- The server's cached card state = the replay of the card's review events (+ live forgets)
-- (worker/src/services/card-state.ts). Per user: which repair version replayed every card
-- (NULL = never: done on the next server queue read), where an unfinished run stopped (card id),
-- when it last finished / was last re-checked (daily, from /api/sync/changes), and how many rows
-- the last run had to rewrite (0 = the cache already matched the events).
ALTER TABLE users ADD COLUMN card_state_version INTEGER;
ALTER TABLE users ADD COLUMN card_state_cursor TEXT;
ALTER TABLE users ADD COLUMN card_state_repaired_at TEXT;
ALTER TABLE users ADD COLUMN card_state_checked_at TEXT;
ALTER TABLE users ADD COLUMN card_state_last_fixed INTEGER;
