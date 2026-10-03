-- One chat per pair of people (docs/CHAT.md "One chat per pair").
--
-- A tutor relationship used to collect several human-to-human conversations
-- ("New conversation", titles, the invite's "Welcome" chat). From now on it has
-- exactly ONE. This migration merges the extras into it without losing anything:
--
--  * The primary is the conversation with the most recent activity (newest
--    message, else last_message_at, else created_at; ties → the oldest, then the
--    smallest id). It is the chat both people were last using, so the per-device
--    state keyed by its id (drafts, pinyin / translation toggles, listening mode,
--    notification grouping) carries on unchanged; every other id resolves to it.
--  * Every message moves into the primary (UPDATE messages SET conversation_id).
--    Everything hanging off a message — reactions, pins, corrections, words,
--    attachments (the R2 key lives in messages.attachment, media are served by
--    message id), replies, discussions, forwards — moves with it.
--  * Read markers: per person, the furthest one of the group wins (max).
--  * In-app notifications point at the primary.
--  * The merged-away rows stay, marked merged_into = <primary id>, so an old
--    link, push, e-mail or cached id still opens the right chat.
--  * Claude role-play / practice chats (is_ai_conversation, or a relationship
--    with the Claude user) are untouched and may stay many.
--
-- Times are compared with julianday(): older rows use datetime('now')
-- ("YYYY-MM-DD HH:MM:SS"), newer ones ISO ("…T…Z"), which don't sort as strings.

ALTER TABLE conversations ADD COLUMN merged_into TEXT;

-- A conversation in a relationship with the Claude user is a practice chat
-- whatever its flag says (getConversationParticipants already reads it so);
-- say so in the flag, which is what the unique index below can see.
UPDATE conversations
   SET is_ai_conversation = 1
 WHERE COALESCE(is_ai_conversation, 0) = 0
   AND relationship_id IN (SELECT id FROM tutor_relationships WHERE requester_id = 'claude-ai' OR recipient_id = 'claude-ai');

-- old_id → primary_id for every human conversation that is not its relationship's primary.
CREATE TABLE _chat_merge AS
WITH human AS (
  SELECT c.id, c.relationship_id, c.created_at,
         COALESCE(
           (SELECT MAX(julianday(m.created_at)) FROM messages m WHERE m.conversation_id = c.id),
           julianday(c.last_message_at),
           julianday(c.created_at),
           0
         ) AS activity
    FROM conversations c
    JOIN tutor_relationships r ON r.id = c.relationship_id
   WHERE COALESCE(c.is_ai_conversation, 0) = 0
     AND r.requester_id != 'claude-ai' AND r.recipient_id != 'claude-ai'
     AND c.merged_into IS NULL
),
ranked AS (
  SELECT id, relationship_id,
         ROW_NUMBER() OVER (
           PARTITION BY relationship_id
           ORDER BY activity DESC, COALESCE(julianday(created_at), 0) ASC, id ASC
         ) AS rn
    FROM human
)
SELECT o.id AS old_id, p.id AS primary_id
  FROM ranked o
  JOIN ranked p ON p.relationship_id = o.relationship_id AND p.rn = 1
 WHERE o.rn > 1;

-- Messages (and with them reactions, pins, corrections, media, replies, discussions).
UPDATE messages
   SET conversation_id = (SELECT primary_id FROM _chat_merge WHERE old_id = messages.conversation_id)
 WHERE conversation_id IN (SELECT old_id FROM _chat_merge);

-- Read markers: the furthest per person.
INSERT INTO conversation_reads (conversation_id, user_id, last_read_at, updated_at)
SELECT mg.primary_id, cr.user_id, cr.last_read_at, datetime('now')
  FROM conversation_reads cr
  JOIN _chat_merge mg ON mg.old_id = cr.conversation_id
 WHERE 1
ON CONFLICT (conversation_id, user_id) DO UPDATE
   SET last_read_at = excluded.last_read_at, updated_at = excluded.updated_at
 WHERE julianday(excluded.last_read_at) > julianday(conversation_reads.last_read_at);

DELETE FROM conversation_reads WHERE conversation_id IN (SELECT old_id FROM _chat_merge);

-- In-app notifications (unread chat rows are cleared per conversation).
UPDATE notifications
   SET conversation_id = (SELECT primary_id FROM _chat_merge WHERE old_id = notifications.conversation_id)
 WHERE conversation_id IN (SELECT old_id FROM _chat_merge);

-- The primary's last activity covers the whole group.
UPDATE conversations
   SET last_message_at = (
     SELECT m.created_at FROM messages m WHERE m.conversation_id = conversations.id
      ORDER BY julianday(m.created_at) DESC LIMIT 1
   )
 WHERE id IN (SELECT primary_id FROM _chat_merge)
   AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id);

-- Mark the merged-away rows. Their titles stay (history), nothing shows them.
UPDATE conversations
   SET merged_into = (SELECT primary_id FROM _chat_merge WHERE old_id = conversations.id)
 WHERE id IN (SELECT old_id FROM _chat_merge);

DROP TABLE _chat_merge;

-- From now on at most one live human conversation per relationship: a second
-- one can't be created even by two devices racing (get-or-create relies on it).
CREATE UNIQUE INDEX idx_conversations_one_human_per_relationship
  ON conversations(relationship_id)
  WHERE merged_into IS NULL AND COALESCE(is_ai_conversation, 0) = 0;

CREATE INDEX idx_conversations_merged_into ON conversations(merged_into) WHERE merged_into IS NOT NULL;
