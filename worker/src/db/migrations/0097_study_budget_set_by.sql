-- Who last changed the learner's daily new-card budget (users.new_cards_per_day /
-- secondary_cards_per_day), and when: the learner themselves (Settings) or their tutor
-- (PUT /api/relationships/:relId/student-study-budget). The learner's Settings shows
-- "Set by <tutor> · 3 Oct" while the numbers are the tutor's (shared/decks/tutor-budget.ts).
ALTER TABLE users ADD COLUMN study_budget_set_by TEXT;
ALTER TABLE users ADD COLUMN study_budget_set_at TEXT;
