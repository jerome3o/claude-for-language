-- "Needs your ear": a background check of every pronunciation recording (review_events.recording_url),
-- made by services/recording-checks.ts on recording-check-queue: what a transcriber heard (and whether it
-- matches the card, shared/recordings/transcript.ts) and Azure Pronunciation Assessment's score with a
-- score per character (shared/recordings/queue.ts CharScore[]). The tutor's review queue
-- (GET /api/relationships/:relId/recordings/queue) reads it; nothing here is shown to the student.
CREATE TABLE IF NOT EXISTS recording_checks (
  review_event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- pending | scoring (an Azure call in flight) | done | failed
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  transcript TEXT,
  transcript_provider TEXT,
  -- 1 match, 0 mismatch, NULL = no transcript
  transcript_match INTEGER,
  -- Azure accuracy 0-100 (NULL = not scored; score_note says why)
  score REAL,
  fluency REAL,
  completeness REAL,
  char_scores TEXT,
  score_note TEXT,
  -- audio seconds sent to Azure (the monthly free-tier budget) and when
  audio_ms INTEGER,
  scored_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (review_event_id) REFERENCES review_events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recording_checks_user ON recording_checks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_recording_checks_scored ON recording_checks(scored_at);
