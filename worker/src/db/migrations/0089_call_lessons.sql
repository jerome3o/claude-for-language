-- Lessons (round 4, docs/VIDEO_CALLS.md "Lessons"): the calls between the same two people that
-- follow each other within 20 minutes are ONE lesson (shared/calls/lessons.ts, LESSON_GAP_MS).
-- On 2 Oct 2026 one lesson became four calls and three homework decks. The lesson holds the
-- combined report; the review page, the Past calls list and "Make homework" work per lesson.
CREATE TABLE IF NOT EXISTS call_lessons (
  id TEXT PRIMARY KEY,
  relationship_id TEXT,
  created_by TEXT NOT NULL,
  -- ms since epoch: the first call's start, and when its latest call ended (NULL while one is live)
  started_at INTEGER NOT NULL,
  last_ended_at INTEGER,
  -- none | waiting | summarizing | done | failed — the lesson report over all its calls
  processing_status TEXT NOT NULL DEFAULT 'none',
  processing_error TEXT,
  summary_json TEXT,
  -- the call ids the report was written from (JSON array): a new call in the lesson makes it stale
  report_call_ids TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE calls ADD COLUMN lesson_id TEXT;
CREATE INDEX IF NOT EXISTS idx_calls_lesson ON calls(lesson_id);
CREATE INDEX IF NOT EXISTS idx_call_lessons_scope ON call_lessons(relationship_id, created_by, started_at);

-- Back-fill with the same rule: a call starts a lesson unless an earlier call between the same
-- people ended no more than 20 minutes before it started (or hadn't ended). The lesson's id is
-- its first call's id.
INSERT INTO call_lessons (id, relationship_id, created_by, started_at, last_ended_at, processing_status, summary_json, report_call_ids, created_at)
SELECT c.id, c.relationship_id, c.created_by,
       COALESCE(c.started_at, CAST(strftime('%s', c.created_at) AS INTEGER) * 1000),
       NULL, 'none', NULL, NULL, c.created_at
  FROM calls c
 WHERE NOT EXISTS (
   SELECT 1 FROM calls p
    WHERE p.id <> c.id
      AND ((p.relationship_id IS NOT NULL AND p.relationship_id = c.relationship_id)
           OR (p.relationship_id IS NULL AND c.relationship_id IS NULL AND p.created_by = c.created_by))
      AND (p.created_at < c.created_at OR (p.created_at = c.created_at AND p.id < c.id))
      AND (p.status = 'live'
           OR COALESCE(p.ended_at, COALESCE(p.started_at, CAST(strftime('%s', p.created_at) AS INTEGER) * 1000))
              >= COALESCE(c.started_at, CAST(strftime('%s', c.created_at) AS INTEGER) * 1000) - 1200000)
 );

UPDATE calls SET lesson_id = (
  SELECT l.id FROM call_lessons l
   WHERE ((l.relationship_id IS NOT NULL AND l.relationship_id = calls.relationship_id)
          OR (l.relationship_id IS NULL AND calls.relationship_id IS NULL AND l.created_by = calls.created_by))
     AND l.created_at <= calls.created_at
   ORDER BY l.created_at DESC, l.id DESC
   LIMIT 1
);

UPDATE call_lessons SET last_ended_at = (
  SELECT CASE WHEN SUM(CASE WHEN c.status = 'live' THEN 1 ELSE 0 END) > 0 THEN NULL ELSE MAX(c.ended_at) END
    FROM calls c WHERE c.lesson_id = call_lessons.id
);

-- A one-call lesson keeps the report its call already has; a lesson of several calls gets its
-- combined report the first time it is opened (or "Process now").
UPDATE call_lessons
   SET summary_json = (SELECT c.summary_json FROM calls c WHERE c.lesson_id = call_lessons.id),
       processing_status = COALESCE((SELECT CASE c.processing_status WHEN 'done' THEN 'done' WHEN 'failed' THEN 'failed' ELSE 'none' END FROM calls c WHERE c.lesson_id = call_lessons.id), 'none'),
       report_call_ids = '["' || id || '"]'
 WHERE (SELECT COUNT(*) FROM calls c WHERE c.lesson_id = call_lessons.id) = 1;
