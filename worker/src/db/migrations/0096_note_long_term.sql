-- "Add to my long-term review" (docs/HOMEWORK.md §3a, shared/decks/long-term.ts): the learner's
-- per-word choice on THEIR copy of a note, set on the answer side of a homework pass.
--   long_term     NULL = follow the deck (a one-off-only copy, caps 0 + 0, never introduces it),
--                 1 = opted in (introduced even from a 0 + 0 deck), 0 = opted out (never introduced).
--   long_term_at  when it was last set (server time). Kept apart from updated_at so a choice does
--                 not make the student's copy look "edited more recently" than the tutor's source
--                 (copyFieldChanges, newer wins); /api/sync/changes sends notes changed by either.
-- Copies (share / update a student's copy) never carry it: insertNoteCopy lists its columns.
ALTER TABLE notes ADD COLUMN long_term INTEGER;
ALTER TABLE notes ADD COLUMN long_term_at TEXT;
