-- Audio lessons, take two (docs/AUDIO_LESSONS.md): an agent writes a listening lesson
-- (format 'dialogue' = English host + a Chinese dialogue, 'sleep' = all-Chinese slow
-- immersion), every line is spoken by the TTS providers and the whole lesson is
-- rendered to ONE MP3 in R2 (audio-lessons/<user>/…) with chapter markers.
--
-- The table from migration 0046 (the first, removed attempt) is reused: its rows have
-- format NULL and are never listed. Only columns are added; nothing is dropped.
ALTER TABLE audio_lessons ADD COLUMN format TEXT;                 -- 'dialogue' | 'sleep'
ALTER TABLE audio_lessons ADD COLUMN input_json TEXT;             -- { description?, dialogue?, text?, target_minutes? }
ALTER TABLE audio_lessons ADD COLUMN progress TEXT;               -- one human line for the list / player
ALTER TABLE audio_lessons ADD COLUMN progress_done INTEGER;       -- clips made
ALTER TABLE audio_lessons ADD COLUMN progress_total INTEGER;      -- clips needed
ALTER TABLE audio_lessons ADD COLUMN agent_transcript TEXT;       -- the authoring agent's messages (checkpoint)
ALTER TABLE audio_lessons ADD COLUMN rounds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audio_lessons ADD COLUMN plan_json TEXT;              -- what Claude wrote (DialoguePlan | SleepPlan)
ALTER TABLE audio_lessons ADD COLUMN script_json TEXT;            -- the compiled AudioLessonScript
ALTER TABLE audio_lessons ADD COLUMN timeline_json TEXT;          -- { chapters, transcript } in ms of the rendered file
ALTER TABLE audio_lessons ADD COLUMN words_json TEXT;             -- LessonWord[]
ALTER TABLE audio_lessons ADD COLUMN duration_ms INTEGER;
ALTER TABLE audio_lessons ADD COLUMN size_bytes INTEGER;
ALTER TABLE audio_lessons ADD COLUMN usage_json TEXT;             -- tokens, TTS characters, providers, estimated cost
ALTER TABLE audio_lessons ADD COLUMN zh_provider TEXT;            -- the provider pinned for the Chinese voices of this lesson
ALTER TABLE audio_lessons ADD COLUMN for_relationship_id TEXT;    -- a tutor's label only: nothing is sent to a student
ALTER TABLE audio_lessons ADD COLUMN started_at TEXT;
ALTER TABLE audio_lessons ADD COLUMN finished_at TEXT;
ALTER TABLE audio_lessons ADD COLUMN updated_at TEXT;
