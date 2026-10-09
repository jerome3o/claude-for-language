-- Unlockable mini lessons (docs/STUDY_SESSION.md "Unlockable lessons", shared/lesson/unlock.ts):
-- a lesson can wait, locked, until an audio lesson has been listened to or the learner has done
-- something real. Offline-first: the devices unlock at once and upload the time; the earliest wins.
--   unlock_kind    'audio_lesson' | 'manual' | NULL (no condition)
--   unlock_ref     the audio_lessons.id for 'audio_lesson'
--   unlock_prompt  what to do for 'manual' ("Watch episode 3 of …")
--   unlocked_at    when it was unlocked (NULL = still locked); unlocked_via auto | manual | player
--   companion_of   the audio lesson this lesson was written for ("companion mini lesson"), whatever unlocks it
ALTER TABLE custom_lessons ADD COLUMN unlock_kind TEXT;
ALTER TABLE custom_lessons ADD COLUMN unlock_ref TEXT;
ALTER TABLE custom_lessons ADD COLUMN unlock_prompt TEXT;
ALTER TABLE custom_lessons ADD COLUMN unlocked_at TEXT;
ALTER TABLE custom_lessons ADD COLUMN unlocked_via TEXT;
ALTER TABLE custom_lessons ADD COLUMN companion_of TEXT;
CREATE INDEX IF NOT EXISTS idx_custom_lessons_companion ON custom_lessons(user_id, companion_of) WHERE companion_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_custom_lessons_unlock_ref ON custom_lessons(user_id, unlock_ref) WHERE unlock_ref IS NOT NULL;

-- Audio lessons: when a listen first reached the end (≥ 85 % or the last chapter, any device),
-- and the companion mini lesson being written on audio-lesson-queue.
--   companion_status   'generating' | 'failed' | NULL (none asked for, or made: see custom_lessons.companion_of)
--   companion_request  JSON { unlock: 'audio' | 'manual', prompt? } of the request being worked on
ALTER TABLE audio_lessons ADD COLUMN listened_at TEXT;
ALTER TABLE audio_lessons ADD COLUMN companion_status TEXT;
ALTER TABLE audio_lessons ADD COLUMN companion_error TEXT;
ALTER TABLE audio_lessons ADD COLUMN companion_started_at TEXT;
ALTER TABLE audio_lessons ADD COLUMN companion_request TEXT;
