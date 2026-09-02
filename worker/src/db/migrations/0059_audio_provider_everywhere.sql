-- Migration: record which TTS provider produced every stored clip
--
-- notes.audio_provider already exists for a note's own word audio, but the
-- clue sentence and the sentence-set rows never recorded theirs. That made the
-- Google-fallback clips (half the bitrate, time-stretched slow speech — the
-- "crunchy" audio) impossible to find without opening every file. NULL means
-- the clip predates this column; a classification pass fills those in from the
-- MP3 header.
ALTER TABLE notes ADD COLUMN sentence_clue_audio_provider TEXT;
ALTER TABLE note_sentences ADD COLUMN audio_provider TEXT;
