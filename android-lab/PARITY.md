# Lab app ↔ web app feature parity

The Lab app (`android-lab/`) aims for **full feature parity** with the web app, to the
same standard. This file is the checklist AND the plan for building it in parallel: the
work is split into packages **A–J**, each owning its own files, so ~10 agents can work at
once without touching each other's code. When a feature lands on either side, update its
row in the same PR. (How to implement one: `.claude/skills/native-parity/SKILL.md`; the
UI pieces: `docs/UI_KIT.md`.)

Status: ✅ done · 🟡 partial (say what's missing) · ⬜ not yet (the Lab app shows a
placeholder that opens the main app at that route) · ➖ not applicable natively

## How the work is split

Every package works in **its own folders** — `ui/<feature>/` (screens, ViewModels,
`<Feature>Nav.kt`), `data/api/<Feature>Api.kt` (endpoints + DTOs), optional
`data/<feature>/` (sync step, outbox helpers), `core/…/<Feature>*.kt` + `parity/fixtures/<feature>.ts`
for logic that must match the TypeScript, and its tests (`app/src/test/…/ui/<feature>/`,
`core/src/test/…/<Feature>*Test.kt`). Screenshot names start with the package's feature
name (`decks-01-list`).

**Shared files — one-line, append-only edits** (merge conflicts there are trivial):

