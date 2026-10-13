-- Homework e-mails (docs/HOMEWORK.md §12): "<Tutor> sent you homework" after a
-- send (bursts within ~2 minutes merged into one e-mail) and "Due tomorrow" the
-- evening before a one-off due date, in the student's own time zone.
--
-- users.email_homework: 1 (default) = both e-mails, 0 = off (Settings, or the
-- e-mail's own sign-in-free "Turn off homework emails" link). Chat e-mails are a
-- separate switch (email_chat_messages).
ALTER TABLE users ADD COLUMN email_homework INTEGER NOT NULL DEFAULT 1;

-- When the "sent you homework" e-mail took this assignment (NULL = not yet).
-- Claimed with one UPDATE … RETURNING so two deliveries never e-mail twice.
-- Everything assigned before this migration counts as told already.
ALTER TABLE assignments ADD COLUMN notified_at TEXT;
UPDATE assignments SET notified_at = created_at WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assignments_notify ON assignments(notified_at, created_at);

-- One row per homework e-mail. A reminder's key is the due date, so the
-- UNIQUE index makes "one reminder per student per day" an INSERT OR IGNORE;
-- an "assigned" e-mail's key is the row id. assignment_ids = the JSON list it covered.
CREATE TABLE IF NOT EXISTS homework_email_log (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('assigned', 'reminder')),
  key TEXT NOT NULL,
  assignment_ids TEXT,
  status TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_homework_email_log_key ON homework_email_log(student_id, kind, key);
