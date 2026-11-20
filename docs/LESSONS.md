# Custom mini lessons, the lesson library & editor

Agent-authored mini lessons (`shared/lesson`), how they are played, revised and exported, and the tutor's
library + editor. The player's behaviour in study is in docs/STUDY_SESSION.md ("Mini lessons").

### Custom mini lessons (agent-authored; Home's homework card + the Mini Lessons page)
The generalized successor to the fixed-phase grammar lesson: a **schema-driven lesson**
(`shared/lesson`) that agents author — sections in any order, each holding any number of
exercises of any type. Exercise types: `note` (teaching text + example sentences with TTS; grammar structures as `patterns` → structure cards, one per screen, nothing auto-plays — `shared/lesson/pattern.ts`),
`scramble` (word order), `choice` (multiple choice), `translate` (EN→ZH, self-assessed),
`match` (connect hanzi↔English pairs), `describe_image` (an illustration is generated from
`image_prompt` via the image queue; the learner describes it aloud, self-assessed),
`speak` (say your own sentence, self-assessed), `listen_choice` (LISTENING: audio plays with
the text hidden, pick the matching option — built for tone/minimal-pair discrimination like
有 yǒu vs 又 yòu), and `listen_translate` (LISTENING: audio plays hidden, translate what you
heard, self-assessed), plus the practice set: `sentence_making` (own sentence with 1–4 target
words, typed or handwritten; Claude checks it online via `POST /api/lessons/sentence-feedback`
— `structuredCall`, `services/sentence-making.ts` — self-assessed offline), `write_typed` and
`write_handwriting` (SEPARATE types: keyboard vs hand; typed is auto-checked with `diffHanzi`,
handwriting runs on the stroke-order pad `components/strokes/WritingExercise.tsx` with a free
sketch-pad fallback when the stroke data isn't on the device), `dictation` (hear it, write it;
`input: type | handwrite`), `oral_expression` (answer out loud, RECORDED for the tutor,
transcribed live as it is spoken and checked by Claude at Done — parts ①②③ covered, a cleaner version,
≤ 4 tips; gracious about restarts / fillers / English / punctuation; offline = checked by the server when
the recording uploads — docs/STUDY_SESSION.md "Claude checks your speaking", `shared/lesson/speakingTake.ts`) and `conversation` (a 2–3 speaker
dialogue played with a distinct TTS voice per speaker — `shared/lesson/voices.ts`, `voice_id`
on `/api/practice/tts`, cached per voice + speed for offline — then comprehension questions, one point
each, transcript revealed at the end), and the per-sentence pair (`shared/lesson/judgeGap.ts`, Lab
`core/…/JudgeGap.kt`, parity-tested; docs/STUDY_SESSION.md "Judge each sentence / Choose the word"):
`judge` (3–8 sentences, each marked ✓ Correct / ✗ Incorrect; a wrong one carries `correction` + a one-line
`explanation`, shown after Check — replaces "which sentence is wrong?" choices; a wrong sentence is never
spoken, never exported as vocabulary and skipped by the pinyin checker) and `gap_choice` (2–8 sentences
with ONE gap `___`, 2–4 `options` shared on the exercise or per item, `answer` ∈ options; pinyin / english are
the FULL sentence's, `fillGap` puts the answer in for display / TTS / exports / the pinyin check — near-synonyms
刚 / 刚才, 再 / 在, 的 / 得 / 地). Both are checked on the device, one point per sentence (`exercisePoints`;
`answer.items` per sentence, `partPoints`), so one miss makes the exercise owed in the retry round / revision;
analytics `lesson.items_checked`. Conversation lines are spoken at the provider's own
conversation rate (admin `conversation_rate`: MiniMax 0.85, Azure 0.75, Google 0.8; every other clip
stays at 0.6) or the learner's speed, and play back to back with a `CONVERSATION_LINE_GAP_MS` (200 ms)
beat. **⚙︎ Audio** on every conversation (speed, a voice per speaker, delivery, Regenerate audio) —
account preferences `GET|PUT /api/conversation-audio` (docs/AUDIO.md "Conversation audio").
Lessons built around a conversation open with a SPOILER-FREE intro (`CONVERSATION_INTRO_RULE` in
`shared/lesson/doc.ts`; `conversationIntroWarnings` warns softly in the editor and MCP tools). Voices come from the account's **enabled pool** (Settings → Advanced → Conversation voices,
`/settings/voices`; Lab: same path): `conversationVoicesFor(ex, enabled)` picks two different voices
per dialogue, rotated by a hash of the dialogue (stable for one dialogue, varied across them), gender
as the spec says / alternating. Selection per account in `users.conversation_voices` (migration
0078); NULL = the admin's own selection, else the catalogue's `default_on` voices (newsreader /
neutral / warm only — the breathy, "sweet", role-play voices ship off). It rides on `/api/auth/me`
(`conversation_voices`) and is cached on the device (`services/conversationVoices.ts`, Lab
`ConversationVoiceCache`), so a changed selection just makes new clips on the next prefetch. The study views are `components/ExerciseView.tsx` (the one
switch over types) → `lesson-exercises.tsx` / `practice-exercises.tsx`. Adding a type: its
interface in `types.ts`, a case in `validate.ts`, an entry in `registry.ts`, a line in `doc.ts`, a
sample in `samples.ts`, the study view, the editor form — `practice-types.test.ts` checks the
registry / samples / doc cover every validated type. Specs are validated with
`validateLessonSpec` before storage; invalid specs come back with a list of problems so the
agent can repair and retry.

