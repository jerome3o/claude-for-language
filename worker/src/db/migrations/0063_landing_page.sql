-- Which tab the app opens on: 'study' | 'students' | 'decks'.
-- NULL = automatic (Students when the account has active students and no
-- cards due today, otherwise Study). See frontend/src/components/nav/landing.ts.
ALTER TABLE users ADD COLUMN landing_page TEXT;
