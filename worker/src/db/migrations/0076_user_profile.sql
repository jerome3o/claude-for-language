-- Editable profile (PUT /api/profile, POST|DELETE /api/profile/picture).
-- users.name and users.picture_url stay the EFFECTIVE values every screen
-- reads (relationships, chat, invites, dashboard, MCP), so an edit shows up
-- everywhere at once. What Google last said is kept beside them, and the
-- Google sign-in only overwrites name / picture_url while the user has not
-- replaced them (name_custom = 0, picture_source = 'google').
ALTER TABLE users ADD COLUMN google_name TEXT;
ALTER TABLE users ADD COLUMN google_picture_url TEXT;
-- 1 once the user typed their own display name; 0 = follow Google.
ALTER TABLE users ADD COLUMN name_custom INTEGER NOT NULL DEFAULT 0;
-- 'google' (follow Google) | 'upload' (picture_key in R2) | 'none' (removed).
ALTER TABLE users ADD COLUMN picture_source TEXT NOT NULL DEFAULT 'google';
-- R2 key of an uploaded picture (avatars/<user_id>/<id>.jpg), served by GET /api/audio/<key>.
ALTER TABLE users ADD COLUMN picture_key TEXT;
-- Public "About me" shown to the other side of a tutor relationship and on invite links.
ALTER TABLE users ADD COLUMN about TEXT;
-- IANA time zone (e.g. Asia/Shanghai); the other side sees the user's local time.
ALTER TABLE users ADD COLUMN time_zone TEXT;

UPDATE users SET google_name = name, google_picture_url = picture_url;