**Lesson audio is prefetched** (docs/AUDIO.md "Lesson audio prefetch"): every clip a lesson plays (`shared/lesson/audioClips.ts`) is fetched by the sync (today's, open homework, lockable, next new lessons), again when a lesson opens (exercise on screen first), and pre-generated server-side into R2 `tts-cache/` on every lesson write (`services/lesson-audio.ts`, tts-queue `lesson_audio`); a late clip never plays on a later exercise.
Lessons are cached whole in IndexedDB (`customLessons`) and studied fully offline. **They are NOT part of
the study session** (Oct 2026: no lesson mix, no "New lessons a day", no Settings → "Lessons & readers"):
they are done from **Home's homework / to-do card** (revisions due + new lessons a tutor sent for long-term review, with sizes — `homeHomework`,
`shared/homework/home.ts`) and the **Mini Lessons page**, through the player at `/lessons/:id/play?from=&mode=revision`
(`pages/LessonReplayPage.tsx`, Lab `ui/lessons/LessonReplay.kt`) or a homework pass (docs/STUDY_SESSION.md "Mini lessons"):
- **A run is never lost** (`shared/study/lessonRun.ts`, Lab `core/…/LessonRun.kt` parity-tested): saved after every
  exercise (where it stands, score, attempt rows with their checks, recordings) — web IndexedDB `lessonRuns` (Dexie v34,
  `services/lessonRuns.ts`), Lab `LessonProgressStore` — keyed on the lesson's shape (exercise types), never bounded by
  date: "Continue where you left off (7 of 18)" · Start over. (Before: the web kept it in memory, the Lab dropped it on
  another day / an edited spec.) Closing records nothing.
- **The retry round**: every scored exercise wrong on the main pass comes back after the last one until right
  ("Let's put this one right · 2 left"); the bar is the homework pass's retry bar (`runRetryBar` → `retryBar`,
  `components/homework/RetryProgressBar.tsx`, Lab `ui/kit/RetryProgressBar`). Retry rows carry `retry: n` in the attempt.
- **Revise until right first time** (`shared/study/lessonRevision.ts`, Lab `core/…/LessonRevision.kt` parity-tested; no
  rating, no Done for good): each completion carries its **outcome** (main-pass scored keys + those missed first time;
  `custom_lesson_completions.outcome`, migration 0133; derived from the attempt when an older app sends none,
  `services/lesson-revision.ts` `backfillCompletionOutcomes`). The latest run decides: nothing missed → done forever;
  else a **revision** `LESSON_REVISION_GAP_DAYS` (7) later = the missed ones + ~20 % (1–3, seeded, across types) of the
  ones got, with their notes — weekly until a run is all right first time. Legacy: a finish without an attempt follows
  its rating (Again / Hard → a whole-lesson revision, else done); an old "Done for good" (`revisit_events` retire) = done.
  The tutor's views show "Revision 2 due 29 Oct · 3 to get right" / "all right first time" (`revision_label`,
  `revisionProgressLabel` in `shared/homework/library.ts`; Completed = all right first time).
