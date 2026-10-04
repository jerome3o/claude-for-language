-- "More about 字" on the character sheet (docs/STUDY_SESSION.md "Character sheet"):
-- Haiku's short card-INDEPENDENT explanation of one character, generated once and
-- shared by everyone. The dictionary data itself is static (worker/char-dict/).
-- The old per-card `character_definitions` table is kept but no longer written by the study card.
CREATE TABLE IF NOT EXISTS char_explanations (
  char TEXT PRIMARY KEY,
  explanation TEXT NOT NULL,
  model TEXT,
  dict_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
