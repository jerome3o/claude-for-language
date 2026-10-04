-- Admin audio settings (docs/AUDIO.md "Providers"): provider order for stored clips and
-- live playback, voices per provider, enabled + max RPM. ONE row (id = 1); JSON per
-- shared/tts/config.ts. No row = the defaults (MiniMax only for stored clips).
CREATE TABLE IF NOT EXISTS tts_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);
