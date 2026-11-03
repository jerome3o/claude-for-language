-- What a learner's tutor can read of his chats with Claude (docs/CHAT.md "Claude threads" → "What your
-- tutor sees"; shared/claude/visibility.ts): 'card_only' (NULL = the default — the questions asked on a
-- study card, as tutors always saw them), 'all', 'none'. One chat's own choice is
-- coach_conversations.tutor_visible (migration 0144: 1 / 0 wins, NULL = this setting).
ALTER TABLE users ADD COLUMN claude_tutor_visibility TEXT;
