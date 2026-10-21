-- "Pause new cards on heavy days" (shared/decks/review-load.ts): on a day with more
-- than this many reviews due, the account's daily new-card budget is 0 + 0.
-- NULL = off. Set by the learner (PUT /api/profile/study-budget) or their tutor
-- (PUT /api/relationships/:relId/student-study-budget), recorded in study_budget_set_by.
ALTER TABLE users ADD COLUMN pause_new_when_reviews_over INTEGER;
