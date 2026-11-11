-- Reader word chips: which version of the deterministic pinyin check a page's `words` went
-- through (services/reader-words.ts `fixReaderWordsPinyin`; 1 = impossible syllables replaced,
-- 一 / 不 rule over the page). NULL = words stored before the check existed: the lazy backfill
-- (`POST /api/reader-words/backfill`, which both apps call in every sync) checks them, stores the
-- corrected ones and sends them back to the devices.
ALTER TABLE reader_pages ADD COLUMN words_checked INTEGER;