| File | What a package adds |
|---|---|
| `ui/nav/FeatureGraphs.kt` | `<feature>Graph(nav)` — one line |
| `data/platform/FeatureSyncs.kt` | `platform.register("<feature>", <Feature>Sync)` — one line |
| `ui/nav/Routes.kt` | a typed helper if the route has none yet (most exist) |
| `ui/more/MoreExtraRows.kt` | a row for More → Lab app (rare) |
| `app/src/test/…/testing/Samples.kt` | sample data (append) |
| `ui/kit/` | a NEW file for a new shared piece + a line in docs/UI_KIT.md (never rewrite another's) |

**Owned by one agent at a time — ask/serialise before touching**: `data/Db.kt` +
`data/Migrations.kt` + `schemas/` (schema changes; prefer `JsonCache` / `Outbox`, which need
none), `data/Repository.kt` sync internals and `data/Api.kt` sync calls (the sync-speed
work), `ui/nav/` shell internals (LabShell, LabNav, NavRules, TabBar), `core/` files of
another package, `parity/generate-fixtures.ts` (use `parity/fixtures/<feature>.ts` instead).

**Tab roots already registered as stubs** (replace the body in your file, keep the route):
`/decks` → `ui/decks/DecksNav.kt` (C), `/progress` → `ui/progress/ProgressNav.kt` (D),
`/connections` → `ui/connections/ConnectionsNav.kt` (E, dispatching to F's dashboard for
accounts with students), `/library` → `ui/library/LibraryNav.kt` (G). Every other web path
already opens a placeholder — registering the route in your graph is what makes it native.

## Platform (done — the base every package builds on)

| Feature | Status | Web source | Lab source |
|---|---|---|---|
| Tab bar per role (student · account with students · tutor account), active tab, immersive routes | ✅ unit-tested against the web's cases | `components/nav/tabs.ts`, `navRole.ts`, `TabBar.tsx` | `ui/nav/NavRules.kt`, `TabBar.kt`, `LabShell.kt` |
| Landing rule (Start on / tutor account / students & nothing due) | ✅ | `components/nav/landing.ts`, `LandingResolver.tsx` | `NavRules.resolveLanding`, `ShellViewModel` |
| Navigation by web path, placeholders → main app, deep links `chineselearning-lab:///<route>` | ✅ | `App.tsx` routes | `ui/nav/LabNav.kt`, `Routes.kt`, `WebDestinations.kt`, `ui/placeholder/` |
| More tab (Practice / From your tutor / Teaching / Account / Advanced + Lab settings) | ✅ rows open native screens or placeholders | `pages/MorePage.tsx` | `ui/more/` |
| Offline feature data (`json_cache`) + offline writes (`outbox`), Room v2 migration | ✅ migration + outbox tested | IndexedDB tables, `pendingCardFlags`, `pendingRecordings` | `data/platform/`, `data/Migrations.kt` |
| Generic API helpers (`get/post/put/patch/delete`, multipart `upload`, error sentences) | ✅ | `api/client.ts` | `data/api/Http.kt` |
| UI kit + screenshot helper | ✅ | — | `ui/kit/`, `docs/UI_KIT.md`, `testing/LabScreenshotTest.kt` |
| Study-state debug report (upload after sync every 30 min, More → Lab app → "Send debug report"), diffed with the web app's | ✅ unit + contract-tested | `services/debugReport.ts`, `shared/debug/`, Settings → Advanced | `data/DebugReport.kt`, `ui/more/MoreExtraRows.kt` |
| Tutor account home (`/` for users.role = tutor) | 🟡 students count, Make rows, Try-it deck rows; Try it itself is ⬜ (C/G) | `components/home/TutorHome.tsx` | `ui/home/TutorHomeScreen.kt` |

## A — Study card extras (web: `StudyPage.tsx`, `useStudySession.ts`, `components/study/`)

Owns `ui/study/` (CardStage, StudyScreen, StudyViewModel, Sentences), `core/…/StudyQueue.kt` / `AnswerKey.kt` changes, `data/api/StudyApi.kt`.

| Feature | Status | Web source | Lab source |
|---|---|---|---|
| FSRS scheduling (event replay, live review, interval previews) | ✅ parity-tested | `shared/scheduler/compute-state.ts` | `core/…/Fsrs.kt`, `CardState.kt` |
| Global new-card budget, deck queue, per-deck caps | ✅ parity-tested | `shared/decks/budget.ts` | `core/…/Budget.kt` |
| Queue building (cutoff, due cards, tiers), introduced today, Home counts | ✅ parity-tested (`parity/fixtures/study-queue.ts`) | `shared/decks/study-queue.ts` (`getStudyQueue`, Home) | `core/…/StudyQueue.kt` |
| Next-card pick | ✅ unit-tested | `useStudySession.ts` `selectNextItem` | `core/…/StudyQueue.kt` |
| Events the server refuses (`orphan_event_ids` from `POST /api/reviews`) marked rejected, not synced | ✅ `synced = -1` (the web's `_synced = -1`), never re-uploaded; contract-tested against a real worker | `services/review-events.ts` | `data/Repository.kt` `uploadPending`, `LabDao.markRejected` |
| Three card types (read / write / listen), flip, rating bar | ✅ | `StudyPage.tsx` | `ui/study/CardStage.kt` |
| Typed-answer check (punctuation, numbers, 两/二, alternatives) + diff | ✅ parity-tested | `utils/numberHanzi.ts`, `AnswerDiff` | `core/…/AnswerKey.kt` |
| Example sentences (clue row + set, tap-to-reveal, EN mode, show all) | ✅ | `components/SentenceSet.tsx` | `ui/study/Sentences.kt` |
| "Use in sentence" hint on the front | ✅ stored clue shown / played; generated when the note has none, ↻ regenerates (online) | `StudyPage.tsx` | `CardStage.kt` |
| Undo last review (incl. server DELETE) | ✅ | `useStudySession.ts` undo | `StudyViewModel.undoLast` |
| Study 10 more | ✅ | `utils/bonusNewCards.ts` | `Prefs.bonus` |
| Exit confirm with recap, All Done + confetti | ✅ (+ sound, haptics). No in-session streak anywhere (web or Lab): rating feedback is the same tap + pop for every rating, so an honest Again costs nothing | `ExitSessionModal`, `SessionRecap`, `Confetti` | `StudyScreen.kt` |
| Top-bar counts: active bucket highlighted (purple = NEW card whose note was reviewed this session), tap → image of the counts on the clipboard | ✅ pill + underline on the active count, the rest dimmed; PNG like `copyQueueCountsImage` via FileProvider + text, Share for apps that don't paste images | `QueueCountsHeader.tsx`, `utils/queue-counts-image.ts` | `ui/study/QueueCountsBar.kt`, `QueueCountsShare.kt` |
| Audio: cached clip → stream → device voice | ✅ | `useAudio.ts`, `audioPlayback.ts` | `fx/WordAudio.kt` |
| Offline study + background upload | ✅ | `services/sync.ts` | `data/Repository.kt`, `SyncWorker.kt` |
| Card footer: **Ask Claude · Edit card · ⋯** action row | ✅ | `components/study/StudyActionRow.tsx` | `ui/study/CardExtrasUi.kt` `StudyActionRow` |
| Voice recording on read cards + transcription + upload (queued: `Outbox.enqueueUpload`) | ✅ live: streamed to Soniox while speaking (16 kHz PCM, the take kept as WAV) when a temporary key is cached, else webm/Opus like the browser (AAC before Android 10) uploaded to Whisper; transcribed at Stop; uploaded with `review_id`; undo drops it | `useTranscription.ts`, `services/liveTranscription.ts`, `shared/transcription/soniox.ts`, `pendingRecordings` | `ui/study/VoiceRecording.kt`, `LiveTranscription.kt`, `StudyViewModel` |
| Multiple-choice fallback (8 s) / auto-MC for listen cards; one-tap submit with partial answers ("Show answer" with nothing picked, picks in row order as user_answer, row-by-row result on the back) | ✅ options prefetched per deck twice a day (`study-mc` sync step) so listen cards get them offline; one tap + partial answers (`McOneTapTest`) | `services/multipleChoice.ts` | `ui/study/MultipleChoice.kt`, `McGrid.kt` |
| Ask Claude (card chat with tools: edit card, add cards) | ✅ quick questions, tools folded, approve / reject, + message → card | `components/study/` Ask Claude, `POST /api/notes/:id/ask` | `ui/study/AskClaudeSheet.kt`, `StudyViewModel.ask` |
| Edit card | ✅ fields, sentence clue (generate / clear), alternatives, recordings (primary / delete), delete note — online | `CardEditModal.tsx` | `ui/study/EditCardSheet.kt` |
| ⋯ menu: fun fact, regenerate audio, new voice, roleplay, Write it (→ H strokes), flag for tutor | ✅ Write it opens H's `WritingSheet` over the card | `StudyMoreMenu.tsx`, `FlagCardSheet.tsx` | `CardExtrasUi.kt` `studyMenuItems` |
| Flag for tutor (offline, idempotent `POST /api/card-flags` via Outbox) | ✅ tutors from the cached relationships | `services/cardFlags.ts` | `CardTools.flag`, `FlagCardSheet` |
| Tutor notes on the card back (recording marks, flag replies; cached for offline) | ✅ `study-notes` sync step, seen via Outbox | `services/recording-notes.ts`, `TutorNoteLine.tsx` | `ui/study/TutorNotes.kt`, `TutorNoteLine` |
| Sentence tools: "What's going on here?", + Add as card, regenerate set | ✅ breakdown with tappable words (cached), add as card (deck picker, duplicate warning), new set / add 5 / custom / clear, generate when empty | `SentenceSet.tsx`, `SentenceBreakdown.tsx` | `ui/study/Sentences.kt` |
| Tap a character → definition popup; pinyin under typed answer | ✅ definitions cached offline; pinyin from ICU Han-Latin (polyphones may differ from pinyin-pro) | `WordDefinitionPopup.tsx`, `pinyin-pro` | `WordDefinitionSheet`, `ui/study/Pinyin.kt` |
| Sentence set generated when rating Again | ✅ | `ensureSentenceSetForNote` | `CardTools.ensureSentenceSet` |
| Offline mode toggle / offline audio note | ✅ | `OfflineModeToggle.tsx`, `services/offlineMode.ts` | `OfflinePill`, `ui/study/StudyPrefs.kt` |
| First-card explainer | ✅ | `FirstCardExplainer.tsx` | `FirstCardExplainer` |
| Drop decks the server no longer has without a tombstone (`live_deck_ids`) | ✅ `core/…/GhostDecks.kt` parity-tested (`parity/fixtures/sync.ts`), applied in the incremental sync; contract-tested | `shared/decks/ghosts.ts` `findGhostDecks` | `data/Repository.kt` `incrementalSync` |

## B — Mini lessons & readers in the session (web: `StudyCustomLesson.tsx`, `ExerciseView.tsx`, `lesson-exercises.tsx`, `practice-exercises.tsx`, `StudyReader.tsx`)

Owns `ui/lessons/` (player + all exercise views + `/lessons`, `/lesson-attempts`), `ui/readers/` (reader view + `/readers`, `/readers/generate`), `core/…/Lesson*.kt` (spec model, answer check, FSRS-of-lessons), `parity/fixtures/lesson.ts`, `data/api/LessonsApi.kt`, `ReadersApi.kt`, the lessons/readers `FeatureSync`. The hook into the card flow (`LESSON_MIX_INTERVAL`, one reader a day) is one call from `StudyViewModel` — agree it with A.

| Feature | Status | Web source |
|---|---|---|
| Lessons cached for offline, mixed into the session every ~8 reviews, max 2 new, FSRS-scheduled by completion rating | ✅ parity-tested (`core/…/LessonSchedule.kt`, `data/lessons/`, `ui/lessons/StudyExtras.kt`); one-off homework lessons stay out and get their `done` event | `services/custom-lesson-study.ts`, `useStudySession.ts` |
| Exercises: note, scramble, choice, translate, match, describe_image, speak, listen_choice, listen_translate | ✅ (`ui/lessons/LessonExercises.kt`; illustrations + TTS cached for offline) | `lesson-exercises.tsx` |
| Exercise: sentence making (typed / handwritten; Claude check online, self-assessed offline) | ✅ | `practice-exercises.tsx` `SentenceMakingExercise`, `POST /api/lessons/sentence-feedback` |
| Exercise: writing — typed (auto-checked, wrong characters marked) | ✅ `diffHanzi` parity-tested (`core/…/LessonAnswers.kt`) | `WriteTypedExercise` |
| Exercise: writing — handwriting (stroke-order pad, sketch fallback offline) | ✅ H's stroke-order `WritingExercise` in recall mode (right only when written from memory, run kept in the attempt); sketch pad + self-assessment when the stroke data isn't on the phone; lesson characters prefetched in the sync | `WriteHandwritingExercise`, `components/strokes/WritingExercise.tsx` |
| Exercise: dictation (typed / handwritten) | ✅ typed (diff) and handwritten (stroke pad, characters hidden; sketch fallback offline) | `DictationExercise` |
| Exercise: oral expression (recorded, uploaded by media key via Outbox) | ✅ AAC recording; raw `PUT /api/lesson-attempts/:id/media/:key` from its own queue after the attempt lands (404 = wait), like the web | `OralExpressionExercise`, `uploadLessonAttemptMedia` |
| Exercise: conversation (two TTS voices, comprehension questions, transcript) | ✅ voices parity-tested; clips prefetched per voice | `ConversationExercise`, `hooks/useLessonClips.ts` |
| Lesson attempts: per-exercise answers + time, uploaded with the completion event | ✅ via the Outbox (idempotent by event id) | `StudyCustomLesson.tsx` |
| "My answers" (`/lesson-attempts`) | ✅ list + review (`ui/lessons/AttemptReview.kt` — reusable by F's tutor review) | `pages/LessonAttemptsPage.tsx` |
| Mini Lessons page (`/lessons`: pending + done, delete) | ✅ (Edit opens `/lessons/:id/edit`, package G) | `pages/MiniLessonsPage.tsx` |
| Graded readers in the session (one a day: due repeat → overdue → newest unread) | ✅ `pickTodaysReader` parity-tested; review events down by cursor, up through the Outbox; the reader closes out the session (`selectNextItem` order), rated with the FSRS bar; no reader due → today's story is requested once per local day and slotted in when it lands (20 s poll); illustrations + page narration cached for offline; one-off homework readers stay out and get their `done` | `services/reader-study.ts`, `services/readerSync.ts`, `StudyReader.tsx` |
| Readers list, reader page, generate a story, failed-generation row | 🟡 list (polls while generating, failed row with friendly reasons / Retry / Delete all — parity-tested), reading view (tap to reveal, narration, illustrations generated on demand, side by side unfolded), generate (decks / today's due cards, topic, difficulty). tap a word → add it to a deck (segmentation cached for offline). in-session waveform scrubber (anchor, play from it, regenerate). Missing: Anki export and Import JSON (the editors / export are package G's) | `ReadersListPage.tsx`, `ReaderPage.tsx`, `GenerateReaderPage.tsx`, `services/readerFailures.ts` |

## C — Decks tab (web: `DecksPage.tsx`, `DeckDetailPage.tsx`, `CardHubPage.tsx`)

Owns `ui/decks/` (incl. the `/decks` stub), `ui/cards/` (card hub), `data/api/DecksApi.kt`, `NotesApi.kt`, `core/…/Import*.kt` + `parity/fixtures/import.ts` (paste parser). Note writes go through the API (content service) and then a normal sync — never write Room directly except to mirror the answer.

| Feature | Status | Web source | Lab source |
|---|---|---|---|
| Deck queue list with due counts (same allocation as Home), study one deck, +10 More, Done ✓ | ✅ VM-tested | `DecksPage.tsx` | `ui/decks/DecksScreen.kt`, `DecksViewModel.kt` |
| Reorder deck queue (press-and-hold drag with auto-scroll, #N badge → move top / up / down / bottom) — mirrored at once, `PUT /api/decks/reorder` / `POST /api/decks/:id/move`, Outbox offline | ✅ `moveInOrder` / `moveToIndex` / `indexUnderPointer` parity-tested (moved to `shared/decks/queue.ts`) | `services/dragReorder.ts`, `QueuePositionMenu.tsx`, `services/deckOrder.ts` | `core/…/DeckQueue.kt`, `ui/decks/DragReorder.kt` |
| Card search (local-first with recent ratings + mastery, server fallback with "this device has N of M cards") | ✅ `noteMatches` / `stripTones` parity-tested (moved to `shared/decks/search.ts`); `?q=` deep links open the tab without the query | `services/noteSearch.ts`, `NoteSearchResults.tsx`, `GET /api/notes/search` | `core/…/NoteSearch.kt`, `DecksViewModel.kt` |
| New deck (+ Generate with Claude / starter deck entry), starter deck (`POST /api/decks/starter`) | ✅ online (the server fills the settings) | `AddDeckModal.tsx`, `DecksPage.tsx` | `NewDeckSheet` |
| Deck page: Study / "Try it as a student" (tutor account), progress (seen / mastered, per card type), words sorted by mastery with ratings, ▶ play, generate missing audio, regenerate audio (selection), 404 → "deleted" | ✅ from Room, works offline; progress is the web's local computation (no server activity strip) | `DeckDetailPage.tsx`, `DeckProgress.tsx` | `ui/decks/DeckScreen.kt`, `DeckViewModel.kt`, `DeckStats.kt` |
| Card editor (hanzi, pinyin, English, fun facts, alternatives, sentence clue + ✨ regenerate), add word, delete note, move notes (one, or many via long-press selection) | 🟡 card standard + required fields checked on the phone (`cardTextProblems` parity-tested), edits / deletes / moves queue in the Outbox offline; adding needs the server. Missing: the editor's audio recordings panel (record / Google TTS / MiniMax / set primary) and its sentence-set section | `CardEditModal.tsx`, `POST /api/decks/:id/notes`, `PUT/DELETE /api/notes/:id`, `POST /api/notes/move` | `ui/cards/NoteEditSheet.kt`, `NoteEditor.kt`, `data/decks/DeckWrites.kt`, `core/…/CardStandard.kt` |
| Card hub (`/cards/:noteId`: note, card states, flags + flag form (Outbox), resolve / reopen / delete, Claude threads, recent reviews + recordings) | ✅ cached for offline; before first load Room answers note / cards / reviews | `pages/CardHubPage.tsx` | `ui/cards/CardHubScreen.kt`, `CardHubViewModel.kt` |
| Deck settings (name, description, new / secondary caps) and delete deck (tombstone, gone locally at once) | ✅ `pickDeckSettings` parity-tested; legacy SM-2 fields stay in the main app (FSRS ignores them) | `DeckSettingsModal`, `PUT /api/decks/:id/settings`, `DELETE /api/decks/:id` | `DeckSettingsForm`, `DeckWrites.kt`, `core/…/DeckSettings.kt` |
| Note history modal | ➖ unreachable on the web (nothing opens it); the card hub covers it | `NoteHistoryModal` | — |
| Paste a list (parse, plan, fill gaps, ✨ write explanations, save, update students' copies) | ✅ `parseWordList` / `planImport` / pinyin helpers parity-tested (`core/…/Import.kt`); on-device pinyin via ICU (package A's `Pinyin`); 🟡 no "check the reading" hint for polyphonic single characters (pinyin-pro's `polyphonic` has no ICU equivalent) | `components/import/PasteWordsModal.tsx`, `services/wordImport.ts`, `shared/import/` | `ui/decks/PasteWords*.kt` |
| Generate a deck with Claude (`/generate`) | ✅ | `pages/GeneratePage.tsx`, `POST /api/ai/generate-deck` | `ui/decks/GenerateDeck.kt` |
| Anki export | ⬜ hand-off: ⋯ → Export → Anki opens the deck in the main app | `services/anki/` | |
| Share with tutor / Shared with Tutors | ⬜ | `DeckDetailPage.tsx`, `GET /api/decks/:id/tutor-shares` | |
| Try it as a student (`/decks/:id/try`, nothing recorded) | ⬜ (the button opens the placeholder) | `pages/DeckTryPage.tsx` | |
| One-off deck banner + "Add to my daily review" | ⬜ needs E's homework cache | `components/homework/OneOffDeckBanner.tsx` | |

## D — Progress & settings (web: `MyProgressPage.tsx`, `SettingsPage.tsx`)

Owns `ui/progress/` (incl. the `/progress` stub, `/progress/day/…`, `/study/review/:id`), `ui/settings/` (`/settings`, `/settings/sentences`, `/duplicate-finder`), `data/progress/`, `data/settings/`, `data/api/ProgressApi.kt`, `SettingsApi.kt`, `core/…/Progress.kt` + `OfflineMode.kt` + `Duplicates.kt`, `parity/fixtures/progress.ts`. More → Lab app rows stay in `ui/more/` (shell).

| Feature | Status | Web source |
|---|---|---|
| Progress: cards mastered, % through each deck, daily review counts, streak | ✅ from the phone's own events (offline); the numbers are `core/…/Progress.kt`, parity-tested against `shared/progress` (the definition the server's SQL follows — `my-progress-parity.test.ts`). Streak + 30-day heatmap, mastery ring, reviews-a-day chart (tap a bar → the day), % mastered per deck in queue order, the web's 30-day summary + daily list | `pages/MyProgressPage.tsx`, `components/StudyStreak.tsx`, `DeckDetailPage.tsx` mastery |
| Day detail / card on a day | ✅ local; the review's recording comes from the server when online (the phone keeps no recording URLs); 🎤 marker on the day list is web-only | `MyDayDetailPage.tsx`, `MyCardReviewDetailPage.tsx` |
| Session review | ✅ (server data, cached) | `SessionReviewPage.tsx` |
| Settings: study budget (`PUT /api/profile/study-budget`, writes `Prefs.budget`), Start on (`PUT /api/profile/landing-page`), Profile row (the bio moved there), offline audio line + Download now, backup (Save as…), sign out, sound / haptics | ✅ writes need a connection, like the web | `pages/SettingsPage.tsx` |
| Profile (`/profile`): display name, photo (pick → crop → 512px JPEG → `POST /api/profile/picture`, Use Google photo / Remove), About me, time zone, learner bio; About me + local time on the tutor / student page | ✅ `ui/profile/` (photo picker → crop sheet → 512px JPEG upload, live checks = `ProfileRules`, a port of `shared/profile` + the crop geometry, unit-tested with the web's cases); profile cached (`profile/me`), writes need a connection like the web; More user card + Account → Profile, Settings row. ➖ the Students-dashboard header chip / "Introduce yourself" nudge stay web-only for now | `pages/ProfilePage.tsx`, `components/profile/`, `shared/profile` |
| Offline mode (automatic + forced override) | ✅ Settings → Offline mode and the study top-bar pill (A) share ONE flag, `ui/study/StudyPrefs.forcedOffline`; labels from `core/…/OfflineMode.kt`; `fx/WordAudio` never streams while forced | `services/offlineMode.ts`, `OfflineModeToggle.tsx` |
| Advanced: audio quality (check / regenerate fallback clips), feature requests (list, detail + comments, 💬 send feedback), full sync + last-sync timings, send debug report, update app (→ GitHub releases) | ✅ | `SettingsPage.tsx` |
| Native playback panel, playback-quality report, debug console, copy debug dump | ➖ web / hybrid-app tools (the Lab has its own debug report + sync timings) | `SettingsPage.tsx` |
| Sentence coverage page (polling while jobs run, generate 20/100, clue audio, sync to this device) | ✅ | `SentenceCoveragePage.tsx` |
| Duplicate finder | ✅ (`core/…/Duplicates.kt`) | `DuplicateFinderPage.tsx` |

## E — Tutor tab for students (web: `ConnectionsPage.tsx`, `ConnectionDetailPage.tsx`, `ChatPage.tsx`)

Owns `ui/connections/` (incl. the `/connections` stub + role dispatch), `ui/chat/`, `ui/homework/` (student side), `ui/onboarding/`, `ui/claudechats/`, `data/api/ConnectionsApi.kt`, `ChatApi.kt`, `HomeworkApi.kt`, `core/…/Homework*.kt` + `parity/fixtures/homework.ts` (`shared/homework`: due labels, pass). Extends `data/api/RelationshipsApi.kt` DTOs additively.

| Feature | Status | Web source |
|---|---|---|
| Connections list + pending requests (accept / decline / cancel, email invitations, + Invite by email); tutor page (student view: Message → latest conversation or a new one, conversations, homework decks, decks you shared, ⋯ → Remove connection; Claude → New practice conversation) | ✅ cached for offline; avatars are initials (no remote pictures); 📹 Video call starts / joins the relationship's call (J), 🔴 Join banner while one is live; the Students dashboard / tutor's student page are F's slots in `ConnectionsNav.kt` | `ConnectionsPage.tsx`, `ConnectionDetailPage.tsx` |
| Unread badge on the Tutor (Students) tab | ✅ unread chat notifications, polled every 60 s + each sync (`ui/nav/TabBadges.kt`) — the web shows them on its header bell | `components/Header.tsx` |
| Chat (polling every 3 s) + message tools: Reply, Play (conversation TTS), ⋯ / long-press sheet with reactions (quick row + recents + full grid), Check my Chinese / View corrections, Translate & make flashcard / Make a card from this, Word by word (tappable words → definition → save), Discuss with Claude (persisted, quick actions, card suggestions), Copy; + Card from the conversation, 💡 Help me say it, new conversation (`?new=1`, `chat/new`), rename, voice settings (Claude), deck picker with pins + create deck; Claude practice chats answer with audio; call invites → Join | ✅ tool rules parity-tested (`core/…/MessageTools.kt`); history cached for offline (sending needs a connection, like the web — nothing is queued) | `ChatPage.tsx`, `components/chat/`, `InteractiveMessage.tsx`, `MessageDiscussionModal.tsx` |
| Cards you flagged (resolve / reopen / delete, open the card); Claude conversations (`/claude-chats`, threads, load older) | ✅ threads parity-tested (`core/…/QuestionThreads.kt`); the card link opens C's card hub (placeholder until native) | `components/cardFlags/`, `ClaudeChatsPage.tsx`, `shared/chats/threads.ts` |
| Homework card on Home ("From <tutor>") + Homework due list (overdue / due today / due in N days) | ✅ parity-tested (`core/…/Homework.kt`, `TutorHomework.kt`; `parity/fixtures/homework.ts`) | `components/home/HomeworkCard.tsx`, `components/homework/HomeworkDueCard.tsx`, `shared/homework/` |
| One-off homework pass (`/homework/:id`): word list with "Not yet" repeats, lesson / reader once; events offline via Outbox (`/api/me/homework/events`); "Add to my daily review" | ✅ word pass (offline, outbox, celebration); lesson / reader items play in the Lab's own players (`LessonPlayer` with `PlayerContext.Homework` — completion + attempt + recordings like a session; the session reader view with its rating), "hasn't reached this device" when the copy isn't local, done when already complete; finishing a lesson / reader anywhere records `done` in the same homework mirror the pass reads (`data/lessons/HomeworkLink.kt`, deterministic event id) and one-off-only ones stay out of the mix | `pages/HomeworkPassPage.tsx`, `HomeworkPage.tsx`, `shared/homework/pass.ts`, docs/HOMEWORK.md |
| One-off-only decks stay out of the daily new-card budget | ✅ the server caps the copy at 0 + 0; `HomeworkParityTest` checks the Kotlin budget gives such a deck nothing, like `allocateNewCards` | `shared/decks/budget.ts`, docs/HOMEWORK.md §1 |
| Lesson notes (`/lesson-notes`: add with files, list, delete) | ✅ list cached; saving needs a connection (as on the web) | `pages/LessonNotesPage.tsx` |
| First-open screen for invited students (`/api/me/onboarding`, cached) | ✅ the install row reads "Installed as an app" (it is one) | `components/onboarding/` |

## F — Teaching (web: `components/tutor/`, `pages/tutor/`)

Owns `ui/teaching/` (students dashboard, student page, insights, history, recordings, session notes, homework drafts, invites, queue moves, lesson attempt review — tutor side), `data/api/TeachingApi.kt`, `core/…/Load*.kt` if the load gauge is ported. Registers `/connections/{relId}/…` tutor routes in `ui/teaching/TeachingNav.kt`; the `/connections` root dispatch lives in E's file (one `if`). `/connections/{relId}` is registered in `TeachingNav.kt`: the student page when the other person is my student, else E's tutor page (a placeholder until E's screen replaces the `else` branch).

| Feature | Status | Web source | Lab source |
|---|---|---|---|
| Students dashboard (cards, pills, getting-set-up checklist, pending invites, homework decks) | ✅ cached for offline (TeachingSync); avatars are initials (no image loader yet) | `StudentsDashboard.tsx`, `StudentCard.tsx`, `SetupChecklist.tsx` | `ui/teaching/StudentsDashboardScreen.kt`, `TeachingSync.kt` |
| Student page: status, Message / Send homework / Video call, needs attention (hear recording), homework (+ queue #N moves, Update copy), mini lessons, conversations, activity, ⋯ (student's decks, remove) | ✅ two panes when unfolded; opens from the dashboard cache offline | `ConnectionDetailPage.tsx`, `QueuePositionMenu.tsx`, `StudentLessonsSection.tsx` | `ui/teaching/StudentPageScreen.kt`, `StudentPageSections.kt` |
| Send homework: one-off / long-term / both, due date, split over days, leave out known words, core / non-urgent; load gauge; assigned list (move date / cancel) | ✅ date maths + split parity-tested (`core/…/LoadPlan.kt`, `parity/fixtures/teaching.ts`); the load itself is server-computed | `SendHomeworkSheet.tsx`, `HomeworkModePicker.tsx`, `LoadGauge.tsx`, `AssignedHomeworkSection.tsx` | `ui/teaching/SendHomeworkSheet.kt`, `TeachingKit.kt` |
| Lesson notes → draft → review with Claude → assign | ✅ entries with their homework state (polls while drafting); the draft: load now → after, words / skipped (Include anyway, remove), per-item mode / due / split / queue, Claude chat (suggestions), Assign; Draft / Claude tabs on the phone, side by side unfolded | `LessonNotesSection.tsx`, `pages/tutor/HomeworkDraftPage.tsx` | `ui/teaching/HomeworkDraftScreens.kt`, `DraftViewModels.kt` |
| Session notes jobs (live progress, steps, what it made, Retry / Cancel / Delete, + Add notes) | ✅ polls every 3 s while a job runs | `SessionNotesSection.tsx`, `SessionNotesJobCard.tsx`, `SessionNotesSheet.tsx`, `pages/tutor/SessionNotesPage.tsx` | `ui/teaching/HomeworkDraftScreens.kt` |
| Insights (range, tiles, needs attention with every attempt + typed-answer diff, going well, also this period, Claude summary EN / 中文, lesson log), review history (filters, infinite scroll, by word), recordings inbox (Listened / Needs work / note, playback) | ✅ preset ranges cached (shared between Insights and Recordings), history's default view cached | `pages/tutor/StudentInsightsPage.tsx`, `StudentHistoryPage.tsx`, `RecordingsInboxPage.tsx`, `tutor-shared.tsx` | `ui/teaching/InsightsScreen.kt`, `HistoryAndRecordingsScreens.kt`, `TutorPagesKit.kt` |
| Student progress / day / card on a day / shared-deck progress (both directions) | ✅ cached | `StudentProgressPage.tsx`, `DayDetailPage.tsx`, `CardReviewDetailPage.tsx`, `SharedDeckProgressPage.tsx`, `components/DeckProgress.tsx` | `ui/teaching/StudentProgressScreens.kt` |
| Flagged cards (reply, resolve / reopen), Asked Claude (threads) on the student page | ✅ `groupQuestionThreads` ported (unit-tested) | `FlaggedCardsSection.tsx`, `ClaudeChatsSection.tsx`, `shared/chats/threads.ts` | `ui/teaching/StudentPageSections.kt` |
| Student card hub (tutor view: reply to flags, threads, reviews), all Asked-Claude conversations (paged) | ✅ reuses package C's `NoteHubDto` | `CardHubPage.tsx`, `ClaudeChatsPage.tsx` | `ui/teaching/StudentCardScreens.kt` |
| Lesson attempt review (`/connections/:relId/lesson-attempts`) | ✅ `/connections/{relId}/lesson-attempts[?lesson=]` and `/…/{attemptId}` registered in B's `ui/lessons/LessonsNav.kt`: the ONE `AttemptListScreen` / `AttemptDetailScreen` / `AttemptReview` for tutor and learner (`GET /api/relationships/:relId/lesson-attempts[/:id]`, JsonCache for offline re-open, polls while a recording transcribes), recordings playable; handwriting runs re-drawn stroke by stroke over the model outline (`ui/lessons/StrokeRunView.kt`, pure part `core/…/StrokeRunReview.kt`, unit-tested); entry points: student page Mini Lessons (📝 Answers) and library item assignments (`last_attempt_id`) | `pages/LessonAttemptsPage.tsx`, `components/lessonAttempts/AttemptReview.tsx` | |
| Invites (create with decks / Starter Chinese / welcome message / options, QR, copy / share, resend / revoke) | ✅ QR via zxing | `components/invites/`, `InviteQRSheet.tsx` | `ui/teaching/InviteSheet.kt` |

## G — Library, editors, catalogue (web: `pages/editor/`, `components/editor/`)

Owns `ui/library/` (incl. the `/library` stub), `ui/editor/` (lesson + reader editors, co-editor chats, print/export), `ui/catalogue/`, `data/api/LibraryApi.kt`, `EditorApi.kt`. Reuses B's exercise views for previews and Try it.

| Feature | Status | Web source |
|---|---|---|
| Lesson Library list, library item (assignments, push update), assign (Long-term = the library assign; One-off / Both with a due date = the homework model), New lesson (Draft with Claude, conversation lesson, blank), Import JSON, duplicate, archive | ✅ | `LessonLibraryPage.tsx`, `LibraryItemPage.tsx` |
| Try a lesson (`/library/:id/try`, nothing recorded) | ✅ the real `LessonPlayer` with `PlayerContext.Preview` (every exercise type, Try again / Done, nothing recorded); a spec that doesn't decode shows its validation problems (`ui/editor/LessonPreviewPane.kt`) | `LessonTryPage.tsx` |
| Exercise catalogue + sample-lesson trials (`/library/catalogue`; entry points: More → Teaching for tutor accounts, accounts with students and admins — the Lab More rows exist — plus the top of the Lesson Library) | ✅ registry + samples bundled (`core/…/spec/LessonCatalogue`, `resources/lesson/catalogue.json`, parity-checked); trials run in the real `LessonPlayer` (Preview, nothing recorded) | `ExerciseCataloguePage.tsx`, `shared/lesson/registry.ts`, `samples.ts` |
| Lesson editor (all 15 types) + Claude co-editor chat (proposal diff, accept/reject) | ✅ forms for every type, live validation (`LessonValidator`, parity-tested), auto-pinyin (`core/…/Pinyin.kt`, pinyin-pro 3.28 port, parity-tested), 🔊 lesson TTS, raw JSON, unsaved drafts kept on the phone; Edit / Preview / Claude tabs folded, form + chat side by side unfolded. Preview = the real `LessonPlayer` (Preview) with the web's ‹ › / restart / jump list; half-typed exercises say so instead of rendering (`Lessons.renderable`) | `LessonEditorPage.tsx`, `components/editor/` |
| Reader editor + co-editor, import JSON | ✅ page cards (拼音, Translate, Suggest, Illustrate, move / duplicate / insert / delete), `ReaderValidator` + `ReaderDiff` parity-tested, reading-view preview, image polling after save, `/readers/new/edit`. Import JSON: `rememberReaderImporter(nav)` (ui/editor/ReaderImport.kt) for B's readers list ⋯ | `ReaderEditorPage.tsx`, `NewReaderPage.tsx` |
| Exports (Markdown / JSON / CSV, print views) | ✅ built on the phone (`LessonExport` / `ReaderExport`, byte-identical to the TS), Share or Save (SAF); print views `/library/:id/print`, `/lessons/:id/print`, `/readers/:id/print` → system print / PDF. Anki (.apkg) opens the main app (↗) | `shared/lesson/export.ts`, `shared/reader/export.ts`, print pages |

## H — Coach, quests, stroke writing

Owns `ui/coach/`, `ui/analyze/`, `ui/quests/`, `ui/strokes/`, `core/…/Quest*.kt` + `core/…/Strokes*.kt` with `parity/fixtures/quest.ts` / `strokes.ts`, `data/api/CoachApi.kt`, `QuestsApi.kt`. Provides the stroke pad composable B and A reuse.

| Feature | Status | Web source | Lab source |
|---|---|---|---|
| Sentence Coach (`/coach?text=&c=`: language auto-detect, first reply coach / translate with retry-once-then-reason, saved conversations (cached for reading offline), follow-up chat with the tools, QUICK_ACTIONS chips word-for-word the web's, "Cards go to" deck picker (remembered), tool-result chips, a sync after cards / a lesson are made, inline notices) | ✅ rules unit-tested (`CoachRulesTest`). Markdown in replies (and the critique / grammar notes) is the kit's `MarkdownText` — the web's full react-markdown + GFM subset incl. tables | `SentenceCoachPage.tsx`, `utils/textLanguage.ts` | `ui/coach/`, `data/api/CoachApi.kt` |
| Sentence Breakdown (`/analyze`): input, examples, aligned hanzi / pinyin / English chunks, step / tap, play one / play all (MiniMax clips cached) | ✅ | `SentenceAnalysisPage.tsx`, `components/SentenceBreakdown.tsx` | `ui/analyze/` |
| Quests (`/quests`, `/quests/:id`): list, build (202 + polling with progress breadcrumbs), retry, delete, the playable tile map (springy character, bump on refusal, arrows, 拿起 / 放下 / verbs, Chinese toasts, 💡 targets, pinyin / English / button-pinyin toggles, goals + glossary menu, instructions read aloud, confetti + fanfare finish, completion queued via Outbox); levels saved for offline by `QuestsSync` | ✅ engine parity-tested: 260 generated worlds, 12k replayed actions, every state compared (`QuestParityTest`) | `QuestsPage.tsx`, `QuestPlayPage.tsx`, `shared/quest/` | `core/…/Quest.kt`, `ui/quests/`, `data/api/QuestsApi.kt` |
| Handwriting / stroke-order practice (`/practice/strokes?text=`: pick / type a word, recent words, Trace (animated order) + From memory (米字格), per-stroke verdicts with haptics/sounds, escalating hints (start dot → painted stroke → filled in), per-character glow, summary, offline "Save all") | ✅ matcher + quiz parity-tested (3,500 drawings, 170 quiz runs, bit-exact); reusable `WritingExercise` / `WritingSheet` / `WritingPad` for A ("Write it") and B (handwriting exercises). No auto-pinyin for typed words that aren't notes (web uses pinyin-pro) | `StrokePracticePage.tsx`, `components/strokes/`, `shared/strokes/` | `core/…/Strokes.kt`, `data/strokes/StrokeStore.kt`, `ui/strokes/` |

## I — Native shell (web: `native/android/`)

Owns `app/src/main/res/xml/`, widget / shortcut / notification classes under `shell/`, manifest entries for them (coordinate: one block each). Deep links already route through `LabNav.open`.

| Feature | Status | Hybrid source | Lab source |
|---|---|---|---|
| Home-screen widget: today's due count (the Study button's number, from Room — offline), "about N min", the homework due now, 学 Study / ✏️ Coach; redrawn after every sync, after a notification rating, hourly and at midnight; More → Lab app → "Add the home-screen widget" pins it | ✅ Robolectric + Roborazzi (RemoteViews, not Glance — no new dependency, same result) | `ShortcutsWidgetProvider.java`, `widget_shortcuts.xml` | `shell/DueWidgetProvider.kt`, `ShellSnapshot.kt`, `res/layout/shell_widget_due.xml` |
| Launcher shortcuts Study / Coach / Analyze (`lab_*` ids, `chineselearning-lab:///…` links) | ✅ | `res/xml/shortcuts.xml` | `res/xml/shell_shortcuts.xml` |
| Select text anywhere → "Coach (Lab)" (`PROCESS_TEXT` → `/coach?text=`; native coach once H registers it, placeholder → main app until then) | ✅ | `ProcessTextActivity.java` | `shell/ProcessTextActivity.kt` |
| Due-card notifications: hourly check (sync first if online), hanzi → Show answer (pinyin, meaning, example) → Again / Good / Easy with intervals, recorded as a REAL local review (`Repository.recordReview`, uploaded by sync / the upload worker — works offline), "✓ Good · back in 4d" + Next card; quiet 22:00–08:00; silent when off, not permitted, signed out, a tutor account or nothing due; a stale one is withdrawn after a sync; tap → study | ✅ unit + Robolectric (rating = in-app review, same state) | `HomeworkWorker.java`, `HomeworkNotifier.java`, `HomeworkActionReceiver.java` | `shell/Shell.kt`, `ShellRules.kt`, `NotificationReview.kt`, `ShellNotifier.kt`, `DueCheckWorker.kt` |
| Homework due today / overdue notification (one-off, once a day per assignment; tap → `/homework[/:id]`) | ✅ (own `shell/homework` cache of `GET /api/me/homework`; E's homework sync can replace it) | docs/HOMEWORK.md, `shared/homework/due.ts` | `shell/HomeworkFeed.kt` |
| Notification permission (Android 13+: asked once after sign-in) + More → Lab app → "Due-card notifications" toggle | ✅ | `MainActivity.setUpHomeworkNotifications` | `shell/ShellPermission.kt`, `ShellRows.kt` |
| Hybrid `route` extra and `chineselearning-lab:///<route>` links from outside | ✅ | `MainActivity.extractRoute` | `shell/ShellLinks.kt`, `MainActivity.kt` |

## J — Video calls (last)

Owns `ui/calls/`, `data/api/CallsApi.kt`, `data/calls/` (upload queue, recorder glue), `core/…/calls/` (board ops, transcript helpers, protocol, Ogg/Opus muxer, piece/chunk recorder), `parity/fixtures/calls.ts`.

| Feature | Status | Web source | Lab source |
|---|---|---|---|
| Whiteboard ops (sanitize / apply / undo target) + transcript helpers (merge, turns, offsets) | ✅ parity-tested (`parity/fixtures/calls.ts` → `CallsParityTest`) | `shared/calls/board.ts`, `transcript.ts` | `core/…/calls/CallBoard.kt`, `CallTranscript.kt` |
| `/calls`: start a call (per active tutor / student, or a solo test call), past calls with state (notes ready / transcript ready / processing…), LIVE rows → the call | ✅ cached for offline, refreshes every 15 s like the web | `CallsListPage.tsx` | `ui/calls/CallsListScreen.kt` |
| `/calls/:id/review`: summary + topics, corrections, words → "Add N cards" (new deck or one of mine), before next time, transcript turns with ▶ per line (plays that stretch of the speaker's piece) and 拼音 / EN toggles (pinyin made on the phone when the transcriber gave none), whiteboard snapshot, chat, Process now / Transcribe again, Delete (creator), live banner → Join, "still uploading from this phone" | ✅ polls every 5 s while processing; cached for offline | `CallReviewPage.tsx`, `boardRender.ts` | `ui/calls/CallReviewScreen.kt`, `BoardCanvas.kt` |
| Tutor: "Make homework from this lesson" with the session-notes job card (progress, retry / cancel / delete) | ✅ | `CallHomeworkSection.tsx` | `CallReviewScreen.kt` (reuses F's `SessionJobCard`) |
| Recording upload queue: register → raw chunks → close through the Outbox (Room, survives process death), drained during the call / after sync / by SyncWorker; open pieces of a killed app closed on the next sync | ✅ unit-tested against a fake server (`CallUploadsTest`) | `services/calls/uploads.ts` | `data/calls/CallUploads.kt`, `Outbox.enqueueRaw` |
| Recording pieces (5 min, standalone files) in 10 s chunks, piece start on the server clock | ✅ logic unit-tested (`PieceRecorderTest`, `OggOpusTest`): Opus in Ogg (`audio/ogg`, which the server already accepts) instead of MediaRecorder's webm | `services/calls/recorder.ts` | `core/…/calls/CallRecording.kt`, `OggOpus.kt` |
| Live call `/calls/:id`: pre-join preview (mic / camera toggles, "Record my microphone" — off with a reason below Android 10), permissions asked once with an Allow retry, 1:1 WebRTC video + audio (Google WebRTC, ICE + TURN from the join ticket), the same one-offerer negotiation as the web so phone ↔ browser calls connect, room socket with reconnect / backoff / ping / server clock, whiteboard (pen with live strokes, text tool, 5 colours, undo mine, clear for everyone), in-call chat with unread badge, mute / camera off (capture really stops) / flip camera / screen share (MediaProjection) / sound route (speaker · phone · headphones · Bluetooth) / record toggle, ● REC for either side, End for everyone or Leave, "Call ended" with the upload count | ✅ controller unit-tested with fake room / media / recorder (`CallControllerTest`), socket against a real WebSocket (`CallRoomSocketTest`), protocol + signals (`CallProtocolTest`); real WebRTC can't run in CI — first real calls are the device test. Immersive, keeps the screen on, a foreground service keeps mic / camera / screen share running with the screen off; rotation and fold/unfold keep the call (ViewModel); unfolded = stage + panel side by side | `CallPage.tsx`, `useCall.ts`, `peer.ts`, `room.ts`, `Whiteboard.tsx` | `ui/calls/CallController.kt`, `CallScreen.kt`, `Whiteboard.kt`, `CallRoute.kt`, `data/calls/CallRoomSocket.kt`, `rtc/PeerLink.kt`, `rtc/WebRtcMedia.kt`, `CallService.kt`, `CallAudio.kt` |
| Recording my mic during the call (5-min pieces, 10 s chunks, muted = silence) | ✅ WebRTC's echo-cancelled capture while a peer is connected, the phone's own mic when alone (test call / waiting), Opus via MediaCodec → Ogg; uploads drained every 5 s during the call | `recorder.ts` | `data/calls/MicRecorder.kt`, `rtc/MicTap.kt` |

## Not native

| Area | Status |
|---|---|
| Admin page: account inspect / role / delete | ➖ (admin is web + MCP only; More → Advanced → Admin opens the main app) |
| Invites / sign-up (`/join/:token`) | ➖ (sign-in only; accounts are made on the web) |

## Deliberate differences

- **"Introduced today" is derived from review events** (first-ever review of a card at or
  after local midnight; secondary if a sibling was reviewed first). The web keeps a live
  counter seeded the same way, but its seed compares a local date with UTC timestamps.
  Deriving it keeps devices consistent.
- **"Study 10 more" is keyed by the local date** (the web uses the UTC date).
- `YYYY-MM-DD HH:MM:SS` timestamps are parsed as UTC (V8 would read them as local time).
  No review event carries that shape; every client writes ISO strings.
- **More → Teaching** shows for accounts with students and admins (the web also shows it to an
  account with library items but no students, which needs a network call).
