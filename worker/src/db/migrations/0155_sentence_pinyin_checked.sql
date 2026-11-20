-- The deterministic pinyin check on example sentences (worker/src/services/sentence-pinyin.ts):
-- the version of the check a note_sentences row's pinyin + cached breakdown went through.
-- NULL = written before it (Nov 2026; e.g. 这些破烂东西可以扔掉。 "… zhuāngdiào" — 扔 is only rēng):
-- the hourly cron and the per-user pass before GET /api/sentences/changes check those rows, correct
-- only what is impossible, bump the note's rows so devices pull the fix, and stamp the version.
ALTER TABLE note_sentences ADD COLUMN pinyin_checked INTEGER;

CREATE INDEX IF NOT EXISTS idx_note_sentences_pinyin_checked ON note_sentences(pinyin_checked);
