# Anki export — PR screenshots

Captured on the dev server with Playwright at the phone viewport (412×915, 2×) with seeded data
(no TTS keys in the container, so the deck's word audio is absent; sentence-clue, lesson and
reader clips were injected into the IndexedDB audio cache to exercise the media path — 4 of 6,
9 of 10 and 2 of 3 clips respectively, so each result shows a "missing" count).

## Deck

![Deck Settings with the new Export to Anki button](01-deck-settings-export.png)

Deck → Settings: the export lives at the bottom of the settings sheet, above Advanced Settings.

![Export options for a deck](02-deck-export-options.png)

Export options: include audio (on by default) and include review progress (off by default, with the one-line caveat).

![Deck export finished](03-deck-export-done.png)

Result: `HSK-1-Greetings.apkg` — 6 notes, 12 cards (no word audio, so no Audio → Hanzi cards), 4 sentence clips, 2 missing.

## Lesson library / editor

![Library card menu before the fix — dropdown clipped by the card](04a-library-card-menu-before.png)

Before: the library card's ⋯ dropdown was clipped by the card's `overflow: hidden` (pre-existing; the menu was unreachable on a phone).

![Library card menu after the fix, with Export Anki](04-library-card-menu.png)

After: the dropdown shows fully, with **Export Anki (.apkg)** after the CSV entry.

![Lesson export finished](06-lesson-export-done.png)

Lesson result: 10 notes (6 words + 4 sentences), 20 cards, 9 of 10 clips bundled.

![Lesson editor overflow menu with Export Anki](07-lesson-editor-menu.png)

Lesson editor ⋯ menu: **Export Anki (.apkg)** next to Markdown / Print / JSON / CSV.

## Readers

![Readers list card with an Anki button](08-readers-list.png)

Reader card: an **Anki** button next to Read / Edit.

![Reader export finished](09-reader-export-done.png)

Reader result: `Readers-xiao-mao-de-yi-tian.apkg` (Chinese titles are transliterated for the file name) — 3 pages → 3 Sentence notes, 2 of 3 narration clips.

![Reader page header with an Anki button](10-reader-page.png)

Reader page header: the same button beside Edit.

## The generated files, re-opened

![The three .apkg files opened with sql.js + JSZip](11-apkg-inspected.png)

Anki itself can't run here, so the three downloaded `.apkg` files were re-opened with the same libraries: `collection.anki2` models (fields, templates, `req`), every note with its GUID / fields / `[sound:…]` reference, one pill per card row, and the `media` index with file sizes.
