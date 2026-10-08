-- Ask Claude 🎧 Listen first (docs/STUDY_SESSION.md "Ask Claude"; shared/study/askClaude.ts):
-- Claude's Chinese answers arrive as the chat's hidden listening bubble — tap plays, hold reveals.
-- users.ask_claude_listening: 1 = on, NULL / 0 = off (the default). The sheet's 🎧 and Settings.
ALTER TABLE users ADD COLUMN ask_claude_listening INTEGER;
