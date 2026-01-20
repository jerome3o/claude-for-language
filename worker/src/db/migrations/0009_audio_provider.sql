-- Add audio_provider column to track which TTS service generated the audio
ALTER TABLE notes ADD COLUMN audio_provider TEXT DEFAULT 'gtts';
