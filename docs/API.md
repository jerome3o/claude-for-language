# Feature & API reference (the rest)

Endpoints and code maps for features without a doc of their own. Features with their own doc keep their
API there (see the index in CLAUDE.md, "Where to find things").

### Deck Management
- Create/edit/delete decks
- Add notes manually or via AI generation
- **Paste a list** (deck page → 📋 Paste list, `components/import/PasteWordsModal.tsx`): add or
  update many notes from pasted text. `shared/import/parse.ts` detects row/column separators
  (tab → | → comma → "–"/":" → script-boundary split for `苹果 píngguǒ apple`), votes a role per
  column (hanzi / pinyin / english / sentence / notes), strips bullets and a header row, converts
  tone numbers to marks; `shared/import/plan.ts` matches rows to existing notes by normalised
  hanzi (policy: update / skip / duplicate; pasted blanks never blank a field) and lists the
  field changes. Missing pinyin comes from `pinyin-pro` on the device, missing English from
  `POST /api/ai/gloss-words` (Haiku, one call, ≤100 words); filled values are marked ✨ until
  edited. A second, prominent step — **"N words have no explanation or example sentence yet
  → ✨ Write them with Claude"** — calls `POST /api/ai/enrich-words` (Sonnet, `CARD_STANDARD`
  in the prompt, ≤30 words per call, the client chunks 15 at a time; `services/enrich-words.ts`,
  `mergeEnrichment` unit-tested) to write `fun_facts` and `sentence_clue` (+ pinyin /
  translation) for rows whose card, or existing note, has none; a sentence that breaks a HARD
  rule or lacks the word is dropped. A pasted or edited sentence gets on-device pinyin.
  Rows show the sentence and an "explanation written" flag; the row editor has an
  explanation textarea; the done screen reminds the tutor when words were saved bare. Saving is one `createNote` / `updateNote` per row (3 in flight, per-row failures
  reported) so TTS and sentence sets are generated as usual. The done screen lists a tutor's
  student copies (`GET /api/decks/:id/student-shares`) with "Update their copy".
- Each note has: hanzi, pinyin (with tone marks), English, optional fun facts
- Each note auto-generates 3 cards (one per card type)
- **Play audio** button on each note in deck view
- **Generate audio** button if TTS is missing (🔊+)

### Note History
Each note has a **History** button showing:
- **Review history** by card type with:
  - Date/time of each review
  - Rating given (color-coded)
  - Time spent
  - User's typed answer
  - Audio recording (if recorded)
- **Current card stats**: stability, difficulty, lapses, interval
- **Questions asked** to Claude with answers

