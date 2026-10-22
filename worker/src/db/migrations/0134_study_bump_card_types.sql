-- "Practise this word other ways…" (the study card's ⋯ sheet; shared/decks/other-card-types.ts):
-- a CARD-LEVEL bump. study_bumps.card_types = JSON array of the note's card types to put in
-- today's ⚡ pocket (e.g. ["meaning_to_hanzi"]); NULL = the whole note (every bump before this).
-- Only those cards enter the pocket (outside the daily budget, shown first), and the bump is
-- done once each of them has been reviewed since created_at (shared/decks/bumps.ts).
ALTER TABLE study_bumps ADD COLUMN card_types TEXT;