Completions are offline events (idempotent by id) uploaded in sync; other devices' completions (with their outcomes) come
down inside `GET /api/custom-lessons`. Old apps' ratings, `revisit_events` and `PUT /api/profile/revisit-settings` are still
accepted (the settings PUT is a no-op answering the old defaults; the "revisit later" schedule code is gone). Authoring paths: the MCP `create_custom_lesson` tool, the in-app
Ask Claude chat's `create_custom_lesson` tool, or the REST endpoint. The shared exercise
views live in `frontend/src/components/lesson-exercises.tsx` (StudyGrammar reuses the
scramble/choice/translate ones). The **Mini Lessons page** (`/lessons`, in the profile
menu) lists To do (▶ Continue / ▶ Revision / ▶ Start) / Revision coming / Done for good with sizes — full exercise listing per lesson, delete, and an
**Edit** link into the lesson editor (see "Lesson library & editor" below).
- `GET /api/custom-lessons` - Active lessons with parsed spec (`?status=done|all` for the rest)
- `POST /api/custom-lessons` - Create from `{ spec }` (validated; queues describe_image illustrations)
- `PUT /api/custom-lessons/:id` - Replace a lesson's spec in place (validated; same id so history/schedule carry over; keeps generated illustrations whose image_prompt is unchanged)
- `DELETE /api/custom-lessons/:id` - Delete a lesson
- `POST /api/custom-lessons/offline-complete` - Upload completion events (idempotent by event id); an event may carry `attempt` (per-exercise answers + time, retry rows), stored in `custom_lesson_attempts`, and `outcome` `{ keys, missed }` (else derived from the attempt; `rating` accepted from old apps)
- `POST /api/custom-lessons/unlock` - `{ events: [{ lesson_id, unlocked_at, via: auto|manual|player }] }` → `{ unlocked, already, not_found }` (idempotent; the earliest time wins)

**Unlockable lessons — podcast companions** (`shared/lesson/unlock.ts`, Lab `core/…/LessonUnlock.kt`, parity-tested;
`services/lesson-unlock.ts`, `services/companion-lesson.ts`, migration 0119; docs/STUDY_SESSION.md "Unlockable lessons",
docs/AUDIO_LESSONS.md "Companion mini lesson"). A lesson may carry `unlock: { kind: 'audio_lesson', audio_lesson_id } |
{ kind: 'manual', prompt }` (columns `custom_lessons.unlock_kind / unlock_ref / unlock_prompt / unlocked_at / unlocked_via`,
`companion_of` = the podcast it was written for). LOCKED = never offered (not on Home's card or the Mini Lessons page's To do,
only in "🔒 Ready to unlock"); unlocked = an ordinary new lesson. Unlock: automatically when a listen reaches ≥ 85 % or the last chapter of its audio lesson
(`audioLessonListened`; web player / Lab `AudioLessonEngine` → `POST /api/audio-lessons/listened`, which also unlocks
server-side — only at the moment of a listen, so a companion made for a podcast already heard waits for a tap), by hand
("✓ I've listened — unlock" / "✓ Done — unlock": web Mini Lessons page "🔒 Ready to unlock" + the locked gate on
`/lessons/:id/play`; Lab Mini Lessons), or from the player's companion card ("Mini lesson ready → ▶ Start").
Offline-first: web IndexedDB `lessonUnlocks` (Dexie v32), Lab `lessons/local-unlocks` + the Outbox. `POST /api/custom-lessons`
takes `unlock`; `POST /api/audio-lessons/:id/companion-lesson { unlock?: audio|manual, prompt? }` writes the companion on
audio-lesson-queue (`{ lessonId, companion: true }`; Claude + validateLessonSpec + 2 repair rounds + the 一/不 rule; one per
podcast, replaced in place while not started); audio lesson summaries carry `listened_at` + `companion`.

