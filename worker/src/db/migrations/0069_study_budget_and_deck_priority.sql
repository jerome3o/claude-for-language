-- One daily new-card budget per learner (NULL = the shared default, 3 + 6),
-- and a priority order over decks so homework packets queue instead of piling up.
ALTER TABLE users ADD COLUMN new_cards_per_day INTEGER;
ALTER TABLE users ADD COLUMN secondary_cards_per_day INTEGER;
ALTER TABLE decks ADD COLUMN study_priority INTEGER NOT NULL DEFAULT 0;
