-- "New day starts at" (Settings → Study; shared/study/studyDay.ts, docs/STUDY_SESSION.md
-- "When does a new day start"): the hour (0–6, local time) the account's study day turns over
-- at — before it, it is still yesterday (the queue, the new-card budget, the daily reader, the
-- celebration, the streak). NULL = the default, 4 am.
ALTER TABLE users ADD COLUMN day_rollover_hour INTEGER;