### Decks
- `GET /api/decks` - List all decks
- `POST /api/decks` - Create deck
- `POST /api/decks/source` - `{ key }` → `{ deck, created }`: get-or-create the learner's source deck ("From readers", …; docs/STUDY_SESSION.md "Source decks"). The note-create routes also take `source:<key>` in place of `:deckId` (the reply carries `deck`)
- `GET /api/decks/:id` - Get deck with notes
- `PUT /api/decks/:id` - Update deck name / description
- `PUT /api/decks/:id/settings` - Any subset of the deck settings (validated; 400 with `problems`) — per-deck caps on the global new-card budget
- `POST /api/decks/:id/move` - `{ to: 'top' | 'bottom' }` move a deck in the study queue (`study_priority`)
- `PUT /api/decks/reorder` - `{ deck_ids }` the whole queue, first = studied first
- `GET /api/me/chats` - The Chats tab inbox (`?exclude_ai=1`, both apps' Chats tab: without the old Claude practice chats already copied into the Claude threads as `pc-<id>`): every conversation of my active relationships (Claude role-play chats flagged `is_ai`) with the other person, last message preview, my unread count, `last_activity_at`, newest first — one query (`getChatList`, `services/chat/reads.ts`; rules in `shared/chats/inbox.ts`, docs/CHAT.md "Chats tab")
- `PUT /api/profile/email-prefs` - `{ email_chat_messages: boolean }` chat e-mails on / off (on `/api/auth/me`); every chat e-mail also carries a sign-in-free "Turn off chat emails" link + RFC 8058 `List-Unsubscribe` headers → `GET|POST /api/email/unsubscribe?t=`, `POST /api/email/resubscribe?t=` (HMAC token, `services/email-unsubscribe.ts`, `routes/email-prefs.ts`; docs/CHAT.md "E-mail opt-out")
- `PUT /api/profile/chat-prefs` - `{ chat_auto_check: boolean | null }` "Check my Chinese automatically" (Settings → Chat; on `/api/auth/me`); the check itself runs in the background after a send / edit (`services/chat/auto-check.ts`), its result rides on the sender's message as `auto_check` → the ✎ on the bubble and "✨ How to say it better" first in the message menu (docs/CHAT.md "Auto-check")
- `PUT /api/profile/study-budget` - `{ new_cards_per_day?, secondary_cards_per_day? }` the account's global daily new-card budget (0–200, `null` = default; 400 with `problems`) → `StudyBudgetInfo`; current values on `/api/auth/me` and `/api/sync/changes` (`study_budget`)
- `PUT /api/profile/day-rollover` - `{ day_rollover_hour: 0–6 | null }` (null = the default, 4 am; 400 + `problems`) → `{ day_rollover_hour, is_default }`; on `/api/auth/me` and `/api/sync/changes` as `day_rollover_hour` (docs/STUDY_SESSION.md "When does a new day start")
- `PUT /api/profile/sentence-style` - `{ sentence_style: 'standard' | 'everyday' | 'casual' | null }` (null = the default, everyday; 400 + `problems`) → `{ sentence_style, is_default }`; on `/api/auth/me` and `/api/sync/changes` as `sentence_style`. New example sentences only (docs/STUDY_SESSION.md "Example sentence style")
- `PUT /api/profile/new-card-order` - `{ new_characters_first?, new_words_first?, most_common_first?, sentences_last?, known_characters_english_first?, everyday_first?, new_words_by_ear? }` (true / false, null = that default) or `{ reset: true }` → `NewCardOrderInfo` (400 + `problems`); on `/api/auth/me` and `/api/sync/changes` as `new_card_order`
- `GET|PUT /api/relationships/:relId/student-study-budget` - tutor only: the student's budget (+ `top_deck` for the hint) / set it `{ new_cards_per_day?, secondary_cards_per_day? }` (null = default) → `{ budget, changed, message_sent }`; posts a chat message from the tutor
- `GET|PUT /api/profile` - The editable profile (`routes/profile.ts`, `services/profile.ts`, validation `shared/profile`): `{ name?, bio?, about?, time_zone? }` (400 + `problems`; `name: null` = back to the Google name) → `{ name, picture_url, picture_source: google|upload|none, name_custom, google_name, google_picture_url, bio, about, time_zone }`
- `POST /api/profile/picture` (raw image or multipart `picture`; JPEG/PNG/WebP sniffed from the bytes, ≤ 2 MB; the clients crop to a square and send ~512px JPEG) · `DELETE /api/profile/picture?use=google|none`
- `DELETE /api/decks/:id` - Delete deck (tombstones for every device; audio clean-up in the background)

### Folders (`worker/src/routes/folders.ts`, `services/folders.ts`, `shared/folders`)
Per user, organisation only (the deck queue / `study_priority` is the same with or without folders). Web:
`components/folders/` (`FolderGroups` + `useFolderUi`: the folder TREE — folders inside folders up to 5 levels, each level its own
drag list (`FolderLevel`) — collapsible per folder with Unfiled last, ⋯ Rename / New folder inside (above level 5) / Move folder… /
Delete, press-and-hold a folder header to reorder among its siblings, the move sheets as an indented tree with a "Now in …" breadcrumb, "＋ Folder", "☑ Select" → Move N to folder…,
`MoveToFolderSheet`) on More → Decks (deck #N menu → 📁 Move to folder…; dragging a deck inside a folder splices the
group's new order into the whole queue, `spliceGroupOrder`), the Library (⋯ → Move to folder…, Find a lesson filter)
and the Readers list (📁 button, Find a story filter); a filter shows a flat list. The folder list is in IndexedDB
(`db.folders`, Dexie v26), replaced whole by every sync (`folders` on `/api/sync/changes`; full sync →
`GET /api/folders`); decks carry `folder_id` (a deck move re-dates the deck so it syncs); collapsed groups per device
in localStorage (`folders-collapsed-v1:<kind>`). Lab: same rules (`core/…/Folders.kt`, parity-tested).
- `GET /api/folders?kind=deck|lesson|reader` → `{ folders: [{ …, item_count }] }` (no kind = all)
- `POST /api/folders` `{ kind, name, parent_id?, id? }` → 201 `{ folder }` (200 when the client id exists; 400 + `problems`)
- `PATCH /api/folders/:id` `{ name?, parent_id? }` · `DELETE /api/folders/:id` → `{ deleted, unfiled, lifted }`
- `PUT /api/folders/reorder` `{ kind, folder_ids }` · `POST /api/folders/move` `{ kind, ids, folder_id | null }` → `{ moved, not_found, folder_id }`
- Create paths take `folder_id` (400 when it isn't the caller's folder of that kind): `POST /api/decks`, `POST /api/lesson-library` (+ `/import`; duplicate keeps the folder), `POST /api/readers/import`, `POST /api/readers/generate`

### Notes
- `GET /api/notes/:id` - Get note with cards
- `POST /api/decks/:deckId/notes` - Create note (`hanzi`, `pinyin`, `english`, `fun_facts?`, `context?`, `sentence_clue?` + pinyin / translation, `alternatives?`); cards made, word + sentence TTS in the background, sentence set queued
- `POST /api/decks/:deckId/notes/batch` - `{ notes: [...] }` (≤500) → `{ created, failed: [{ index, hanzi, error }] }`; audio queued; `?skip_existing=1` leaves out words already in any of my decks → `existing: [{ index, hanzi, note_id, deck_name }]`
- `PUT /api/notes/:id` - Update note (a changed hanzi gets a new word clip, a changed clue a new sentence clip)
- `POST /api/notes/:id/check-issues/:issueId/apply` | `/dismiss` - a word check's "⚠ Possible issue" → `{ note }` (apply = the fix through updateNote)
- `POST /api/notes/check` - `{ note_ids }` (≤ 100) run the word check now and store it → `{ issues: { [noteId]: NoteCheckIssue[] } }`
- `GET /api/notes/word-tags/backfill` - AI word tags progress of my notes → `{ total, tagged, untagged, outdated, input_tokens, output_tokens, cost_usd, queued_this_hour, per_hour }`; `POST` `{ limit? }` (default 200, ≤ 1000) queues that many untagged notes now → `{ queued, …progress }` (503 without a model; the sync does this by itself, ≤ 200 an hour)
- `POST /api/ai/check-words` - `{ words: [{ hanzi, pinyin, english }] }` (≤ 60) → `{ issues: [{ index, field, kind, current, proposed, reason }] }`, nothing stored (Paste a list's preview)
- `GET|POST /api/decks/:id/check` - per-deck "Check for errors": `{ estimate, job }` / start → 202 `{ job }`; `GET|POST /api/relationships/:relId/shared-decks/:id/check` the same on the student's copy (tutor; `can_fix_source`); `GET /api/deck-checks/:jobId`; `POST /api/deck-checks/:jobId/apply` `{ proposal_ids, also_source? }` → `{ applied, source_applied, failed, job }`
- `PUT /api/profile/card-check` - `{ card_check: boolean | null }` "Check new words for mistakes"
- `POST /api/me/pinyin-scan` - `{ apply?: boolean, kinds?: ['lesson','library','reader'] }` → `{ scanned, items: [{ kind, id, title, owner?, fixes, warnings, status? }], fix_count, warning_count, applied, report }` (warnings = "needs a look", never written) — impossible pinyin in my stored lessons (+ copies I assigned), library lessons, readers; dry run unless `apply` (see "Pinyin check")
- `PUT /api/notes/:id/long-term` - `{ long_term: true | false | null }` the learner's "Add to my long-term review" choice (idempotent; `long_term_at`, not `updated_at`)
- `DELETE /api/notes/:id` - Delete note (tombstone; clips removed only if no copy references them)
- `POST /api/notes/move` - `{ note_ids, deck_id }` move notes between your decks, cards and history kept
- `GET /api/notes/:id/image` · `POST /api/notes/:id/image/generate` `{ regenerate? }` (202 while drawn on image-generation-queue; 503 without an image generator) · `PUT /api/notes/:id/image` (raw JPEG / PNG / WebP ≤ 3 MB, or multipart `picture`) · `DELETE /api/notes/:id/image` → `{ note: { image_key, image_source, image_status } }` — pictures on cards (`routes/note-images.ts`, `services/note-images.ts`; placement + prompt + estimate in `shared/cards/note-image.ts`)
- `GET|POST|PUT /api/decks/:id/illustrate` - "🖼 Illustrate this deck": status + estimate (`{ total, with_image, pending, failed, missing, estimate, illustrate_new, available }`) / draw every card without a picture (≤ 500) / `{ illustrate_new }` switch
- `GET /api/notes/:id/history` - Get review history and card stats
- `POST /api/notes/:id/ask` - Ask Claude about a note (`{ question, context?, conversationHistory?, language?: zh|en, quick?, listening? }` → the Q&A with `answer_lang`, `question_check`, `question_check_pending`, `answer_clip_ready`, tool results; `routes/ask-claude.ts`)
- `PUT /api/profile/ask-claude-listening` - `{ ask_claude_listening: boolean }` Ask Claude 🎧 Listen first (on `/api/auth/me`)
- `GET /api/note-questions/:id` - one Q&A shaped (word chips, translations, the question's check) · `POST /api/note-questions/:id/words|translate` `{ part: answer|question }` → `{ words, cached }` / `{ translation, cached }` (made on request, cached on the row; `/words` is legacy — both apps now make Ask Claude's word chips on the device with `shared/chinese/segment.ts` and no longer call it) · `PUT /api/profile/ask-claude-language` `{ ask_claude_language: zh|en|null }`
- `GET /api/notes/:id/questions` - LEGACY (older builds): the note's Q&As, served from its card threads (`noteQuestionRows`)
- `GET /api/notes/search?q=&limit=` - Server-side search of my notes (hanzi / pinyin, tone-free too / english / card sentence) with `deck_name` + `total_notes` — the Decks tab search is local-first (`services/noteSearch.ts` `noteMatches`, cards + recent ratings loaded only for the notes on screen) and falls back to this when the device finds nothing, saying how many of the account's cards the device holds (`routes/note-search.ts`)
- `POST /api/notes/:id/generate-audio` - Generate TTS audio for note
- `POST /api/notes/:id/ensure-audio` - `{ broken?: string[] }` → `{ note, word, sentence }` (ok | copied | generated | queued | failed | none). Idempotent: makes only the MISSING word / sentence clips (a reported 404 key only if R2 really lacks it; a student's copy first takes the tutor's clip), at interactive priority; `queued` = MiniMax is busy, the clip is on tts-queue and coming. Both apps' auto-audio: web `services/noteAudioEnsure.ts` (study card; "Audio coming…" instead of the device voice), Lab `data/audio/NoteAudioFixer.kt` (on the card, queued offline, background pass over the upcoming queue after sync); `content.ensureNoteClips`

### Cards & Study
- `GET /api/cards/due` - Today's study queue in session order (optional `?deck_id=`, `include_new=false` = reviews due only; services/study-queue.ts)
- `GET /api/me/study-queue?deck_id=&per_deck=1&limit=N` - `{ day_key, due_today, reviews_due, new_today, counts: { new, extra_new, learning, review }, new_cards_paused, decks?, cards? }` — the shared queue on the server (`routes/study-queue.ts`)
- `PUT /api/me/study-time` - `{ device_id, days: [{ date, active_ms }] }` this device's running active study time per local day (rows only go up) → `{ days: [{ date, active_ms, device_ms }] }` over every device; `GET /api/me/study-time?from=&device_id=` the same totals
- `POST /api/study/sessions` - Start study session (kept for older clients; best-effort, nothing reads it for time)
- `POST /api/study/sessions/:id/reviews` - Record a review
- `PUT /api/study/sessions/:id/complete` - Complete session

### Audio
- `POST /api/audio/upload` - Upload user recording
- `GET /api/audio/*` - Get audio file from R2
- `GET /api/audio-manifest` - All audio URLs the user owns (note audio, sentence clues, sentence sets, recordings) for offline prefetch

### AI
- `POST /api/ocr/words` - ＋ Add tab: a photo (raw JPEG / PNG / WebP or multipart `picture`, ≤ 4 MB; 413 / 415) → `{ lines: [{ text, box: [ymin, xmin, ymax, xmax] 0–1000 | null, main }], ms }` — the Chinese lines, most prominent first (ONE Gemini Flash vision call, ≈ $0.001; never stored; cost guard `ai`; E2E stand-in; `routes/add-words.ts`, docs/ADD_TAB.md)
- `POST /api/ai/english-words` - `{ text }` (English or pinyin, ≤ 120) → `{ words: [{ hanzi, pinyin, english, note? }] }` up to 4 (the ＋ Add tab's say / type it in English)
- `POST /api/custom-lessons/generate` - `{ prompt }` → 202 `{ request }` (🎯 Mini lesson from the ＋ Add tab, written in the background into my Mini Lessons; cost guard `jobs`) · `GET /api/custom-lessons/requests/:id` → `{ request: { status: generating|ready|failed, lesson_id, error } }`
- `POST /api/ai/generate-deck` - Generate deck from prompt
- `POST /api/ai/suggest-cards` - Get card suggestions
- `POST /api/sentence/analyze` - Break a sentence into aligned chunks
- `POST /api/sentence/coach` - Correct/critique a learner-written sentence
- `POST /api/sentence/explain` - Thoroughly explain a Chinese sentence

### Stats
- `GET /api/stats/overview` - Overall statistics (`due_today` = `cards_due_today`, `reviews_due`, `new_cards_paused`)
- `GET /api/stats/deck/:id` - Deck statistics (`cards_due` = the deck's session today, `reviews_due`, `cards_mastered` = Review + stability > 21 d, `cards_learning` = seen, not mastered)

**Characters & words known** (Progress page, `shared/progress/known.ts`, Lab port `core/…/Known.kt`,
parity-tested): computed on the device from notes + cards + review events, so it works offline. A
card is *known* when its replayed state is mature (Review, stability > 21 days — the deck page's
"mastered"); a note takes its best card; a note is a **word** with 1–4 Han characters and no sentence
punctuation (else a sentence), counted once per spelling; a **character** is known when it appears
in any known note. The history chart replays every card with `computeCardTimeline`
(`shared/scheduler`) — ~1 s of FSRS for 35k events, so the web runs it in a Web Worker
(`services/knownProgress.worker.ts`) and shows the last result from localStorage meanwhile. The
chart toggles **Total | Per week** (remembered per device: web localStorage `known-chart-mode-v1`, Lab
`KnownChartModePref`; analytics `progress.known_mode`): Per week = `shared/progress/known-rate.ts` (Lab
`core/…/KnownRate.kt`, parity-tested in the same `known` fixture) — the NET change of the known count per
Monday-to-Monday local week (negative when cards lapse; the current week partial), drawn as weekly bars in two
panels on one scale, and the pace of the last 4 weeks vs the 4 before (`knownProgressWithRate`: one replay
for both views). **By reading vs by ear** (`words_by_skill` on `knownProgress`, Lab `KnownProgress.wordsBySkill`, parity-tested
in the `known` vectors): the known words (same maturity rule, once per spelling) whose own hanzi_to_meaning card is known
vs whose audio_to_hanzi card is known (cards carry `card_type`) — "1,240 by reading · 610 by ear" under the tiles (web
`WordSkillsRow` in `components/progress/KnownCounts.tsx`, Lab `WordSkillsRow` in `ui/progress/KnownCard.kt`) with
`earLagHint` while the ear lags far behind (≥ 20 by reading, under 60 % by ear). The
tutor's `GET /api/relationships/:relId/student-progress/daily` carries `known` (same grouping via
`knownCountsFromTiers`, from the server's cached card state — `services/known-counts.ts`). No HSK
list is in the repo, so there is no HSK coverage yet.

### Quests (tile-map mini-games, page at `/quests`, play at `/quests/:id`)
A quest is a small top-down grid world with a character the learner drives with on-screen
arrows, a pick-up/put-down button and contextual verb buttons. Each goal is an **imperative
Chinese instruction** (拿起…, 打开…, 把…放在…上, 先…然后…) that the learner carries out in
the world; the engine checks it against a declarative condition, so the instruction is
verified by doing, not by answering. Reached from the profile menu — not part of study/SRS.

**It is a framework, not a set of canned levels.** Claude authors the whole world — terrain,
objects, the emoji that represent them, the verbs each object accepts, the state machines
(open/closed, clean/dirty), what is hidden inside what, and the goals with their conditions.
- `shared/quest/types.ts` — the world schema, including the condition language
  (`holding`, `object_on`, `object_state`, `object_removed`, `performed`, `player_at`,
  `all_of` / `any_of` / `sequence`)
- `shared/quest/engine.ts` — pure engine: movement/blocking, reach, carrying, verb
  availability, hidden-object reveal, sequence progress, goal completion
- `shared/quest/validate.ts` — playability checks (grid shape, dangling references,
  unreachable objects via flood fill, states nothing can produce)
- `worker/src/services/quest.ts` — generation prompt + tool schema; a world that fails
  validation is fed its own error list back for up to two repair rounds, and is only stored
  if it passes

Generation runs on `quest-generation-queue`, **not** `waitUntil` — a world is one long
Claude call plus up to two repair rounds, which outlives a waitUntil context (the isolate is
torn down mid-call and the row is left stuck in `generating`). Clients poll; the `progress`
column carries a breadcrumb of the stage reached, and a swept-stale row reports it.
Any new queue must also be added to the "Ensure Queues Exist" step in `deploy.yml`. Queues: `coach-reply-queue` (Sentence Coach replies, docs/CHAT.md "Chat ↔ Coach"; also the Claude thread watchdog `{ kind: 'claude_turn', messageId }`, docs/CHAT.md "Claude threads", and the ＋ Add tab's mini lesson requests `{ kind: 'lesson_request', jobId }`, docs/ADD_TAB.md), `story-generation-queue`, `image-generation-queue`, `sentence-set-queue`, `quest-generation-queue`, `tutor-notes-queue`, `picture-hunt-queue`, `tts-queue` (docs/AUDIO.md), `card-check-queue` (word checks + AI word tags), `recording-check-queue` (docs/RECORDING_REVIEW.md), `audio-lesson-queue` (docs/AUDIO_LESSONS.md; also carries 🎙 podcast episode transcriptions and their mini lessons, `{ kind: 'podcast_episode' | 'podcast_lesson' }`, docs/PODCASTS.md; and 📺 Watch transcripts, `{ kind: 'video_transcript', videoId }`, docs/WATCH.md), `idiom-queue` (docs/IDIOMS.md), `meme-review-queue` (docs/MEME_REVIEW.md), `clip-queue` (🎬 Clips: generation, voice lines made ahead, a clip's mini lesson; docs/CLIPS.md), `homework-email-queue` (docs/HOMEWORK.md §12).

Endpoints (rows live in `quests`):
- `GET /api/quests` - List quests (status, progress, goal/object counts, best moves)
- `POST /api/quests` - Generate one (`{ topic?, difficulty?: easy|medium|hard, goal_count?, deck_ids? }`) → 202
- `GET /api/quests/:id` - Get a quest with its full world JSON
- `POST /api/quests/:id/retry` - Rebuild a failed quest in place, keeping its topic
- `POST /api/quests/:id/complete` - Record a finished play-through (`{ moves }`)
- `DELETE /api/quests/:id` - Delete a quest

### Picture hunt (看图找词; `worker/src/services/picture-hunt.ts`, `routes/picture-hunts.ts`, page at `/picture-hunt`, play at `/picture-hunt/:id`)
Type the Chinese names of things in a picture; each right answer lights up that object. Built like quests on
**`picture-hunt-queue`** (`runPictureHuntJob`, `progress` breadcrumb, stale builds marked failed after 20 min, Retry):
1. picture — generated with Gemini Flash Image (`GEMINI_IMAGE_MODELS`) from the prompt (`buildScenePrompt`, leaning toward the learner's
   words), or the upload already in R2 (the client resizes to 1600px JPEG; `stripJpegMetadata` drops EXIF/GPS again);
2. detection — Gemini Flash (`GEMINI_FLASH_MODELS`) with `box_2d` (0–1000, [ymin,xmin,ymax,xmax]) + segmentation `mask` (base64 PNG over
   the box), least thinking; an unusable mask answer (cut off / not JSON) → a boxes-only call. `cleanDetections` drops
   junk labels, specks, the whole scene and duplicate boxes (≤25). `services/picture-hunt-mask.ts` decodes each mask
   (PNG via DecompressionStream) and traces its largest blob into ONE simplified polygon in normalised image
   coordinates — no PNGs stored, SVG on the web / Canvas in the Lab; failure = box;
3. naming — Claude (`structuredCall`, `claude-sonnet-5`, forced `name_objects` tool, thinking off) sees the picture +
   the numbered boxes and returns hanzi / pinyin / english / alternatives / difficulty / fun_facts / sentence_clue per
   box or skips it (CARD_STANDARD in the prompt); rule-breakers (`huntObjectProblems`) get ONE repair round, then are
   dropped; same hanzi merges into one object with several regions.
Answer matching is `matchHuntAnswer` (`shared/picture-hunt/match.ts`): hanzi or alternatives after NFKC / punctuation
strip / trad→simp table / leading numeral+measure word; **pinyin counts only with tones** (marks or numbers), toneless
= "close"; a shared non-trivial character = "close" (never a find). Web: `services/pictureHunts.ts` caches hunts whole
in IndexedDB (Dexie v21 `pictureHunts`, `pictureHuntImages`, `pictureHuntPlays`) and uploads plays in sync;
add-as-card goes through `POST /api/decks/:id/notes` (content service). E2E seeds with `POST /api/test/picture-hunt`.
- `GET /api/picture-hunts` · `GET /api/picture-hunts/:id` (with objects) · `GET /api/picture-hunts/:id/image` (owner only)
- `POST /api/picture-hunts` `{ prompt, deck_ids?, use_learning_words? }` → 202 · `POST /api/picture-hunts/upload?caption=` (raw JPEG/PNG/WebP or multipart `picture`, ≤ 6 MB) → 202 — both 503 without `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`
- `POST /api/picture-hunts/:id/retry` · `DELETE /api/picture-hunts/:id` (plays + picture)
- `POST /api/picture-hunts/plays` `{ plays }` → `{ accepted, stored, rejected, hunts }` (idempotent by play id)

### Debug reports: web app vs Lab app (`worker/src/routes/debug-reports.ts`, `services/debug-reports.ts`, `shared/debug/`)
When the two apps disagree about what is due, each uploads a **study-state report** built from its
local store with the SAME functions its home screen and study queue use — web:
`frontend/src/services/debugReport.ts` (`getRawQueueCounts` + `allocateQueueCounts` like HomePage,
`getStudyQueue`, `getDueReaders`, `readBonus`, homework via `loadHomeworkItems`); Lab:
`android-lab/app/…/data/DebugReport.kt` (`StudyQueue.introducedToday / cutoff / build / counts` like
HomeViewModel). One shape (`shared/debug/report.ts`, keep `DebugReport.kt` in step): timezone, now,
cutoff, day start, budget, bonus, sync cursors, totals, what the home screen shows, the queue a session
would get, per-deck caps / introduced today / pools / allocation / counts, compact per-card rows
`[card_id, note_id, deck_id, card_type, queue, due_ms, reps, lapses, event_count, in_due_queue,
first_review_ms]` and every event id as an 8-hex FNV-1a `eventIdHash` (same vectors tested in TS and
Kotlin). Uploaded after a sync at most every 30 min, and on demand: web **Settings → Advanced → Send
debug report**, Lab **More → Lab app → Send debug report**. `compareDebugReports` (pure, unit-tested) diffs two
reports plus the server's own `review_events` (which side is missing events / holds unuploaded ones).
- `POST /api/debug/reports` - `{ client: 'lab'|'web', app_version, install_kind?, report }`, JSON or gzip (`Content-Type: application/gzip`) → 201 `{ report: row }`
- `GET /api/debug/reports?client=&limit=` - index rows newest first (with `summary`)
- `GET /api/debug/reports/:id?section=overview|decks|cards|events|full&offset&limit&deck_id&queue&in_due_queue&card_id`
- `GET /api/debug/compare?a=&b=&max_cards=&server=0` - diff; defaults a = newest lab, b = newest web

### Admin: accounts (`worker/src/routes/admin.ts`, services in `worker/src/services/admin/`)
Admin page (`/admin`, `pages/AdminPage.tsx`) → All Users → **Manage · inspect** opens `components/admin/AdminUserSheet.tsx`:
role switch (student / tutor), device & sync state, links, decks incl. deleted ones and shares, recent reports, and
**Delete account** (preview of what goes / stays, typed-email confirmation). Every route is behind `adminMiddleware`;
`:user` is an id or an email. The same actions are the admin-only MCP tools (below).
- `GET /api/admin/users/:user/inspect` - profile, counts, sync state (install kind, last opened, last review sync, sessions), relationships from the user's side (`my_role`), recent feature requests, and `decks` (as below)
- `GET /api/admin/users/:user/decks` - live decks, `deleted_decks` (tombstones + a name hint from a surviving copy), `shares_sent` / `shares_received` with whether each side exists, `untombstoned_deleted_sources` (deleted before 0068)
- `PUT /api/admin/users/:user/role` - `{ role: 'student' | 'tutor' }` (users.role)
- `GET /api/admin/users/:user/deletion-preview` - `will_delete` counts, `will_keep` (copies in other accounts), `r2_objects`, `blockers`
- `DELETE /api/admin/users/:user` - `{ confirm_email }` → `deleteUserAccount` (`services/admin/delete-user.ts`): every DB write child-first in ONE `db.batch` (atomic), `DELETE_STEPS` covers every table (no reliance on FK cascades), other accounts' rows are detached not deleted (assigned lessons unlinked), students' deck / reader copies are KEPT, then R2 keys only this user referenced are removed (clips / images shared with copies stay). Refuses the caller, admins, `ADMIN_EMAIL`, system users. No tombstones: no other device holds the rows. D1 caps compound SELECTs (UNION) at a few terms — keep each query a plain SELECT. Tested against real SQLite with every migration + FKs on (`services/__tests__/sqlite-d1.ts`, `admin-delete-user.test.ts`: no cell anywhere still holds the id, `PRAGMA foreign_key_check` clean, atomic on failure).
- `GET /api/admin/users` also carries `install_kind` / `last_opened_at`. `/api/test/auth` accepts `role` / `is_admin` for specs (`e2e/tests/admin-tutor.spec.ts`).
- **R2 storage clean-up** (`services/admin/storage-cleanup.ts`, Admin → Storage): `STORAGE_PREFIXES` is the ONE registry of R2 key prefixes → writer → referencing `table.column`; `REFERENCE_SOURCES` reads every key column (+ keys inside lesson / library / editor-chat spec JSON). Only `collectable` prefixes (`generated/`, `reader-images/`, `lesson-images/`) are ever deleted; person-made data (recordings, calls, avatars, lesson-note files, screenshots, debug reports, voice samples) and unknown prefixes never are. `GET /api/admin/storage/orphans` and `POST /api/admin/storage/cleanup` are a DRY RUN (per-prefix counts + sample keys); `?apply=1` deletes, only objects older than `min_age_days` (default 7); refused (409) when more than half of a prefix would go unless `force=1`; a failed reference query aborts. **A new R2 key prefix must be added to the registry** — `storage-cleanup.test.ts` scans the worker for key prefixes and fails otherwise.
