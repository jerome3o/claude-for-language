-- Claude memory (docs/CHAT.md "Claude threads" → "Memory"; the unified-Claude-chats plan §4): the same Claude in
-- every chat, able to remember the learner's earlier chats without reading them all into every prompt.
-- All SQL in worker/src/services/claude-agent/store.ts; the rules in services/claude-agent/memory.ts.
--
-- coach_conversations.summary / summary_upto (migration 0144) = a thread's rolling summary (≤ ~80 words +
-- "Topics: …", written by a cheap background call after a reply when ≥ 2 messages are new since
-- summary_upto, the last message it covers). summary_at = when it was last written (ISO ms) — the
-- learner digest folds in the summaries written after its watermark.
ALTER TABLE coach_conversations ADD COLUMN summary_at TEXT;
CREATE INDEX IF NOT EXISTS idx_cc_summary_at ON coach_conversations(user_id, summary_at);

-- One row per learner: what Claude knows from their earlier chats, read into every chat turn's prompt
-- (the learner block — cached, so it changes at most a few times a day).
--   digest         ≤ ~600 tokens of notes: working on / keeps confusing / interests / level
--   threads_index  JSON [{ id, title, badge, last_at, line }] — the ≤ 20 most recent chats with a one-line summary
--   digest_at      when the digest was last rebuilt (ISO ms; NULL = never)
--   watermark      the newest thread summary_at folded into it
--   input_tokens / output_tokens  every memory model call for this learner so far (summaries + digests)
-- Only the learner's own chats with Claude go in — never the tutor's private profile (student_profiles).
CREATE TABLE IF NOT EXISTS claude_learner_memory (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  digest TEXT NOT NULL DEFAULT '',
  threads_index TEXT NOT NULL DEFAULT '[]',
  digest_at TEXT,
  watermark TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
