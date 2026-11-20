# Graded readers & the reader editor

Readers (`graded_readers` + `reader_pages`), the reader editor, word chips, sharing, the reader queue and
page audio. Reading behaviour in study is in docs/STUDY_SESSION.md ("Graded readers").

### Reader page standard
`shared/reader/standard.ts` — `READER_STANDARD`: a page is one picture and one moment, 1–2 sentences
(3 at most, ~15–45 characters), at most one exchange of dialogue, no line breaks; split rather than
pack. The story generator carries it in its prompt and gets ONE repair round when
`readerPageWarnings` flags a page; the reader co-editor chat and the MCP `READER_SPEC_DOC` repeat it;
`POST /api/readers/import`, `PUT /api/readers/:id/spec` and the MCP create / update tools return
`warnings` for pages over it (soft — the reader is still saved). Yardstick: "小明在巴黎".

### Graded readers & reader editor (`worker/src/routes/reader-editor.ts`, mounted at `/api`)
Readers (`graded_readers` + `reader_pages`, per-user) are generated on `story-generation-queue`
(`services/graded-reader.ts`) or written by hand. The **reader editor** (`/readers/:id/edit`,
`frontend/src/pages/editor/ReaderEditorPage.tsx`) is built on the same `EditorShell` as the lesson
editor: title fields + collapsible page cards (Chinese with 🔊 and 拼音 auto-fill via `pinyin-pro`,
pinyin, English with Translate, illustration prompt with Suggest / Illustrate and a thumbnail;
move / duplicate / insert / delete), live `validateReaderSpec` errors blocking Save, a **Preview**
that is the real tap-to-reveal reading view, a **Claude** co-editor chat (same `editor_chats`
tables, target type `reader`; `services/reader-editor.ts` `proposeReaderRevision` with one tool
`propose_reader_spec`, validated with up to 2 repair rounds, fed the `shared/reader/diff.ts`
summary of the author's own edits), exports (Markdown with glossary, Print view at
`/readers/:id/print`, re-importable JSON, Quizlet CSV from `vocabulary_used`; array-driven menu
in `READER_EXPORTS` so Anki can be appended) and raw JSON under Advanced. The whole reader is
saved in one `PUT …/spec`: pages are upserted by id, missing ones deleted, numbers rebuilt,
illustrations kept when the prompt is unchanged (stale R2 keys deleted) and new/changed prompts
queued on `image-generation-queue` like generated readers. The readers list has **Import JSON**.
**Tutor→student sharing** (`worker/src/services/shared-readers.ts`, routes in
`worker/src/routes/shared-readers.ts`, migration 0067 `shared_readers`): modelled on `shareDeck` —
the tutor's reader is copied into the student's account (new reader + page ids; status `ready`,
`is_published` 1, `creator_role` 'tutor') and the row links source and target. Page illustrations
are NOT copied: **both copies reference the same R2 image key**, so every place that deletes reader
images (`DELETE /api/readers/:id`, stale keys on `PUT …/spec`) goes through `unreferencedImageKeys`
and only removes a key no other page references. The student's copy arrives with their normal
`GET /api/readers` sync; there is no tutor UI yet — the MCP `share_reader_with_student` tool is the
interface. A second share makes a second, independent copy.
- `POST /api/relationships/:relId/share-reader` - `{ reader_id }` (caller must be the tutor and own a `ready` reader) → 201 `{ share, reader }` (the student's copy)
- `GET /api/relationships/:relId/shared-readers` - Shares in the relationship (either party) with the student's read status from `reader_review_events`: `page_count`, `read_count`, `last_read_at`, `last_rating`, `target_deleted`
**One reading view** (docs/STUDY_SESSION.md "One reading view everywhere"): the session's reader, homework passes and `/readers/:id` (Readers list / folders) all render web `components/reader/ReaderView.tsx` / Lab `StudyReaderView` — only the top bar and the finish callback differ; a finish anywhere records the reader-review event.
**🎤 Read it aloud** (docs/STUDY_SESSION.md "Read it aloud"): a 🎤 after the page's speed chip records him reading the page (the voice boxes' pipeline, surface `reader_read_aloud`), judges it against the page's Chinese (`shared/reader/readAloud.ts`, Lab `core/ReadAloud.kt`, parity-tested) and marks the page's OWN Chinese in place (web `ReaderWordsText marks`, Lab `MarkedChars`: colour only, the answer diff's tokens — tone off amber, wrong rose, missed grey, a violet ‸ for extra words; no tint / underline; chips step back) with one muted line that says what differs + a tiny legend "≈ 85% — Tone off on 徐" (`readAloudResultLine`, shared/cards/answer-diff.ts) + You said ▸; practice only, `reader.read_aloud`. **A take never touches the reveal** (Jerome says it back from memory): recording / checking / the result leave the page's Chinese hidden or shown as it was; hidden, the marks wait for the tap that reveals it and the difference rows (they print the page) wait behind You said ▸ (web `ReadAloudPanel pageHidden`, Lab `ReadAloudDiffEnv.pageHidden`). While a take records / is checked (`readAloudLocksPage`) the reading view is LOCKED: the footer becomes one big red ■ Stop recording (then "Checking your reading…"), the audio row + ▶ Play whole story are disabled, back / ✕ stop the take instead of leaving (web `ReaderView`, Lab `ReaderTakeLock`); a page read all right (`readAloudAllRight`) throws confetti (`all_right` on the event). Behind **You said ▸** (collapsed — the marked page IS the diff), **what it heard vs the page** (`readAloudDifferences`, Lab `ReadAloud.differences`): one row per page word heard differently — page word + pinyin vs heard + pinyin, the kind in words, ▶ — no reason lines since Nov 2026 (a homophone row is "Sounded right" — not to check); the row's page word / heard word open the language explorer (source `read_aloud`), and a tap on a marked word on the page opens it like any chip; "You said" is marked too (`result.heard`). **Stopped early**: the page after the last character paired with something heard is `unread` (no mark, no row, not scored — the % is over the part read; a middle skip is still missed), the line says "· stopped early", no confetti.
**Page audio in the session** (web `components/ReaderAudioScrubber.tsx`, Lab `ui/readers/ReaderScrubber.kt`):
a waveform split into **phrase blocks** at the pauses (`shared/reader/audioBlocks.ts`: 10 ms RMS envelope of the
clip decoded on the device, adaptive quiet threshold, interior pauses ≥ 350 ms, blocks merged under 0.8 s / split
over 7 s; peaks + blocks cached per clip — IndexedDB `readerAudioBlocks` (Dexie v23), Lab JsonCache). The restart
point follows the audio (`shared/reader/blockPlayback.ts`): it advances to each block as it plays; stop → play
replays the block he was in, or the PREVIOUS one when he stopped within 1 s of crossing into a block; tap a block
to jump, ⏮ / ⏭ to step, drag for a free anchor. No pause found / undecodable → one block, the old scrubber. Both
files are ported to `android-lab/core` (`AudioBlocks.kt`, `BlockPlayback.kt`) and parity-tested
(`android-lab/parity/fixtures/reader-blocks.ts`). **Speed chip** (1× → 0.75× → 0.5×, `shared/reader/speed.ts`, Lab
`core/ReaderSpeed.kt`, parity-tested by `parity/fixtures/reader-speed.ts`): playback only, pitch kept — web
`AudioPlayer.setRate` / `applyPlaybackRate` (`playbackRate` + `preservesPitch`), hybrid bridge v3 `setRate`, Lab
`ReaderPlaybackSpeed` (`PlaybackParams.setSpeed(x).setPitch(1f)`); remembered per device (`services/readerSpeed.ts`,
Lab `ReaderSpeedPref`); the 1 s grace is wall-clock, so `blockGraceMsAt(speed)` scales it to media time. Details: docs/STUDY_SESSION.md.
- `GET /api/readers` (`?include_pages=true` for sync; rows carry `queue_priority` + `queue_position`), `GET|DELETE /api/readers/:id`, `POST /api/readers/generate` (`position?: 'top' | 'bottom'` in the reader queue, default top)
- **The reader queue — "Up next"** (`routes/reader-queue.ts`, `services/reader-queue.ts`, rules `shared/reader/queue.ts`, Lab `ReaderQueue` in `core/…/DailyReader.kt` parity-tested; docs/STUDY_SESSION.md "Graded readers"): the order the session offers unread, ready stories in. `graded_readers.queue_priority` (migration 0140) is NULL until reordered — unplaced stories first, newest first (the old rule, and where a new one lands), then placed ones high → low; a move / reorder writes a priority on every story of the queue. `GET /api/readers/queue` → `{ queue: [{ id, titles, difficulty_level, topic, folder_id, page_count, created_at, queue_priority, queue_position }] }` · `POST /api/readers/:id/move { to: top|up|down|bottom } | { position: n }` → `{ queue, changed, queue_position, queue_total }` (404 not mine, 409 not in the queue) · `PUT /api/readers/reorder { reader_ids }` → `{ queue, changed, ignored }` (those first, the rest after). Readers list → **Up next** (web `components/readers/ReaderUpNext.tsx` + `services/readerQueue.ts`: #N menu, press-and-hold drag, offline — IndexedDB at once + a pending order sent before the next reader sync; Lab `UpNextRow`, the Outbox kind `reader-queue`). Analytics `reader.queue_move`
- `POST /api/readers/:id/retry` - Re-queue a FAILED reader in place (same id; status back to `generating`). The Readers list folds every failed reader into one "N failed generations" row with Retry / Delete / Delete all; raw API errors only appear behind "Show details" (`services/readerFailures.ts`). `ensureDailyReader` asks the server at most once per local date (`daily-reader-attempt` in localStorage) and the daily reader's failed row is reused on retry instead of a new one being created every session. **Read once, one a day** (`shared/study/daily-reader.ts`, Lab `core/…/DailyReader.kt` parity-tested; docs/STUDY_SESSION.md "Graded readers"): a reader with a review event is READ and never offered again (no reader scheduling — old reads open by hand from the Readers list, "✓ Read 3 Oct"); the session offers the first UNREAD story of the reader queue ("Up next", newest first until reordered), nothing more once one was read today, so an unread daily reader keeps being offered; `ensureDailyReader` generates a new story only when no unread story waits and nothing was read today (`shouldGenerateDailyReader`). After the last page: **Finish ✓** (no rating). **Listen-first**: every page's narration of the next unread story is cached on the device as soon as it exists (`cacheReaderNarration` in `prefetchReaderMedia`), and **▶ Play whole story** plays page after page, turning the pages, at the speed chip's speed — listening to the end counts as finishing (`reader.finish { how: 'listened' }`)
- `POST /api/readers` (blank), `PUT /api/readers/:id`, page CRUD + `reorder`, `publish`, `generate-image`, `generate-text` (older per-field routes in index.ts)
- `GET|PUT /api/readers/:id/spec` - The reader as a `ReaderSpec` / replace it whole (`{ spec }`; returns `image_jobs`)
- `POST /api/readers/import` - New reader from `{ spec, folder_id?, position?: 'top' | 'bottom' }` (owner = caller; page ids never reused; `position` = its place in the reader queue, default top)
- `GET /api/readers/:id/export.md|json|csv`
- `POST /api/readers/:id/assist` - `{ field: 'english'|'image_prompt', chinese, english? }` → `{ text }` (503 without an API key)

**Reader word chips** (`shared/reader/words.ts`, `worker/src/services/reader-words.ts`, `routes/reader-words.ts`;
web `components/reader/ReaderWords.tsx` + `services/readerWords.ts`; Lab `core/ReaderWords.kt`,
`ui/readers/ReaderWordSheet.kt`). Every reading view (reader page, in-session reader, homework, Lab Today's story) shows
the revealed Chinese as tappable word chips. Each page carries `words` — `{ text, pinyin, gloss }` segments whose texts
**concatenate to `content_chinese` exactly** (punctuation, quotes and line breaks are segments with empty pinyin / gloss).
Made with Haiku via `structuredCall` (forced `split_words` tool, thinking off); `alignReaderWords` repairs whatever comes
back (unmatched stretches → one character per segment; < 85 % coverage is retried once). Made at story generation (queue
consumer), in the background after an editor save / import / page edit, copied with a shared reader, and lazily:
`POST /api/reader-words/backfill { reader_id?, limit? }` → `{ pages, remaining }` (≤ 12 pages of the caller's, that reader
first) — called when a reader opens and a couple of times per sync until none remain. **Pinyin**: every chip's pinyin goes
through the deterministic pinyin check when it is made (`fixReaderWordsPinyin`: an impossible syllable replaced, 软 never
kuǎn; the 一 / 不 rule over the page; a chip is one word, no spaces inside) and when a shared reader is copied; words stored
before that are checked by the backfill (≤ 200 pages a call, `reader_pages.words_checked`, migration 0148), the corrected pages
returned in its `pages` so both apps replace their cached copies. The explorer checks a chip's pinyin again on the device
(see "Language explorer" → Pinyin per character). Stale words (text edited since) are
never served (`parseReaderWords` / `ReaderWords.matches`). Until words exist the page is plain text. Tapping a chip opens
the language explorer's Word view on the web (docs/LANGUAGE_EXPLORER.md; the old web word sheet is gone) and the
word sheet in the Lab app: hanzi · pinyin · gloss, ▶, the sentence (`sentenceAround`), **More about this word**
(`POST /api/reader-words/explain { word, sentence, pinyin?, gloss? }` → explanation + card-standard `fun_facts` / sentence
clue, Haiku, cached server-side and on the device) and **+ Add as card** (deck picker, duplicate warning). Words already in a
deck get a quieter chip. (Before this, readers called `/api/sentence/analyze` per sentence on reveal — free-text JSON that
failed on pages with quotes / line breaks, all-or-nothing per page, and the in-session reader had no chips at all.)
- `GET|POST /api/editor-chat/reader/:id[/messages]`, `…/messages/:id/accept|reject` - the co-editor chat (see Lesson library & editor)
