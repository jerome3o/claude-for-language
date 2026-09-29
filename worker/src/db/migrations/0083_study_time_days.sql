-- Active study time per local day and device (docs/STUDY_SESSION.md "Time").
-- Study has no sessions: each device measures the time the study screen is in front
-- and being used (idle > 75 s, background and screen-off pause it) per local date,
-- and reports its running per-day total with PUT /api/me/study-time. A report only
-- ever raises a row (MAX), so re-sending is harmless; a day's total is the sum over
-- the user's devices. Review time (review_events.time_spent_ms) is unchanged and
-- still what insights / the tutor dashboard / progress read.
CREATE TABLE IF NOT EXISTS study_time_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  device_id TEXT NOT NULL,
  active_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, local_date, device_id)
);
