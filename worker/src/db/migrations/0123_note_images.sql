-- Pictures on cards (shared/cards/note-image.ts, services/note-images.ts; docs/STUDY_SESSION.md
-- "Pictures on cards"): one optional picture per note.
--   notes.image_key     the R2 key (note-images/<hash>.png generated, note-uploads/<note>-<id>.jpg uploaded),
--                       served by GET /api/audio/<key>; NULL = no picture
--   notes.image_source  'generated' | 'upload'
--   notes.image_status  NULL | 'pending' (being drawn) | 'failed' (the generator gave up)
--   notes.image_hash    the generated picture this note asked for (note_images.prompt_hash): when it is
--                       drawn, every note waiting for that hash gets it (a tutor's note and its copies)
--   notes.image_at      when any picture field last changed; /api/sync/changes also returns notes by it
--                       (like word_tags_at), so updated_at — which the tutor → student copy rules
--                       compare — is never touched by a picture
ALTER TABLE notes ADD COLUMN image_key TEXT;
ALTER TABLE notes ADD COLUMN image_source TEXT;
ALTER TABLE notes ADD COLUMN image_status TEXT;
ALTER TABLE notes ADD COLUMN image_hash TEXT;
ALTER TABLE notes ADD COLUMN image_at TEXT;
CREATE INDEX IF NOT EXISTS idx_notes_image_hash ON notes(image_hash);

-- One generated picture per prompt (no user ids: the prompt is built from the word's meaning,
-- so the same word asked by two accounts shares one picture, like lesson_images).
CREATE TABLE IF NOT EXISTS note_images (
  prompt_hash TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | ready | failed
  image_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "Illustrate new cards" per deck (off by default: each picture costs money).
ALTER TABLE decks ADD COLUMN illustrate_new INTEGER NOT NULL DEFAULT 0;
