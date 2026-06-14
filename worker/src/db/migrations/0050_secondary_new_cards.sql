-- Secondary new cards: a daily quota for NEW cards whose note already has at
-- least one reviewed card (e.g. meaning_to_hanzi after hanzi_to_meaning is in
-- circulation). Additive to new_cards_per_day, so skill-broadening cards keep
-- flowing even when unseen notes arrive faster than the primary new-card limit.
ALTER TABLE decks ADD COLUMN secondary_cards_per_day INTEGER DEFAULT 10;
