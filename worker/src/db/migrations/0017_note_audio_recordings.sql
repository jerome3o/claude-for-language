-- Migration: Add note_audio_recordings table for multiple audio per note
-- This enables storing multiple audio recordings (TTS, user, tutor) per note

CREATE TABLE note_audio_recordings (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  provider TEXT DEFAULT 'gtts',
  is_primary INTEGER DEFAULT 0,
  speaker_name TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX idx_note_audio_note_id ON note_audio_recordings(note_id);

-- Migrate existing audio_url data into the new table
INSERT INTO note_audio_recordings (id, note_id, audio_url, provider, is_primary, speaker_name)
SELECT
  'nar-' || id,
  id,
  audio_url,
  COALESCE(audio_provider, 'gtts'),
  1,
  'AI Generated'
FROM notes
WHERE audio_url IS NOT NULL;
