-- Tutor dashboard / onboarding checklist: what the student's device reports
-- during sync, so the tutor can see whether a brand-new student is stuck.
--
-- users.install_kind        'pwa' (display-mode: standalone) | 'android' (Capacitor
--                           shell) | 'browser' | NULL (never reported)
-- users.cached_audio_count  number of audio clips in the device's IndexedDB cache
-- users.last_opened_at      last time the app synced (= last time it was opened online)

ALTER TABLE users ADD COLUMN install_kind TEXT;
ALTER TABLE users ADD COLUMN cached_audio_count INTEGER;
ALTER TABLE users ADD COLUMN last_opened_at TEXT;
