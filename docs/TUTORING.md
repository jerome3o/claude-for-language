# Tutoring: dashboard, insights, card flags, student profile, session notes

The tutor side of the app (besides homework — docs/HOMEWORK.md — and chat — docs/CHAT.md).

### Tutor accounts (users.role = 'tutor')
Set by the admin (sheet or `admin_set_role`). `useNavRole` exposes `isTutorAccount` (from the signed-in user, never waits
for relationships): tabs **Students · Chats · Decks · Library · More** (`tabsFor`; a `/decks` page lights Decks, not More), landing always Students unless "Start on" says
otherwise (`resolveLanding`), `/` renders `components/home/TutorHome.tsx` (students, Make, "Try it as your student") instead
of the study home — no streak, due-card button, homework card or learner onboarding; More shows Teaching / Tools; the
background sync generates no daily story (`services/accountRole.ts`). **Try it** previews record nothing:
`/decks/:id/try` (`pages/DeckTryPage.tsx`, a card viewer over IndexedDB in any of the three card types; the tutor's deck
page shows "▶ Try it as a student" instead of Study) and `/library/:id/try` (`pages/editor/LessonTryPage.tsx`, the real
`StudyCustomLesson` with `preview`: no counts, no rating, no completion event). Both are immersive routes.

### Tutor dashboard & student page (`worker/src/routes/tutor-dashboard.ts`)
The tutor's `/connections` becomes a **Students dashboard** once the account has an active
student (`frontend/src/components/tutor/StudentsDashboard.tsx`): one card per student with a
status line (studied today / streak / today's accuracy), three pills (words struggling = the
insights `struggling` list over the last 7 days, 🎤 recordings not yet marked, the one-off Homework headline), and
Message / Send homework. A student with no review events gets the **Getting set up** card (signed
in · homework received · installed the app · first study session) — the same checklist replaces
the empty progress page on their student page. Pending invite links show as muted rows (Resend /
Revoke); the tutor's shared decks list under "My homework decks". The student page
(`ConnectionDetailPage`) is ordered status → Message / Send homework → Needs attention → Homework
(the one-off headline, one-off items, the student's lessons) → Long-term learning (a quieter section: the daily
budget, the long-term decks with words met / ~days / queue position — not homework, docs/HOMEWORK.md §11) → Conversations → Activity; Remove
connection and the student's own shared decks live under ⋯. **Message** opens the most recent
conversation directly (no title modal; a fresh one comes from the chat's own `?new=1` / `chat/new`). Sharing a deck asks for confirmation, and a deck already shared offers **Update their copy**
(new notes only, progress kept). Pure aggregation lives in `services/tutor-dashboard.ts`
(unit-tested); SQL in `db/tutor-dashboard-queries.ts`. **The homework headline counts ONE-OFF homework only**
(`summarizeOneOffHomework`, `shared/homework/summary.ts`; docs/HOMEWORK.md §11): the pass of one_off / both
assignments, open + done this week — "✓ All done this week" / "2 of 3 done" / "1 overdue · …" / "No homework set"
(`pills.homework`, `homework.one_off`; `homework_percent` = the same as 0..100). Long-term decks never count.
The device reports itself during sync (`services/clientState.ts`, throttled to every 30 min):
`display-mode: standalone` → `pwa`, the Capacitor shell → `android`, else `browser`, plus the
cached audio clip count — migration 0064 (`users.install_kind`, `cached_audio_count`,
`last_opened_at`). "Send how-to" posts the Obtainium / home-screen steps into the chat.
- `GET /api/tutor/dashboard?tz_offset=` - Every student card + pending invites + homework decks in one call (client caches 60s)
- `GET /api/relationships/:relId/overview?tz_offset=` - One student card (status, pills, needs_attention, homework, setup, activity)
- `POST /api/relationships/:relId/conversations/open` - Most recent conversation id, created if none
- `POST /api/relationships/:relId/send-howto` - Sends the install how-to as a chat message from the tutor
- `POST /api/relationships/:relId/shared-decks/:id/move` - `{ to: 'top' | 'up' | 'down' | 'bottom' }` move the student's copy within their study queue (tutor only) → `queue_position`, `queue_total`
- **Take homework back** (`routes/homework-removal.ts`, `services/homework-removal.ts`; tutor of the relationship only, 403 / 404): removes ONLY the student's copy of something this tutor sent — a deck linked by `shared_decks` of the relationship (deleted via the content service `deleteDeck`: tombstones + unshared clips), a `custom_lessons` row she assigned (`assigned_by`; the library item stays), a `shared_readers` copy (`deleteReaderWithImages`: pictures another page uses stay) — never the student's own. Also drops the share row, cancels the `assignments` pointing at the copy and stamps `removed_at` on the session-notes job result item that sent it. Each has a preview for the confirm sheet. Web: ⋯ / #N menu on the student page's homework rows, the lessons and the new Readers list → `components/tutor/RemoveHomeworkSheet.tsx`; "Undo — remove from <student>" on `SessionNotesJobCard`; the words (confirm body, toast) are `shared/homework/removal.ts` (Lab `HomeworkRemoval.kt`, parity-tested)
  - `GET /api/relationships/:relId/shared-decks/:id/removal` → `{ deck_name (null = already gone), source_deck_name, words_total, words_met, reviews, can_delete_source }` · `DELETE /api/relationships/:relId/shared-decks/:id[?delete_source=1]` → `{ removed, words_met, reviews, assignments_cancelled, source_deleted }` (`:id` = share id or the student's copy id; `delete_source` only when she owns it and no other student has a copy)
  - `GET|DELETE /api/relationships/:relId/student-lessons/:lessonId[/removal]` (`completions`) · `GET|DELETE /api/relationships/:relId/shared-readers/:id[/removal]` (`readings`; `:id` = share id or copy id)
- `POST /api/relationships/:relId/shared-decks/:id/update` - Bring the student's copy up to date (matched by hanzi; progress kept): adds the tutor's newer notes, fills missing audio, and copies the tutor's edited text fields (pinyin, english, fun_facts, sentence clue…) onto copies the tutor edited more recently than the student (`copyFieldChanges`, newer wins). Returns `added`, `kept`, `audio_filled`, `updated`
- `GET /api/decks/:id/student-shares` - A tutor's copies of this deck in students' accounts with `notes_missing` / `notes_behind` (`routes/word-import.ts`)
- `POST /api/ai/gloss-words` - `{ words: [{ hanzi, pinyin?, english? }] }` (≤100) → the list with gaps filled by Haiku; 503 without an API key (`services/gloss-words.ts`)
- `POST /api/ai/enrich-words` - `{ words: [{ hanzi, pinyin?, english?, fun_facts?, sentence_clue? }] }` (≤30) → each with `fun_facts`, `sentence_clue`, `sentence_clue_pinyin`, `sentence_clue_translation` written to the card standard, blanks only (Sonnet); 503 without an API key (`services/enrich-words.ts`)
- `POST /api/me/client-state` - `{ install_kind, cached_audio_count }` from the device (never downgrades pwa/android to browser)

### Tutor Student Insights (tutor-only, `worker/src/routes/insights.ts`)
One-page briefing for a tutor before a lesson: pure aggregation over the student's
`review_events` (`worker/src/services/insights.ts`, unit-tested), a lesson log that anchors
the default range ("since last lesson", else 14 days; capped at 400 days), a Claude-written
narrative in English + 简体中文, marks on the student's pronunciation recordings, and a
paginated history explorer. Pages: `/connections/:relId/insights`, `/history`, `/recordings`
(`frontend/src/pages/tutor/`). Tables (migration 0060): `tutor_lesson_log`,
`student_summaries`, `tutor_recording_marks`.
- `GET /api/relationships/:relId/lesson-log` - Logged lessons, newest first
- `POST /api/relationships/:relId/lesson-log` - `{ lesson_at, notes? }`; non-empty notes are also
  inserted into the STUDENT's `lesson_notes` prefixed `[From tutor <name>, <date>]` so they feed
  the daily reader and other AI context
- `DELETE /api/relationships/:relId/lesson-log/:id`
- `GET /api/relationships/:relId/insights?from&to` - totals, `struggling` (ranked, with the wrong
  characters typed), `going_well`, `activity` (lessons/readers/quests), `recordings` (+ marks),
  plus the `range` used and `since_lesson`
- `POST /api/relationships/:relId/insights/summary` - `{ from?, to? }` → narrative from the
  structured report (never raw events), persisted; 503 when `ANTHROPIC_API_KEY` is missing
- `GET /api/relationships/:relId/insights/summaries` - Past narratives
- `PUT /api/relationships/:relId/recordings/:eventId/mark` - `{ status: listened|needs_work, comment? }` ("listened" removes a model recording)
- `DELETE /api/relationships/:relId/recordings/:eventId/mark` (and its model recording)
- `PUT|DELETE /api/relationships/:relId/recordings/:eventId/mark/audio` - the tutor's **model recording** on a needs-work mark ("how it should sound": raw audio ≤ 2 MB / 60 s, R2 `tutor-recordings/<relId>/<eventId>-<id>.<ext>`, `tutor_recording_marks.model_audio_key`, migration 0123) → `{ mark }` with `model_audio_url`; `GET /api/recording-marks/:eventId/model-audio` serves it ONLY to that tutor and the student (docs/RECORDING_REVIEW.md "Model recordings"; web `components/recordings/ModelRecorder.tsx`, Lab `ModelRecorderBox`)
- `GET /api/relationships/:relId/history?from&to&deck_id&card_type&rating&q&cursor&limit` -
  Flat review events newest first (keyset cursor); the "by word" view groups client-side

Student side of the marks (`worker/src/routes/recording-notes.ts`; migration 0066 adds
`tutor_recording_marks.student_seen_at`): a needs-work comment is shown once under the pinyin
on the back of that card ("From <tutor>: …"), cached in IndexedDB (`recordingNotes`) by
`services/recording-notes.ts` during sync so it works offline. See docs/STUDY_SESSION.md. With a model
recording the note also has "▶ <tutor> says it" · "▶ You" (her clip next to his take; feeds carry
`model_audio_url` + `recording_url`; clips prefetched with the session by `services/modelRecordings.ts` /
Lab `data/audio/ModelRecordings.kt`).
- `GET /api/me/recording-notes` - Unseen needs-work notes on my recordings (event, card, note, hanzi, comment, tutor name) **plus** unseen tutor replies to my flagged cards (`kind: 'flag'`, `event_id` = the flag id, `card_id` may be null → matched on note_id)
- `POST /api/me/recording-notes/:eventId/seen` - I have seen this note (idempotent, scoped to my own events; a flag id marks that reply seen)
- `GET /api/me/tutor-notes?include_seen=1&limit=&before=` - The **Tutor notes page** (`/tutor-notes`): every note, new AND seen, newest first, keyset paged (`next_cursor`), with the card's pinyin / meaning / card type, `seen_at`, my `recording_url` and, for a flag, my `student_message`. Cached by each sync (IndexedDB `tutorNotes`, Dexie v22; Lab JSON cache) so the page works offline; the unseen feed still decides what is NEW (`mergeTutorNotes`, `shared/tutor-notes`). Viewing marks the new ones seen. Home shows "🗒 N new notes from <tutor>" while any is unseen. **Practice this card / Practice all** → `/tutor-notes/practice?cards=&notes=` (immersive): the study card, the note pinned on the back; **a rating is a review only when the card is due today** (`practiceRatingCounts` = `isDueByCutoff`), otherwise practice only — no review event (docs/STUDY_SESSION.md)

### Card flags & card hub (`worker/src/routes/card-flags.ts`, `routes/claude-chats.ts`, `services/card-flags.ts`)
A student flags a card for their tutor from the study screen (⋯ → **Flag for tutor**,
`components/study/FlagCardSheet.tsx`; only with a human tutor) or from the card's hub page. Offline-first:
`services/cardFlags.ts` writes `pendingCardFlags` (Dexie v17) with a client id, posts at once when online,
else in sync (`uploadPendingCardFlags`); `POST /api/card-flags` is idempotent by id. Every flag and every
reply is also mirrored into the relationship's chat as a system message on the sender's behalf (`mirrorToChat` → `postSystemMessage`,
kinds `card_flag` / `flag_reply`), so the usual unread badge fires. The tutor's reply resolves the flag and reaches the
student once on the card back through the recording-notes feed (above). Tutor side: **Flagged cards** and
**Asked Claude** sections on the student page (`components/tutor/FlaggedCardsSection.tsx`,
`ClaudeChatsSection.tsx` — the student's Claude chats he lets her read, each with its context chip, opened read-only at
`/connections/:relId/claude/:id`; docs/CHAT.md "What your tutor sees"), a `🚩 n flagged cards` pill (`pills.flags_open`) on the dashboard card, and the
MCP tools `list_card_flags` / `reply_to_card_flag` / `list_student_claude_chats`. Student side: **Cards you
flagged** on their tutor page, **More → Claude conversations** (`/claude-chats`). The **card hub page**
(`pages/CardHubPage.tsx`: `/cards/:noteId` for the owner, `/connections/:relId/cards/:noteId` for the tutor)
shows the note, each card's state, flags (with reply box / flag form), the card's Claude threads (the owner:
`components/claude/CardClaudeThreads.tsx`, each opening the thread; the tutor: the ones the student lets her read,
`StudentClaudeThreadList` over `…/claude-threads?note_id=`) and the recent reviews; the deck page's History modal
lists the same threads and links to it. **Claude conversations** (`/claude-chats`) = every card thread with its card
(`AllCardClaudeThreads`; Lab `ui/claude/CardClaudeThreads.kt`). No client regroups Q&A rows any more. Flag
components live in `components/cardFlags/`.
- `POST /api/card-flags` - student: `{ id?, relationship_id, note_id, card_id?, message, created_at? }` → `{ flag, created }` (201 new, 200 existing id)
- `GET /api/relationships/:relId/card-flags?status=open|resolved|all&limit=` - either party → `{ flags, open }`; flags carry hanzi/pinyin/english/deck_name/card_type/student_name/tutor_name
- `POST /api/card-flags/:id/reply` - tutor: `{ reply }` → resolves + chat message + shown to the student once on the card
- `POST /api/card-flags/:id/resolve` | `/reopen` - either party; `DELETE /api/card-flags/:id` - the student who sent it
- `GET /api/me/claude-chats?limit&before&note_id` and `GET /api/relationships/:relId/claude-chats…` (tutor) - LEGACY (older builds): Ask-Claude Q&A rows newest first with note + deck fields, keyset paging on `asked_at` (`next_cursor`), `total` — served from the card threads (`listCardQuestions` / `tutorCardQuestions`)
- `GET /api/notes/:noteId/hub` (owner) and `GET /api/relationships/:relId/notes/:noteId/hub` (tutor) - `{ note, deck, owner, cards[], recent_reviews[], review_count, questions[], flags[] }` (`questions` = the legacy rows from the card threads, for older builds; current apps list the threads)

### Student profile — the tutor's private note on a student (`worker/src/routes/student-profile.ts`, `shared/students/profile.ts`)
Per relationship the tutor writes what kind of learner the student is and what homework suits them: markdown
text (≤ 8000 chars) plus three optional facts the agents act on directly — `level` (→ reader difficulty, lesson
pitch), `handwriting` (handwriting exercises / dictation by hand vs typed only), `words_per_lesson` (the card
count a lesson's homework aims for). **Never visible to the student**: only the tutor of an active relationship
reads / writes it (403 for the student and anyone else, 404 for a missing / inactive relationship); nothing
student-facing (sync, onboarding, study, Ask Claude) touches the table. `studentProfilePrompt` builds the one
labelled block ("Tutor's profile of this student (private; follow it when choosing what to make, how much, and
in what form)", '' when empty) that goes into: the session-notes agent's briefing (so lesson-notes drafts,
session notes and video-call homework all read it; a draft chat message carries the profile again when it
changed since the agent last saw it — `profileUpdateForDraft`), and the lesson co-editor when a tutor edits a
lesson they assigned. UI: **Student profile · 🔒 Only you can see this** on the student page
(`components/tutor/StudentProfileSection.tsx` + `StudentProfileSheet.tsx`: how it's used, three examples from
Minghui's own descriptions to start from / insert, hints) and a quiet `+ Student profile` pill on the dashboard
card while none exists (`has_profile` on the overview). Not the user's own profile (name / picture / bio).
- `GET /api/relationships/:relId/student-profile` - tutor only → `{ profile | null }`
- `PUT /api/relationships/:relId/student-profile` - tutor only, `{ body, level?, handwriting?, words_per_lesson? }` replaces the whole profile (an empty one is deleted → `{ profile: null }`; 400 + `problems`)

### Session notes → homework agent (`worker/src/services/tutor-notes-agent.ts`, routes in `routes/tutor-notes.ts`)
A tutor pastes the raw notes of a lesson on the student page (**Session notes → + Add notes**,
`components/tutor/SessionNotesSheet.tsx`); the notes are NOT turned into cards in one shot. A row
in `tutor_note_jobs` (migration 0072) is queued on **`tutor-notes-queue`** and a Claude agent
(`claude-opus-4-6`, `runTutorNotesJob`) works through them with tools as the tutor:
`check_student_words` / `search_student_cards` / `list_student_deck_words` /
`get_student_struggles` (read-only lookups on the STUDENT's account, `db/tutor-notes-queries.ts`),
`create_deck` + `add_cards` (the content service, `CARD_STANDARD` in the prompt, rejected cards
come back with the reason), `create_mini_lesson` (validated with `validateLessonSpec`, saved to the
tutor's lesson library, tag `session-notes`), `create_reader` (validated `ReaderSpec`, tutor's
account) and `finish` (the summary the tutor reads). The first user message is a **briefing**
(`buildBriefing`: student decks, struggling / going-well words from the insights aggregation, the
lesson log, earlier jobs' results, and the tutor's private **student profile** block when one is written —
the prompt says it overrides the defaults: how many words, which exercise types, level, reader topics)
followed by the notes verbatim (cut at `MAX_NOTES_CHARS`).
Prompt rules: cards only for what the lesson taught, skip words the student has in review, a mini
lesson ONLY when the notes show a taught structure with example sentences (about that structure),
a reader only when the notes call for one. **Create, then send**: everything the job makes stays in
the TUTOR's account — `auto_share` defaults to FALSE on every entry point (UI, API, MCP; only an
explicit `true` counts, `wantsAutoShare`). The finished job card shows each unsent item with
**Send to <student>** and, when there are several, **Send all N to <student>** (confirm first;
`SessionNotesJobCard`, Lab job card) → `POST …/session-notes/:id/send` (`services/tutor-notes-send.ts`
→ `assignHomework`, the Send-homework path; which items are unsent = `unsentJobItems` in
`shared/homework/send.ts`, with the button words). Only with `auto_share: true` does `finish` share
the deck (`shareDeck`), assign the lesson and share the reader itself (jobs made before Oct 2026
keep what they did). An empty deck is deleted.

**Reliability**: the transcript is checkpointed in the row after every model turn and after every
batch of tool results, so a redelivery resumes where it stopped (an assistant turn whose tool calls
were never answered is executed first, never re-asked); every create tool is idempotent per job
(one deck, one reader, lessons by title, cards by hanzi within the deck); a delivery past
~3.5 min re-enqueues itself (`{ jobId, resume: true }`); rounds are capped (`MAX_ROUNDS`); model
calls retry on 429/5xx/529; a plain-text ending is taken as the summary; failures are written to
the row with a readable message (`describeError`) and **Retry** resumes from the checkpoint (a job
out of rounds restarts). `steps` (progress lines from `stepForTool` + the model's own text) and
`progress` drive the UI, which polls every 3 s while a job is queued / running
(`SessionNotesSection`, `SessionNotesJobCard`; all jobs at `/connections/:relId/session-notes`).
Submitting also logs the lesson (`tutor_lesson_log` + the student's `lesson_notes`) unless
`log_lesson: false`. At most 2 active jobs per relationship. Both entry points go through
`submitSessionNotes` (`services/tutor-notes-submit.ts`). **Homework from a recorded video lesson**:
on `/calls/:id/review` the tutor's **Make homework from this lesson** button
(`components/calls/CallHomeworkSection.tsx`) posts to `POST /api/calls/:id/homework`; the call's
transcript (speaker-labelled, with translations, middle trimmed), whiteboard text, in-call chat and
the lesson report become the job's notes (`composeCallNotes`, pure, unit-tested), `source_call_id`
links the job back to the call, and the briefing tells the agent it is reading speech recognition.
One active job per call; the job card links back to the review page ("from a video lesson"). The loop is unit-tested with a
mocked model and stores (`services/__tests__/tutor-notes-agent.test.ts`).
- `POST /api/relationships/:relId/session-notes` - `{ notes, title?, lesson_at?, priority?, auto_share? (default false), log_lesson? }` → 202 `{ job }` (tutor only; 503 without `ANTHROPIC_API_KEY`; 409 when two jobs are already active)
- `GET /api/relationships/:relId/session-notes[?limit]` - `{ jobs }` newest first, no transcripts
- `GET /api/relationships/:relId/session-notes/:id` - the job with `steps`, `progress`, `result` (`deck`, `lessons`, `reader`, `summary`, `skipped`)
- `POST …/session-notes/:id/send` - `{ items?: ['deck' | 'lesson:<library_item_id>' | 'reader'], mode?, due_date?, today? }` (none = everything unsent) → `{ job, sent, assignments, skipped, errors, copies }` — the explicit send of a finished (non-draft) job's results as homework; 400 when nothing is left, 409 while running / for a draft
- `POST …/session-notes/:id/retry` | `/cancel`, `DELETE …/session-notes/:id` (what the job created stays)
- `POST /api/calls/:id/homework` - `{ priority?, auto_share? (default false), log_lesson? }` → 202 `{ job }` from the call's material (tutor of the call's relationship; 409 while live / still transcribing; 200 `{ job, existing: true }` when one is already running) · `GET /api/calls/:id/homework` → `{ jobs }`