**Lesson pictures** (describe_image; `worker/src/services/lesson-images.ts`, `routes/lesson-images.ts`,
pure helpers in `shared/lesson/images.ts`): one picture per scene description, keyed by a hash of the
normalised `image_prompt`, so a library item, every student copy, a push-update and the catalogue sample
with the same scene share ONE generated picture (Gemini, `image-generation-queue`, message
`{ kind: 'lesson_image', hash, prompt }`; 3 attempts with growing delay, then `failed`, retried after a
day; a pending row older than 15 min is re-queued). Every create / assign / update / push path calls
`queueLessonImages` after writing the row: a ready picture is written in at once, otherwise queued; when
a picture is drawn `applyLessonImageEverywhere` writes its key into every `custom_lessons` row waiting for
that prompt — matched by prompt, never by section/exercise index. Library items never store `image_url`
(`lessonToExportSpec` strips it); saving one pre-draws its pictures. The player (`hooks/useLessonImage.ts`,
`DescribeImagePicture` in `lesson-exercises.tsx`; Lab: `data/lessons/LessonPictures.kt` +
`ui/lessons/LessonPictureView.kt`) shows the key's picture (cached blob → offline), else asks by prompt and
shows **"Drawing the picture…"** while it is pending, polling until it appears; the scene text only when
offline-and-never-downloaded or the generator gave up. Prompt → key is remembered on the device, and the
sync (`topUpLessonImagesIfDue`, hourly) writes ready pictures into the account's lessons, queues missing
ones, pre-draws library items + the catalogue samples and caches the sample pictures. `lesson-images/`
keys are shared, so account deletion never removes them.
- `POST /api/lesson-images/ensure` - `{ prompts (≤20), queue?: false }` → `{ images: [{ prompt, status: ready|pending|failed|unavailable|missing, image_url }] }` (idempotent; `queue: false` = look up only, the editor form)
- `POST /api/lesson-images/top-up` - the caller's lessons / library items + catalogue samples → `{ lessons_checked, prompts, applied, pending, failed, unavailable }`
- `POST /api/admin/lesson-images/backfill` - admin: the same for every account

**Lesson attempts** (`routes/lesson-attempts.ts`): the player records what was answered in each
exercise and how long it took (`StudyCustomLesson` → the completion event's `attempt`); recordings
are queued in IndexedDB `lessonAttemptMedia` (Dexie v20) and uploaded after the attempt
(`uploadLessonAttemptMedia`, in sync and right after a lesson). The tutor reviews an attempt at
`/connections/:relId/lesson-attempts/:id` (linked from the student page's Mini Lessons and the library
item's assignments via `last_attempt_id`); the learner's own at `/lesson-attempts` (Mini Lessons → My answers).
- `PUT /api/lesson-attempts/:id/media/:key` - Raw audio body for one recording (owner; 404 until the attempt is uploaded)
- `GET /api/lesson-attempts[?lesson_id]`, `GET /api/lesson-attempts/:id` - Mine; `GET /api/relationships/:relId/lesson-attempts[/:id]` - the student's (tutor)
- `POST /api/lessons/sentence-feedback` - `{ words, task?, sentence }` → `{ feedback }` (503 retryable / 502)
- `POST /api/lessons/answer-check` - `{ prompt_en, model_answer, model_pinyin?, answer, exercise_type, input?, focus? }` → `{ check: { verdict: correct|acceptable|almost|wrong, headline, corrected, corrected_pinyin, tips: [{ text, quote? }], alternative?, suggested: got_it|missed_it }, cached, ms }` — Claude's check of a self-assessed translate / listen_translate answer, or of a word order the lesson didn't list (`exercise_type: 'scramble'`, the orders as tiles joined with spaces; `shared/lesson/scrambleCheck.ts`) (Haiku, cached for everyone in `lesson_answer_checks`, migration 0127; 400 + `problems`, 503 retryable / 502; docs/STUDY_SESSION.md "Claude checks your answer"; rules `shared/lesson/answerCheck.ts`) · `POST /api/lessons/answer-check/ask` - the same + `{ check?, history?, question }` → `{ reply }` (💬 Ask about this)

**Exercise catalogue** (`/library/catalogue`, `pages/editor/ExerciseCataloguePage.tsx`, linked from the top of
the library, More → Teaching — shown to tutor accounts, anyone with students or library items, and admins whatever
their role — and the admin page; no role guard on the route): every type from the registry with its sample lesson —
**Try it** runs the sample in the real player with `preview` (nothing recorded: no rating, no completion event, no
attempt, no recording kept), **Copy to my library** creates a library item. The library's
New lesson sheet also drafts a conversation lesson from just a situation + level. Sending a lesson (one-off with a
due date, or long-term review) is the homework model's job (docs/HOMEWORK.md, `kind: 'lesson'` covers every exercise
type); a lesson finished in a homework pass records its attempt exactly like one in a study session.

### Lesson library & editor (`worker/src/routes/lesson-editor.ts`, mounted at `/api`)
A **lesson editor** (structured form for every exercise type with live `validateLessonSpec`
errors, a preview built from the real `lesson-exercises.tsx` components, auto-pinyin via
`pinyin-pro`, TTS play buttons, raw JSON under Advanced) with a **Claude co-editor chat** beside
it, and a tutor **lesson library**. Library model = *copy with link back*: the library item is
the master; assigning creates a real `custom_lessons` row for the student (works offline, the
student may edit it) that remembers `library_item_id` / `assigned_by` / `assigned_relationship_id`.
"Push update" overwrites the copies' specs in place (same ids → completion history and revisit
schedule survive) and re-queues describe_image illustrations whose prompt changed
(`mergeKeptImages` in services/custom-lesson.ts). The editor is for both roles: students on their
own lessons (`/lessons/:id/edit`), tutors on library items (`/library/:id/edit`) and on lessons
they assigned. `EditorShell` (components/editor) is generic — main column + chat pane at ≥1024px,
Edit / Preview / Claude bottom tabs on phones — so a reader editor can reuse it.
The chat (`services/lesson-editor.ts`, claude-sonnet-5) gets the current spec, the
`shared/lesson/diff.ts` summary of what the author changed since its last message, and one tool
`propose_lesson_spec` returning the FULL revised spec (validated; up to 2 repair rounds).
Proposals render as a diff card with Accept / Reject; accepting replaces the editor state
(unsaved until Save). Without `ANTHROPIC_API_KEY` the chat says so and the editor still works.
Exports (Markdown with answer key, re-importable JSON, Quizlet-style CSV) are pure functions in
`shared/lesson/export.ts`, served by the worker and also built client-side (works offline);
print views live at `/library/:id/print` and `/lessons/:id/print`.

