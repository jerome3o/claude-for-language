-- Claude threads (docs/CHAT.md "Claude threads"; the unified-Claude-chats plan, PR 2): the Sentence
-- Coach's tables become THE store of every conversation with Claude. `coach_*` is the storage name
-- only; all thread SQL lives in worker/src/services/claude-agent/store.ts. Old endpoints
-- (/api/coach/*, coach_conversations.action / kind) are unchanged.
--
-- Thread (coach_conversations):
--   context_kind  where the chat happens: general | card | practice | chat_message (NULL = general,
--                 a Coach / Ask chat from before this migration — set below)
--   context_ref   the context's canonical ref: the note id (card), the chat message id
--                 (chat_message), the old conversation id (practice)
--   context_json  the descriptor + a snapshot for badges without a fetch (hanzi, scenario, …) —
--                 shared/claude/context.ts. Never another person's user id.
--   client_id     an app-made id (offline create; POST is idempotent by it)
--   last_message_at / preview / unread   the inbox row (ISO ms / ≤ 120 chars / replies not seen yet)
--   changed_at    ISO ms of the last change of the row or a message (GET ?since= cursor)
--   summary / summary_upto   the rolling summary (memory, a later PR)
--   language      the thread's answer language zh | en (NULL = the account's Ask Claude language)
--   tutor_visible NULL = the account's default (card questions visible, as today); 0 / 1 = per thread
--   read_only     1 = no reply path yet (practice chats copied from the old tutor-chat tables)
--   archived_at / deleted_at   archived; deleted (a tombstone: messages removed, text cleared)
--   source        coach | ask | app | note_questions | practice | discussion — where it came from
--   legacy_id     the copied row's id (note_questions id of the first question, conversation id,
--                 message_discussions id) — the backfill's idempotency key
ALTER TABLE coach_conversations ADD COLUMN context_kind TEXT;
ALTER TABLE coach_conversations ADD COLUMN context_ref TEXT;
ALTER TABLE coach_conversations ADD COLUMN context_json TEXT;
ALTER TABLE coach_conversations ADD COLUMN client_id TEXT;
ALTER TABLE coach_conversations ADD COLUMN last_message_at TEXT;
ALTER TABLE coach_conversations ADD COLUMN preview TEXT;
ALTER TABLE coach_conversations ADD COLUMN unread INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coach_conversations ADD COLUMN changed_at TEXT;
ALTER TABLE coach_conversations ADD COLUMN summary TEXT;
ALTER TABLE coach_conversations ADD COLUMN summary_upto TEXT;
ALTER TABLE coach_conversations ADD COLUMN language TEXT;
ALTER TABLE coach_conversations ADD COLUMN tutor_visible INTEGER;
ALTER TABLE coach_conversations ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coach_conversations ADD COLUMN archived_at TEXT;
ALTER TABLE coach_conversations ADD COLUMN deleted_at TEXT;
ALTER TABLE coach_conversations ADD COLUMN source TEXT;
ALTER TABLE coach_conversations ADD COLUMN legacy_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_client ON coach_conversations(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_legacy ON coach_conversations(user_id, source, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cc_inbox ON coach_conversations(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_context ON coach_conversations(user_id, context_kind, context_ref);
CREATE INDEX IF NOT EXISTS idx_cc_changed ON coach_conversations(user_id, changed_at);

-- Message (coach_messages):
--   client_id    an app-made id (POST …/messages is idempotent by it)
--   intent       of a learner's message: ask | check | explain | translate (NULL = from before)
--   auto_check   the learner's Chinese checked (shared/chats/autoCheck.ts; the old question_check)
--   meta         JSON { first_token_ms, total_ms, rounds, inline } of a reply
--   lease_until  ISO ms: the runner writing this reply holds it until then (a watchdog resumes an
--                expired one — services/claude-agent/thread-turn.ts). A reply being written stays
--                status 'pending' (older apps show "Thinking…"); its `content` is the text so far.
--   updated_at   ISO ms of the last write (GET …/threads/:id?since= cursor; NULL = before this)
--   legacy_id    the copied row's id (note_questions id — the user AND the assistant row of one Q&A)
ALTER TABLE coach_messages ADD COLUMN client_id TEXT;
ALTER TABLE coach_messages ADD COLUMN intent TEXT;
ALTER TABLE coach_messages ADD COLUMN auto_check TEXT;
ALTER TABLE coach_messages ADD COLUMN meta TEXT;
ALTER TABLE coach_messages ADD COLUMN lease_until TEXT;
ALTER TABLE coach_messages ADD COLUMN updated_at TEXT;
ALTER TABLE coach_messages ADD COLUMN legacy_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_client ON coach_messages(conversation_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_legacy ON coach_messages(conversation_id, role, legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cm_updated ON coach_messages(conversation_id, updated_at);

-- Every existing Coach / Ask chat is a `general` thread.
UPDATE coach_conversations
   SET context_kind = 'general',
       source = CASE WHEN kind = 'ask' OR action = 'ask' THEN 'ask' ELSE 'coach' END,
       last_message_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at),
       changed_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
 WHERE context_kind IS NULL;

-- The lazy per-user copy of the older Claude chats (note_questions, practice chats, Discuss with
-- Claude) into threads: when it last ran (NULL = never; services/claude-agent/backfill.ts).
ALTER TABLE users ADD COLUMN claude_threads_backfilled_at TEXT;