**Anki export (`frontend/src/services/anki/`, UI in `components/export/AnkiExportModal.tsx`)**:
decks (Deck → Settings → Export to Anki), lessons / library items (⋯ menu → Export Anki) and
readers (Anki button on the list card and reader page) export a real `.apkg` built entirely in
the browser — sql.js writes `collection.anki2` (legacy schema 11), JSZip packs it with the audio
clips. Two note types: **汉语学习 Vocabulary** (Hanzi/Pinyin/English/Audio/Sentence…/Notes/SourceId,
three templates mirroring the app's card types; the Audio → Hanzi card only exists when Audio is
non-empty) and **汉语学习 Sentence** (Chinese/Pinyin/English/Audio/SourceId, one card) for reader
pages and lesson sentences. All ids are deterministic (model/deck ids hash their names, note GUIDs
hash the source id / hanzi) so re-exporting UPDATES notes in Anki instead of duplicating them —
never rename model fields or templates. Audio is cache-first (IndexedDB), fetched/generated when
online, skipped and counted when missing, so the export works offline. "Include progress" (decks,
off by default) writes an approximation of card state into Anki's scheduling columns. The module
is `import()`ed on demand and the sql.js `.wasm` is precached by the PWA (`wasm` in the workbox
glob). `sources.ts` (adapters) and `apkg.ts` (builder) are pure and unit-tested by rebuilding and
re-reading the package with the same libraries. Format details: docs/IMPORT_EXPORT_FORMAT.md.
- `GET /api/lesson-library` - Non-archived items with assignment/exercise counts
- `POST /api/lesson-library` - Create from `{ spec }` or `{ generate: { prompt } }` (Claude drafts it via `generateLessonSpec`)
- `POST /api/lesson-library/import` - Same as create from `{ spec }`
- `GET|PUT|DELETE /api/lesson-library/:id` - Get with spec / replace spec (+ `tags`; version bumps when content changed) / archive
- `POST /api/lesson-library/:id/duplicate` - Copy as "Copy of …"
- `POST /api/lesson-library/:id/assign` - `{ relationship_ids }` (caller must be the tutor); returns `assigned`, `already_had`, `errors`
- `GET /api/lesson-library/:id/assignments` - Per student: completions, last rating/score, `up_to_date`
- `POST /api/lesson-library/:id/push-update` - `{ relationship_ids? }` overwrite copies that are behind
- `GET /api/lesson-library/:id/export.md|json|csv` and `GET /api/lessons/:id/export.md|json|csv`
- `GET|PUT /api/lessons/:id` - A lesson for the editor: owner or the tutor who assigned it (`is_owner` in the response)
- `GET /api/relationships/:relId/student-lessons` - Tutor's view of the student's lessons (`assigned_by_me`, completions)
- `GET /api/editor-chat/:targetType/:targetId` - Get-or-create the chat; messages carry `proposal_diff` and `author_changes`
- `POST /api/editor-chat/:targetType/:targetId/messages` - `{ message, current_spec }` → `{ user_message, message, proposal? }` (503 without an API key)
- `POST /api/editor-chat/:targetType/:targetId/messages/:id/accept|reject`
