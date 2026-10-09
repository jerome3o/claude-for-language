# CLAUDE.md - AI Agent Guide

This is a Chinese language learning app with spaced repetition. This document is for AI agents working on this codebase.

## Development Environment (IMPORTANT)

**Jerome has no local development environment.** All development happens through
Claude Code (remote) — i.e. you, the agent, working in the ephemeral cloud
container. Practical implications:

- **You are the only one who can run anything.** Jerome cannot run `npm run dev`,
  apply migrations, inspect logs, or test locally. Don't ask him to run commands
  or "try it locally" — run the checks yourself in this container (typecheck,
  `npm test`, `vite build`, `wrangler deploy --dry-run`) before reporting done.
- **Secrets live in GitHub Actions secrets**, not a local `.dev.vars`. To make a
  new secret reach the deployed Worker, add it to the "Set Worker Secrets" step
  in `.github/workflows/deploy.yml` (`echo "${{ secrets.NAME }}" | npx wrangler
  secret put NAME`). Setting it in the GitHub UI alone is not enough — the
  workflow must push it to Cloudflare.
- **The only path to a running/deployed app is merging to `main`** (CI in
  `deploy.yml` deploys on push to main). A feature on a branch is not live until
  it lands on main. Demos/verification of deployed behaviour therefore require
  the change to be merged.

## Agent Workflow: Feature Requests

**IMPORTANT — read before implementing anything.**

When asked to implement feature requests, use the MCP server tools in this order:

1. **List approved requests**: Call `list_feature_requests(approval_status: "approved")` to see what needs doing. Check the `agent_session_url` field — if it is set, another agent is already working on that request; skip it.

2. **Claim before you code**: Call `claim_feature_request(request_id, session_url)` using your CCR session URL (available in the system prompt as `ccr_session_url`, or find it in the conversation URL) **before** implementing. This prevents two agents from duplicating work. If the tool returns an error saying it's already claimed, skip that request.

3. **Only work on one request per session**: Implement one feature request per agent session. Do not claim or implement multiple requests in the same session unless they are trivially related.

4. **Mark done when finished**: Call `update_feature_request_status(request_id, "done")` after a successful deploy/PR.

## User Preferences (Jerome)

These are Jerome's stated preferences — respect them in all implementations:

- **Study sessions**: Drill ALL cards due today in one sitting (endOfToday, not "right now"). Show the same card immediately after rating — no cooldown wait screen.
- **Card types**: All three types (hanzi→meaning, meaning→hanzi, audio→hanzi) are fine as-is.
- **New cards per day**: ONE global daily budget per account — 3 new words + 6 secondary (purple) cards a day by default (`DEFAULT_STUDY_BUDGET` in `shared/decks/budget.ts`; Settings → "New cards a day") — filled from the deck queue top-down. A tutor can send as much homework as she likes; the budget decides his daily load, the queue decides which deck it comes from. A NEW deck's own limits (`DEFAULT_DECK_SETTINGS`, 3 + 6) are caps on how much of the budget that deck may take.
- **Audio recordings**: Queue locally, upload during background sync (offline-first). Tutor should be able to listen to recordings.
- **Offline mode**: Must work well on the train with low/no connection. Prefetch aggressively (audio, cards, etc.) — up to ~1GB is fine.
- **Progress metrics**: Cards mastered, percentage through each deck, daily review counts. Goal: know at a glance if making good progress.
- **Session end**: Should feel satisfying — celebration/confetti/sound for monkey brain motivation.
- **Claude chat**: Wants it more powerful — agent loop where Claude can edit the current card, interactively add/edit cards from a deck.
- **Device**: Google Pixel Pro Fold 10, installed as PWA, primarily folded mode but should work well unfolded too.
- **Backups/export**: Wants backup capability but not for Anki migration (already migrated from Anki).
- **Testing**: Values reliability and testing. Prefers isolated dev environments for feature work.

## Quick Start

```bash
# Install dependencies
npm install

# First-time setup: Create local D1 database
cd worker && npx wrangler d1 migrations apply chinese-learning-db --local && cd ..

# Create worker/.dev.vars with your Anthropic API key
echo "ANTHROPIC_API_KEY=your-key-here" > worker/.dev.vars

# Run locally (both worker and frontend)
npm run dev

# Run just the worker
npm run dev:worker

# Run just the frontend
npm run dev:frontend

# Deploy to Cloudflare
npm run deploy
```

For detailed setup instructions, see [docs/SETUP.md](./docs/SETUP.md).

## Project Structure

```
/
├── worker/                 # Cloudflare Worker (API backend)
│   ├── src/
│   │   ├── index.ts       # Main entry point, routes
│   │   ├── routes/        # Hono sub-routers mounted from index.ts (insights, lesson-editor, tutor-notes, test-auth, calls)
│   │   ├── durable/       # Durable Objects (call-room.ts — video-call signalling / whiteboard / chat)
│   │   ├── services/      # Business logic (FSRS scheduler, AI, TTS); services/content = the ONE write path for decks / notes / cards
│   │   ├── db/            # Database queries and migrations (lesson-library-queries.ts for the library/editor)
│   │   └── types.ts       # TypeScript types
│   ├── wrangler.toml      # Cloudflare Worker config
│   └── package.json
│
├── shared/                # Shared code between worker and frontend
│   ├── scheduler/         # FSRS spaced repetition algorithm
│   │   ├── compute-state.ts    # Core FSRS logic, state computation from events
│   │   ├── compute-state.test.ts # Tests for scheduler
│   │   └── index.ts       # Re-exports
│   ├── audio-lesson/      # Audio lessons (docs/AUDIO_LESSONS.md): plan types (DialoguePlan / SleepPlan / StoryPlan), compile.ts (plan → speech/pause script, RATES / PAUSES), story.ts (the story splitter, compileStoryLesson, the 60-min cap), validate.ts, timeline.ts (chapters / transcript in ms, player helpers), input.ts
│   ├── idioms/            # 成语 Idioms (beta, docs/IDIOMS.md): the entry shape (types.ts), starter list (~46), cache key + explorer link rule (normalize.ts), validator (validate.ts), "+ Add as card" fields (card.ts), sample entry — parity-tested by the Lab app
│   ├── picture-hunt/      # Picture hunt (看图找词): types (normalised boxes / outlines), answer matching (match.ts), hit-testing (geometry.ts), feedback copy, validation — parity-tested by the Lab app
│   ├── quest/             # Quests: the tile-map mini-game framework
│   │   ├── types.ts       # World schema (terrain, objects, verbs, goal conditions)
│   │   ├── engine.ts      # Pure game engine — movement, verbs, goal checking
│   │   ├── validate.ts    # Playability checks for generated worlds
│   │   └── index.ts       # Re-exports
│   ├── lesson/            # Custom mini lessons: agent-authored lesson schema
│   │   ├── types.ts       # Lesson spec (sections of exercises, 15 exercise types)
│   │   ├── registry.ts    # One entry per exercise type (name, icon, skill, how it's checked) — every type list reads it
│   │   ├── doc.ts         # LESSON_SPEC_DOC: the spec text every lesson-authoring Claude reads (worker + MCP)
│   │   ├── samples.ts     # Bundled sample lesson per type (tutor catalogue)
│   │   ├── voices.ts      # Conversation voices: curated MiniMax catalogue (default_on), enabled pools, per-dialogue rotation (conversationVoicesFor), 0.9× speed + 200 ms turn gap
│   │   ├── conversationAudio.ts # Conversation audio prefs (speed / delivery / voices per provider, per-conversation choices), resolveConversationAudio — docs/AUDIO.md "Conversation audio"
│   │   ├── introWarnings.ts # Soft warning: a note before a conversation that quotes its dialogue (spoiler intro)
│   │   ├── answer-check.ts # Typed-hanzi checking + character diff (diffHanzi)
│   │   ├── attempt.ts     # Per-exercise attempt data (answers, time, recordings) + server sanitizer
│   │   ├── validate.ts    # Structural validation for agent-authored specs
│   │   ├── diff.ts        # Structural diff of two specs (editor chat proposals, "what changed")
│   │   ├── export.ts      # Markdown / JSON / CSV exporters (pure; used by worker and offline frontend)
│   │   └── index.ts       # Re-exports
│   ├── calls/             # Video calls: whiteboard ops, WebSocket protocol, transcript merge, video fit / PiP (videoFit.ts), the shared text board CRDT (textDoc.ts), board pages across lessons (pages.ts), call alerts (alerts.ts), drawing on a shared screen (annotate.ts), board tab-complete rules (gloss.ts), Same view — one shared stage for both, My own view, Bring to my view (view.ts), Stop their share (follow.ts), camera on at join (devices.ts) (see docs/VIDEO_CALLS.md)
│   ├── call-activities/   # In-call activities: two-person mini lessons (describe & guess, info gap, role-play, sentence building, quick quiz, dictation) — spec types, the state machine the CallRoom runs (engine.ts), the sample catalogue; parity-tested by the Lab app
│   ├── materials/         # Lesson materials: kinds, limits, page text, `material:<id>:<page>` annotation targets, presented-material shape, PPTX_RENDER_NOTE
│   ├── chats/             # groupQuestionThreads: Ask-Claude Q&A rows → per-card conversations (student + tutor pages, MCP); inbox.ts = the Chats tab rules (sort, preview, relative time, search, badge, live updates) — parity-tested by the Lab app
│   ├── study/             # "Today is the session": active study time per day (activeTime.ts), resume the card left on screen (resume.ts), celebrate-once rule (celebration.ts), the "revisit later" schedule of mini lessons + "New lessons a day" (revisit.ts), graded readers read once / one a day / ▶ Play whole story (daily-reader.ts) — parity-tested by the Lab app
│   ├── progress/          # Progress numbers (daily 30-day summary, day cards, streak, mastery): the definition the server's /api/progress SQL follows (worker my-progress-parity test) and the Lab app ports
│   ├── folders/           # Folders for decks / library lessons / readers: groupIntoFolders, one-level nesting rule (parentProblem), name rules, spliceGroupOrder, collapsed keys, copy (deleteFolderMessage, movedMessage) — parity-tested by the Lab app
│   ├── explorer/          # The language explorer (docs/LANGUAGE_EXPLORER.md): the view stack (stack.ts: open / push / pop / popTo / close, breadcrumbTrail, itemForText), Word view facts (word.ts: wordChars + tones, wordFrequencyLabel, resolveWord dictionary-first), related words (related.ts), ExplorableText's segments (segments.ts), quick drills (drill.ts) — parity-tested by the Lab app
│   ├── chars/             # The character dictionary (card-independent): CharRecord, build rules from CC-CEDICT / Make Me a Hanzi / wordfreq (build.ts, msgpack.ts; scripts/build-char-dict.ts), the sheet's word statuses known / in_decks / none (status.ts — parity-tested by the Lab app)
│   ├── pinyin/            # applyYiBuToneChanges: the 一 / 不 tone changes every automatic pinyin goes through (Lab ToneChange.kt, parity-tested)
│   ├── decks/             # DEFAULT_DECK_SETTINGS (3 new + 6 secondary a day) + pickDeckSettings validation — the one definition of a new deck; budget.ts / study-queue.ts / novelty.ts / new-card-order.ts ("Order new cards by": new characters, new words, most common, sentences last) + frequency.ts (the shipped wordfreq list, `shared/data/frequency/word-freq.txt`); the study queue ("due today", introduced today, Home counts: study-queue.ts); queue moves + drag hit-test (queue.ts), card search noteMatches (search.ts), "⚡ Study it today" bump pocket (bumps.ts) — all parity-tested by the Lab app
│   ├── recordings/        # "Needs your ear": queue rule + labels (queue.ts), transcript ↔ card comparison (transcript.ts), mix-ups (mixups.ts) — docs/RECORDING_REVIEW.md
│   ├── text/              # numberHanzi.ts: number ↔ hanzi normalisation (transcripts, typed answers)
│   ├── students/          # The tutor's private student profile: validation, the prompt block every tutor-side content agent reads (studentProfilePrompt), examples, chips
│   ├── profile/           # Editable profile: pickProfileUpdate (name / bio / about / time zone → problems), limits, localTimeLabel
│   ├── homework/          # Homework assignments (docs/HOMEWORK.md): due labels, split over days, the one-off pass, dedupe, load gauge, draft plan, Home's compact card rows (home.ts), the tutor's homework library + statuses (library.ts), link homework (link.ts), the one-off headline + long-term decks (summary.ts) — pure, unit-tested
│   ├── tutor-notes/       # "Notes from your tutor": new / earlier merge, Home line, the practice rule (a rating counts only when the card is due) — parity-tested by the Lab app
│   ├── debug/             # Study-state debug reports: ONE report shape (web + Lab app), eventIdHash, compareDebugReports (pure diff)
│   ├── strokes/           # Handwriting practice: pure stroke matcher (right stroke / order / direction) + per-character quiz + result shapes (docs/STROKE_ORDER.md)
│   ├── import/            # "Paste a list" word importer: pure parser (separators, column roles), planner (add / update by hanzi), pinyin helpers
│   ├── tts/               # TTS provider settings (TtsConfig: stored / live order, voices, max RPM, conversation_rate), voice catalogues, validation, speed mapping (docs/AUDIO.md "Providers"); conversation.ts = conversation rates / voices / deliveries per provider
│   └── reader/            # Graded readers as one spec (reader editor, Claude co-editor, exports)
│       ├── types.ts       # ReaderSpec (titles, difficulty, topic, vocabulary_used, ordered pages)
│       ├── validate.ts    # validateReaderSpec / normalizeReaderSpec
│       ├── diff.ts        # Page-level diff (added / removed / moved / changed by id, content or similarity)
│       ├── export.ts      # Markdown / re-importable JSON / Quizlet CSV
│       ├── words.ts       # Word chips: alignReaderWords (concat invariant), parseReaderWords, sentenceAround
│       ├── audioBlocks.ts # Page narration → phrase blocks at the pauses (RMS envelope, adaptive threshold) — parity-tested by the Lab app
│       └── blockPlayback.ts # The scrubber's restart point: advance per block, pause → this block (or the previous within 1 s) — parity-tested
│
├── frontend/              # React + Vite frontend
│   ├── src/
│   │   ├── components/    # React components (components/editor/ = lesson editor shell, chat, forms; components/tutor/ = students dashboard, setup checklist, send-homework sheet)
│   │   ├── components/nav/ # Bottom tab bar (TabBar), role derivation (useNavRole), landing rule (landing.ts), maintenance actions
│   │   ├── pages/         # Page components (StudyPage, DecksPage, MorePage, DeckDetailPage, etc.; pages/editor/ = library + editor)
│   │   ├── services/anki/ # Client-side Anki .apkg export (sql.js + JSZip): builder, deck/lesson/reader adapters, audio resolution
│   │   ├── components/import/ # PasteWordsModal — paste a word list, preview add / update rows, fill gaps, save, update students' copies
│   │   ├── components/export/ # AnkiExportModal — options / progress / result UI (lazy-loads services/anki)
│   │   ├── hooks/         # Custom React hooks (useAudio, etc.)
│   │   ├── api/           # API client functions
│   │   └── types.ts       # TypeScript types
│   ├── vite.config.ts
│   └── package.json
│
├── mcp-server/            # MCP Server for AI assistant integration
│   ├── src/
│   │   └── index.ts       # MCP tools and server setup
│   ├── wrangler.toml      # Separate worker config (shares D1 database)
│   └── package.json
│
├── android-lab/           # Experimental PURE-NATIVE Android app (Kotlin + Compose), beside the hybrid app — see android-lab/README.md
│   ├── core/              # Pure Kotlin ports: FSRS (ts-fsrs), budget, study queue, answer check, Anki .apkg ids / GUIDs / rows (core/…/anki, the app writes the SQLite + zip) — parity-tested against the TS
│   ├── parity/            # generate-fixtures.ts: runs the web app's TypeScript to make the golden vectors
│   ├── app/               # Android app: Room mirror + sync (same API), Compose UI, haptics/sounds; ui/nav = web tab bar + routes by web path (FeatureGraphs registry), data/platform = JsonCache + Outbox
│   ├── docs/UI_KIT.md     # Shared Compose pieces + screenshot helper
│   └── PARITY.md          # Parity checklist, split into work packages A–J with file ownership
│
├── native/                # Capacitor Android wrapper (see native/README.md)
│   ├── capacitor.config.json  # Remote server.url points at the deployed PWA
│   ├── android/           # Native project: widget, PROCESS_TEXT, deep links
│   └── www/               # Placeholder only (app loads the live site)
│
├── docs/                  # Documentation
│   ├── SPEC.md           # Feature specification
│   ├── TUTOR_GUIDE.md    # End-user guide for tutors & students (zh-CN version alongside; screenshots in guide-images/)
│   ├── ARCHITECTURE.md   # Technical architecture
│   └── SETUP.md          # Setup and deployment guide
│
├── e2e/                   # End-to-end tests (Playwright)
│   ├── tests/
│   │   ├── fixtures/     # Test fixtures (auth, etc.)
│   │   └── *.spec.ts     # Test files
│   └── playwright.config.ts
│
├── .github/workflows/     # GitHub Actions
│   ├── deploy.yml        # Auto-deploy all services on push to main
│   ├── e2e-tests.yml     # E2E tests on PRs and main
│   ├── android-build.yml # Builds the sideloadable Android APK (native/)
│   └── android-lab-build.yml # Tests (incl. TS parity) + builds the Lab app; pre-releases lab-v* on main
│
└── package.json          # Root package.json (workspaces)
```

## Native Lab app (android-lab/) — keep it at parity

`android-lab/` is a pure-native Android app (its own id `dev.jeromeswannack.chineselearning.lab`,
installed beside the hybrid app, published as `Lab v0.N` GitHub **pre-releases** by
`.github/workflows/android-lab-build.yml`). It uses the same API and review events as the web app.
Jerome wants it at **full feature parity with the web app, to the same standard**:

- **When you implement or change a user-facing feature in the web app, implement it in the Lab app
  too, in the same PR** — spawn a subagent following `.claude/skills/native-parity/SKILL.md` (it has
  the brief to give it) and review its work like your own. If the native half truly can't land in
  that PR, update its row in `android-lab/PARITY.md` (⬜/🟡 + what's missing).
- Logic that must match (FSRS, budget, queue, answer checking) lives in `android-lab/core` and is
  **parity-tested against the TypeScript**: `./gradlew :core:test` regenerates golden vectors by
  running `shared/scheduler`, `shared/decks/budget.ts` and `frontend/src/utils/numberHanzi.ts`.
  Changing those TS files without the matching Kotlin change turns the Lab build red.
- **Crashes are reported**: `data/CrashLog.kt` writes an uncaught exception's stack trace before the
  process dies, records caught background failures (`LabApp.scope`'s handler, `app.safely { }`) and
  reads Android's exit records (crash / ANR with its thread dump / low memory); all ride along in the
  next debug report (`crashes`, summary visible in the MCP `list_debug_reports`). Non-critical
  start-up work (Home / Today / Progress loads, landing counts, widget, audio fixer, "new characters
  first") must go through `app.safely` / `app.scope` so a failure is reported, never a crash.
- Native sign-in: `/api/auth/login?client=lab&nonce=…` → callback redirects to
  `chineselearning-lab://auth?session_token=…&nonce=…` (`NATIVE_AUTH_CLIENTS`, `services/auth.ts`).
- **Google Play internal testing**: each `main` build also runs `:app:bundleRelease` (same key = the
  Play *upload key*), attaches `chinese-learning-lab-v0.N.aab` to the pre-release and uploads it to the
  internal track when `PLAY_SERVICE_ACCOUNT_JSON` is set (non-fatal; warning annotation on failure).
  `versionCode` = the workflow run number for APK and AAB. `targetSdk` must meet Play's current
  target-API rule. Setup + the Play-vs-Obtainium signing caveat: [android-lab/PLAY.md](android-lab/PLAY.md).
  The public privacy policy Play links to is `/privacy` (`frontend/src/pages/PrivacyPage.tsx`).

## Key Concepts

### Content service (decks, notes, cards) — the one write path

`worker/src/services/content/` is the semantic layer every deck / note / card write goes through:

```
route / Ask-Claude tool / coach tool / queue job / MCP (via HTTP)  →  services/content  →  db/queries  →  D1
```

- `decks.ts` — `createDeck` (fills the row from the shared `DEFAULT_DECK_SETTINGS`), `updateDeck`,
  `updateDeckSettings` (validated with `pickDeckSettings`; 400 + `problems` on bad values), `deleteDeck`
  (tombstones + R2 clean-up), `copyDeckForUser` (tutor → student copies: a NEW deck with the defaults,
  notes copied with their clips and fresh cards).
- `notes.ts` — `createNote` / `createNotes` (validate, insert note + the 3 cards, then the side effects by
  `audio` mode: `background` = waitUntil, `queue` = `note_audio` job, `await`, `none`; sentence set queued),
  `updateNote` (a changed hanzi regenerates the word clip, a changed clue regenerates the sentence clip),
  `deleteNote`, `moveNotes`.
- `audio.ts` — `setNoteAudio` (store + propagate to student copies), `ensureNoteAudio`,
  `ensureSentenceClueAudio`, `enqueueSentenceSet`, `deleteUnreferencedAudio` (a tutor's note and the
  student's copy share R2 keys, so a delete only removes clips nothing else points at).
- **New-deck defaults live in `shared/decks/defaults.ts`** (`DEFAULT_DECK_SETTINGS`: 3 new + 6 secondary
  cards a day). Change them there and every creation path follows — the app, Generate with Claude, JSON
  import, the starter deck, share / invite copies, the MCP tools. Existing decks are untouched. The D1
  column DEFAULTs are legacy.
- `db/queries.ts` is the raw SQL layer (`createDeck` takes the full settings row, `createNote` takes a
  `NoteRowInput` incl. the sentence clue, `insertCardsForNote` is the single card generator,
  `insertNoteCopy`, `moveNotes`). Nothing outside `services/content` should INSERT / UPDATE / DELETE
  decks, notes or cards (exceptions: card *scheduling* writes from reviews, `routes/test-auth.ts` cleanup).
- The MCP server never writes D1 for content: its deck / note tools call the API
  (`POST /api/decks`, `PUT /api/decks/:id[/settings]`, `DELETE /api/decks/:id`, `POST /api/decks/:id/notes`,
  `POST /api/decks/:id/notes/batch`, `PUT|DELETE /api/notes/:id`, `POST /api/notes/move`).

### Data Model
- **Note**: The source of truth. Contains hanzi, pinyin, english, audio URL, fun facts.
- **Card**: Generated from Notes. Three types per note:
  1. `hanzi_to_meaning`: Show hanzi → user speaks → reveal audio/pinyin/english
  2. `meaning_to_hanzi`: Show english → user types hanzi → reveal audio/pinyin/hanzi
  3. `audio_to_hanzi`: Play audio → user types hanzi → reveal pinyin/hanzi/english
- **Deck**: Collection of Notes (and their generated Cards)
- **ReviewEvent**: Individual card review (rating, time, audio recording). Card state is computed from review history.

### Spaced Repetition (FSRS Algorithm)

The app uses **FSRS (Free Spaced Repetition Scheduler)**, a modern algorithm based on the DSR (Difficulty, Stability, Retrievability) memory model. It's more efficient than SM-2, requiring ~20-30% fewer reviews for the same retention.

#### Card State Fields (FSRS)
- `stability`: Memory stability in days (how long until recall probability drops to 90%)
- `difficulty`: Card difficulty (1-10 scale, lower = easier)
- `lapses`: Times the card was forgotten (Again pressed while in Review state)
- `reps`: Total successful reviews
- `queue`: Current state - NEW (0), LEARNING (1), REVIEW (2), RELEARNING (3)
- `next_review_at`: When to show card next

#### Legacy Fields (backward compatibility)
- `ease_factor`: Approximated from stability for display
- `interval`: Same as scheduled_days
- `repetitions`: Same as reps

#### Ratings
- `again` (0): Forgot the card → short interval, +1 lapse if in Review
- `hard` (1): Difficult recall → shorter interval
- `good` (2): Normal recall → standard interval
- `easy` (3): Easy recall → longer interval, skips learning phase for new cards

#### New Card Intervals (with short-term scheduling)
| Rating | Interval | Next State |
|--------|----------|------------|
| Again  | ~1 min   | Learning   |
| Hard   | ~6 min   | Learning   |
| Good   | ~10 min  | Learning   |
| Easy   | ~2 days  | Review (skips learning) |

#### Key Implementation Files
- `shared/scheduler/compute-state.ts` - Core FSRS algorithm using `ts-fsrs` library
- `shared/scheduler/index.ts` - Re-exports types and functions
- `frontend/src/services/anki-scheduler.ts` - Frontend wrapper
- `worker/src/services/anki-scheduler.ts` - Worker wrapper

### Database Tables
- `users` - User accounts
- `decks` - Vocabulary decks
- `notes` - Vocabulary items (hanzi, pinyin, english, audio_url, fun_facts)
- `cards` - SRS cards (3 per note, one per card_type)
- `review_events` - Individual review records (rating, time, answer, recording_url). Card state is computed from these.
- `card_checkpoints` - Cached card state for performance (computed from review_events)
- `deleted_items` - Tombstones (`kind` deck|note, `item_id`, `deleted_at`) written whenever a deck or note is deleted (API routes, Ask Claude's delete_current_card, the MCP server's delete_deck/delete_note); `GET /api/sync/changes` returns them as `deleted.deck_ids` / `note_ids` so offline clients drop the rows (with their cards) on the next sync
- `reader_pages.words` / `reader_word_explanations` - Reader word chips (migration 0087): the page split into `{ text, pinyin, gloss }` segments (JSON), and Haiku's cached "More about this word" answers keyed by a hash of word + sentence. See "Reader word chips"
- `char_explanations` - "More about 字" on the character sheet: Haiku's short card-independent explanation per character, shared by everyone (migration 0108). The dictionary itself is static (`worker/char-dict/`, see "Character sheet")
- `note_questions` - Q&A from Ask Claude feature (question, answer, asked_at; migration 0116: `answer_lang` zh|en, word chips `answer_words` / `question_words`, `answer_translation` / `question_translation`, `question_check` = the auto-check JSON of the question). Listed per user (`GET /api/me/claude-chats`) and per student for the tutor (`GET /api/relationships/:relId/claude-chats`), grouped into threads client-side by `groupQuestionThreads` (`shared/chats/threads.ts`)
- `notes.check_issues` / `notes.check_at` / `users.card_check` / `deck_check_jobs` - Word checks (migration 0104): open "⚠ Possible issue"s on a note (JSON, `shared/cards/check.ts`), when they last changed (synced like `long_term_at`), the "Check new words" switch (NULL = on for tutors), and per-deck "Check for errors" runs (deck, the deck's owner, relationship + source deck for a tutor checking a student's copy, status, progress, proposals JSON, tokens). See "Word checks"
- `audio_lessons` - Audio lessons (migration 0046 reused + 0111; docs/AUDIO_LESSONS.md): format dialogue|sleep|story (TEXT, no CHECK), status queued/writing/speaking/rendering/ready/failed, progress + clips done/total, input, the agent transcript, plan, script, timeline (chapters + transcript), words, `audio_key` (R2 `audio-lessons/`), usage, pinned `zh_provider`, `for_relationship_id` (a label only). Rows with `format` NULL are the removed first attempt
- `podcast_feeds` - The private podcast feed of a user's audio lessons (migration 0112): one row per user, `token_hash` (SHA-256, how a feed request finds the user), `token_enc` (AES-GCM, so Settings can show the link again), created / rotated / last fetched, fetch count. Reset = new token; Turn off = row deleted
- `card_flags` - A student flags one card for their tutor with a note (relationship, student, tutor, note, card, message, status open/resolved, tutor_reply, student_seen_reply_at). Migration 0070. See "Card flags & card hub" below
- `note_sentences` - Graded sentence set per note (position, hanzi, pinyin, translation, audio_url, focus, explanation). Written as whole sets; synced to IndexedDB for offline study.
- `note_sentence_jobs` - Tracks which notes have been queued for background sentence-set generation (status, attempts)
- `idioms` - 成语 Idioms (migration 0115, docs/IDIOMS.md): ONE generated entry per idiom for every account, keyed by the normalised hanzi (status generating/ready/failed/not_idiom, `entry` JSON per `shared/idioms`, error, suggestion, attempts, generator_version, view_count). No user ids
- `quests` - Generated tile-map mini-games (title, difficulty, status, `world` JSON, best_moves)
- `picture_hunts` / `picture_hunt_plays` - Picture hunts (migration 0082): source upload|generated, prompt, deck_ids, `image_key` (R2 `picture-hunts/<id>.<ext>`, protected — personal photos), size, status generating/ready/error + `progress`, `objects` JSON (`shared/picture-hunt`), best_found / play_count (recomputed from plays); plays are client-id rows (found_ids, hints_used, gave_up, duration)
- `custom_lessons` - Agent-authored custom mini lessons (`spec` JSON per shared/lesson; status active/done). `library_item_id` / `assigned_by` / `assigned_relationship_id` link a student's copy back to the tutor's library item
- `custom_lesson_completions` - Idempotent offline completion events for custom lessons (the rating sets when it comes back)
- `revisit_events` - "Done for good" / "Bring back" on a mini lesson (migration 0110; item_kind lesson|reader — `reader` rows are legacy and ignored since readers are read once —, item_id, action retire|restore, client id). With the ratings they make the "revisit later" schedule (`shared/study/revisit.ts`); `users.revisit_settings` = the account's gaps + `new_lessons_per_day` (JSON, NULL = defaults)
- `lesson_images` - describe_image pictures, ONE per scene description (`prompt_hash` = SHA-256 of the normalised `image_prompt`, status pending/ready/failed, `image_key` = R2 `lesson-images/<hash>.<ext>`, attempts, error). Migration 0079. See "Lesson pictures" below
- `custom_lesson_attempts` / `custom_lesson_attempt_media` - Per-exercise answers + time of a lesson run (id = the completion event id, spec snapshot, `data` JSON per `shared/lesson/attempt.ts`) and the recordings made in it (R2 key, transcript). Migration 0074
- `lesson_library` - A tutor's master copies of mini lessons (spec, tags, version, archived_at)
- `editor_chats` / `editor_chat_messages` - Per-user Claude side-chat for an editor target (`target_type` 'lesson' | 'library' | 'reader', extensible); messages keep a spec snapshot and, for assistant turns, the proposed spec + accepted/rejected status
- `invites` - Invite links / email-bound invites for new sign-ups (the id is the bearer token in `/join/<id>`; created_by, email, inviter_role, share_deck_ids, max_uses/use_count, expires_at, revoked_at)
- `invite_redemptions` - Which user redeemed which invite (idempotent by pair)
- `access_requests` - Uninvited Google sign-in attempts (email, attempts, status pending/approved/dismissed) for the admin to approve
- `tutor_note_jobs` - Session-notes agent jobs (relationship, tutor, student, notes, priority, auto_share, status queued/running/done/failed/cancelled, progress, `steps` JSON, `transcript` JSON checkpoint, rounds, `result` JSON, error). Migration 0072. See "Session notes → homework agent"
- `assignments` / `assignment_events` - Homework (migration 0073, docs/HOMEWORK.md): what (`kind` deck|lesson|reader + the student's copy `target_id`), `mode` one_off|fsrs|both, `due_date` (student's calendar day), `item_ids` (a deck part's notes), split `part_index/part_count`, `status`/`done_count` recomputed from the student's pass events (right|wrong|done, idempotent by id). NOT the legacy reader-only `homework_assignments` (0024, unused)
- `homework_links` - A tutor's link homework (migration 0102; docs/HOMEWORK.md §8): title, url, instructions, thumbnail_url (YouTube's public thumbnail only), soft `deleted_at`. Made in HER account, sent as an `assignments` row `kind: 'link'` whose `details` JSON keeps a snapshot `{ url, instructions, thumbnail_url }`; `assignment_events.note` = the student's note back on `done`
- `student_profiles` - The tutor's PRIVATE profile of a student, one per `tutor_relationships` row (tutor_id, student_id, markdown `body` ≤ 8000, optional `level` / `handwriting` / `words_per_lesson`). Migration 0077. Only the tutor-only route, the dashboard's `has_profile` flag and the tutor-side content agents read it — never a student-facing path. See "Student profile" below
- `study_bumps` - "⚡ Study it today" (migration 0106; `shared/decks/bumps.ts`, `services/study-bumps.ts`): one row per user + note the learner bumped to the front of today's study (id = client id, source, `bumped_by` = the learner or their tutor, created_at, `done_at` written lazily by the server once every bumped card was reviewed since the bump, `cleared_at` = taken out by hand). Active = both NULL; `/api/sync/changes` carries the active list as `bumps`
- `folders` - Folders for organising decks, Lesson Library items and graded readers (migration 0105; `shared/folders`, `services/folders.ts`): user_id, `kind` deck|lesson|reader, name (≤ 60), `parent_id` (ONE level of nesting), `position`. Items carry a nullable `folder_id` (`decks`, `lesson_library`, `graded_readers`; NULL = Unfiled). Organisation only — the study queue never reads them. Deleting a folder unfiles its items and lifts its subfolders; nothing else is deleted. Copies made for a student never carry the tutor's folder_id
- `users.conversation_audio` - Conversation audio preferences JSON (migration 0110; `shared/lesson/conversationAudio.ts`, docs/AUDIO.md "Conversation audio")
- `users.voice_gender` - 'male' | 'female' | 'other' | NULL: the voice this person's chat messages are read aloud in (migration 0098; Profile → "Your voice when your messages are read aloud", admin `PUT /api/admin/users/:user/voice-gender`, MCP `admin_set_user_voice_gender`). See "Chat read-aloud voice"
- `users.new_card_order` - "Order new cards by" (migration 0113): JSON `NewCardOrder` (new_characters_first / new_words_first / most_common_first / sentences_last), NULL = every switch on (`shared/decks/new-card-order.ts`, `services/new-card-order.ts`)
- `users.study_budget_set_by` / `study_budget_set_at` - who last changed the daily new-card budget (the learner or their tutor) and when (migration 0097)
- `users` profile columns (migration 0076): `google_name` / `google_picture_url` (Google's last values), `name_custom`, `picture_source` (google|upload|none), `picture_key` (R2 avatar), `about` (public About me), `time_zone` (IANA). See `/profile` under Frontend Routes
- `study_time_days` - Active study time per user, local date and device (`active_ms`, only ever raised; migration 0083). Written by `PUT /api/me/study-time` (`routes/study-time.ts`); a day's total is the sum over devices. See docs/STUDY_SESSION.md "Time"
- `usage_events` - Usage analytics (migration 0100, docs/ANALYTICS.md): client + server events (id, user_id, ts, received_at, platform, app_version, session_id, event, screen = route pattern, props JSON of ids / enums / counts only); pruned after 180 days; `users.analytics_opt_out`
- `tts_settings` - The admin's TTS provider settings (migration 0107): ONE row (id 1), `settings` JSON per `shared/tts/config.ts`, updated_at / updated_by; no row = the defaults
- `debug_reports` - Index of study-state debug reports (migration 0075): user, client lab|web, app_version, install_kind, `r2_key` (the JSON is in R2 `debug/<userId>/<id>.json`), size, `summary` JSON; pruned to the newest 20 per user + client. See "Debug reports" below
- `recording_checks` - The background check of each pronunciation recording (migration 0109; docs/RECORDING_REVIEW.md): transcript + match, Azure score, per-character `char_scores` JSON, `score_note`, `audio_ms` / `scored_at` (free-tier budget)
- `tutor_relationships` - Tutor-student pairings (requester, recipient, role, status)
- `conversations` - Chat threads within a relationship: ONE per tutor–student pair (migration 0102 merged the extras, `merged_into` = the chat an old id became, unique index on live human rows); Claude practice chats may be several
- `messages` - Individual chat messages
- `messages.forwarded_from` - the source message of a forward (migration 0095)
- `chat_listening` / `users.chat_listening_default` - Chat listening mode (migration 0099, docs/CHAT.md "Listening mode"): per person + conversation `{ listening, since }` (messages after `since` arrive hidden) and the Settings default
- `users.email_chat_messages` - 1 (default) = a new chat message also sends an e-mail, 0 = off (migration 0093)
- `messages.auto_check` / `users.chat_auto_check` - the background "check my Chinese" of a learner's chat message — the text, a photo / file / video caption, or a voice transcript once it exists (`autoCheckText`) — (JSON per `shared/chats/autoCheck.ts`, sender-only) and the per-account switch (NULL = on for the learner side; migration 0101; docs/CHAT.md "Auto-check", "Chat ↔ Coach")
- `coach_messages.status` / `error` / `attempts` / `checkpoint` / `started_at`, `coach_conversations.source_message_id` - Sentence Coach replies written in the background (NULL = done, pending, failed; migration 0114; `services/coach-replies.ts`, docs/CHAT.md "Chat ↔ Coach") and the chat message an "Open in Coach" conversation came from
- `conversation_reads` - Per person, how far each conversation is read (unread counts, receipts, clearing notifications)
- `device_push_tokens` - FCM registration tokens of the Lab app per user (migration 0089)
- `shared_decks` - Record of decks shared from tutor to student
- `shared_readers` - Record of graded readers copied from tutor to student (source/target reader ids; the copies share R2 image keys)
- `push_subscriptions` - Web Push subscriptions (endpoint, p256dh, auth, the VAPID key used; migration 0080) for call alerts; `users.call_alerts` ('silent' or NULL = ring); `app_keys` holds the generated VAPID pair when no `VAPID_*` secrets are set
- `call_lessons` - Lessons: calls between the same two people within 2 hours (migration 0089; `calls.lesson_id`; the lesson report + processing status)
- `calls` / `call_recording_pieces` / `call_recording_chunks` / `call_transcript_segments` - Video calls (experimental, migration 0071): the call (relationship, status live/ended, processing status, board/chat snapshot, Claude report JSON), each person's recorded mic pieces and their uploaded chunks, and the transcript segments (epoch-ms times on the server clock, text, language, pinyin, translation)
- `board_pages` / `call_board_pages` - The call text board's pages per tutor relationship (a solo call: its caller's), across calls (migration 0086; docs/VIDEO_CALLS.md "Board pages"): position, title, `doc_json` (the page's text CRDT snapshot), `text`, `created_in_call_id`, `last_used_at` (the "continue today's page" rule), `deleted_at`; the link rows = the pages a call opened / wrote on with each page's text as it stood when that call ended
- `call_activities` - In-call activities played (migration 0094): one row per session (call, lesson, relationship, activity_id, kind, title, host, `summary_json` = `ActivitySummary`), upserted by the CallRoom; read by the review page and the homework agent
- `materials` / `material_pages` / `material_shares` / `material_annotations` / `call_materials` - Lesson materials (migration 0092; `materials.toc` = the ☰ Contents JSON, migration 0109, `shared/materials/toc.ts`; docs/VIDEO_CALLS.md "Lesson materials"): a tutor's PDFs / pictures / PowerPoints (original + page pictures drawn on the uploading device in R2 `materials/<owner>/<id>/`, protected), each page's text + speaker notes, shares per relationship (presenting in a call shares it), drawings / text per lesson × material × page (`KeptAnnotations`), which pages a call showed

### Audio Storage & the TTS pipeline (read docs/AUDIO.md before touching TTS)
- Generated TTS audio and user recordings stored in Cloudflare R2
- Audio URLs follow pattern: `/{bucket}/{type}/{id}.mp3`
- Types: `generated` (TTS), `recordings` (user voice)
- **Providers: MiniMax · Azure Speech · Google** (docs/AUDIO.md "Providers"): which one speaks, in what
  order (`stored_order` for anything kept, `live_order` for played-once audio), voices per role
  (default / female / male), enabled + max RPM and "upgrade backup clips" are an ADMIN SETTING —
  `shared/tts/config.ts` (`TtsConfig`, validation, voice catalogues, speed mapping), D1 `tts_settings`
  (migration 0107), `services/tts/config.ts` (cached 30 s, `storedClipPolicy`), page **/admin/audio**,
  `GET|PUT /api/admin/audio/settings`, `POST /api/admin/audio/sample`, MCP `audio_settings_get` /
  `audio_settings_update`. Defaults = MiniMax only for stored clips (`speech-2.8-hd`, Radio Host, 0.6),
  Google live fallback. Providers in `services/tts/providers.ts`; every call goes through
  `callProviderTTS` / `synthesizeOrdered` (`services/audio.ts`): that provider's limiter + account
  pause, fallback on account pause / failure (a plain rate limit falls back only for interactive).
  A backup provider's clip is "current" while the first provider is paused (or always with upgrade off).
  Other providers map a MiniMax catalogue voice by gender. Azure: secrets `AZURE_SPEECH_KEY` /
  `AZURE_SPEECH_REGION` (skipped when unset), SSML + `<prosody rate>`, F0 default 15 RPM.
- **Every provider call goes through `callProviderTTS`** (`services/audio.ts`; `callMiniMaxTTS` for
  MiniMax-only paths), which asks that provider's `TtsLimiter` Durable Object (idFromName = provider) for a slot (a LEARNED rate — AIMD: starts at 8/min, +2 per clean busy
  minute, ×0.5 on a 1002, floor 2, capped by `MINIMAX_RPM` = 55 (pay-as-you-go) and `MINIMAX_RPM_MAX` = 60;
  interactive before batch, a waiting tap reserves the next token;
  a 1002 / 429 is requeued 60 s later, never retried in the request). A new TTS path must use it.
- **Account problems** (no credit 2053 / 1008 / 2056, bad key 1004 / 2049 / HTTP 401 / 403;
  `services/tts/account.ts`): every call paused 5 → 60 min, never a clip failure; one probe per pause
  clears it (account-failed clips retried, pump started, ntfy on start + clear). Status:
  `audio_backfill_status.account_problem`; on demand: MCP `audio_retry_failed`. MiniMax has no balance
  API for pay-as-you-go keys.
- **Google fallback only for live playback nobody keeps** (`allowGoogleFallback`: chat `/tts`, role-play
  replies). `/api/practice/tts` is MiniMax only (503 retryable) because both apps cache it on the device.
- **Stored clips** (word, card sentence, sentence-set row) are made by `ensureClip`
  (`services/tts/clips.ts`): idempotent by a settings + text signature (`audio_settings`,
  `audio_voice`, `audio_model`, migration 0103), fresh key, swap only while the row still
  points at the old key, copies sharing the key move too, old object deleted only when
  unreferenced, `updated_at` bumped. Background clips go through **`tts-queue`**
  (`services/tts/queue.ts`); the backlog (missing → Google → old voice) drains via the pump,
  nightly at London midnight + hourly crons. Admin: MCP `audio_backfill_status` / `audio_backfill_run` / `audio_retry_failed`.

### AI Features
Uses Anthropic Claude API for several features:

1. **Deck generation**: "Generate cards about zoo vocabulary" → creates full deck with 8-12 cards
2. **Card suggestions**: While editing, suggest related vocabulary
3. **Ask Claude**: During study, ask questions about a card (grammar, usage, cultural context)
   - **Immersion** (docs/STUDY_SESSION.md "Ask Claude"): answers in simple graded Chinese by default
     (`users.ask_claude_language` 'zh' | 'en', NULL = Chinese; Settings + the sheet's 中文 | EN;
     `PUT /api/profile/ask-claude-language`; prompt `worker/src/services/ask-prompt.ts` with a sample of the
     learner's started words; "in English please" answers one turn in English — `shared/study/askClaude.ts`).
     The sheet (`components/askClaude/`, Lab `ui/study/AskClaudeSheet.kt`) uses the tutor chat's bubbles,
     word chips → the language explorer, the chat's long-press menu subset (`askClaudeMenu`), and the chat's
     auto-check on the learner's own Chinese (✎, How to say it better, Open in Coach). Route
     `worker/src/routes/ask-claude.ts`, service `services/ask-claude.ts`.
   - **🎧 Listen first** (Jerome: "toggled to audio first, in the same way the messages are"): the chat's
     Listening mode REUSED in the sheet — 🎧 beside 中文 | EN + Settings (`users.ask_claude_listening`,
     migration 0117, `PUT /api/profile/ask-claude-listening`, on `/api/auth/me`; every ask sends `listening`).
     Claude's Chinese answers show as the chat's `ListeningBubble` / Lab `ListeningContent` (tap plays with the
     0.75× chip, long press / 👁 reveals, then chips + menu); my questions and English answers never hide; a new
     answer plays once by itself unless audio is playing (`askAutoPlayId`); revealed ids per device. Audio = the
     Read-aloud clip in Claude's voice (`ASK_CLAUDE_VOICE` = the app voice Radio Host at 0.6, one clip per answer
     — no length split needed), pre-generated before the answer returns (`pregenerateAskClip`, ≤ 8 s, then
     waitUntil). Rules `shared/study/askClaude.ts` (Lab core `AskClaude.kt`, parity-tested); Lab
     `ui/study/AskListening.kt`.
   - Questions and answers are stored in `note_questions` table (+ `answer_lang`, `answer_words`,
     `answer_translation`, `question_words`, `question_translation`, `question_check` — migration 0116)
   - Visible in note history modal

### Calling Gemini (read before adding a Gemini call)
Every Gemini call goes through `geminiGenerateContent` (`worker/src/services/gemini.ts`) with a model LIST —
`GEMINI_FLASH_MODELS` (text / vision / audio: picture-hunt detection, call + take transcription) or
`GEMINI_IMAGE_MODELS` (reader / lesson illustrations, picture-hunt scenes). Google retires models and limits old
families to keys that already used them (a plain 404 — that broke picture hunts with `gemini-2.5-flash`), so a 404
(or a 400 / 403 about the model or thinking) moves on to the next model, the one that answered is remembered per
isolate, and errors carry Google's message (the key goes in `x-goog-api-key`, never the URL). A rename is a one-line
change there. `leastThinking(model)` gives the right thinking setting per family (2.5 budget 0, 3.x level).

### Calling Claude reliably (read before adding a Claude call)
- **Sonnet 5 and Opus 5 think by default** when `thinking` is omitted, and thinking tokens count against
  `max_tokens`. A small `max_tokens` then truncates or empties the answer — this is what broke the
  Sentence Coach (PR #392 set 900). With forced `tool_choice`, set `thinking: { type: 'disabled' }`
  (as `lesson-editor.ts`, `sentence-set.ts`, `enrich-words.ts`, `calls/report.ts` do).
- For a short user-facing structured reply, use `structuredCall` (`worker/src/services/structured-call.ts`):
  forced tool + thinking off, `stop_reason` checked (`max_tokens` → retried with double the budget),
  `validate()` on the shape, every non-4xx failure retried with the last attempt on Haiku, 45 s timeout;
  it throws `StructuredCallError` with `retryable`. Routes return 503 (retryable, the client retries
  once) or 502 (declined) with a human reason. The coach's first reply (`sentence-coach.ts`,
  `sentence-translate.ts`) uses it; unit tests in `services/__tests__/structured-call.test.ts`.

### Card standard (the house style for every card)
`shared/cards/standard.ts` holds `CARD_STANDARD`, the one text every Claude that makes cards reads:
the worker's Generate / Ask Claude / coach / chat / discuss prompts include it, the MCP server sends it
as its `instructions` and repeats the short form in the add / update tool descriptions. The HARD rules
are enforced by `cardTextProblems` in the content service (and pre-checked by the MCP tools), so a
card that breaks them is refused with a message saying where the content belongs:
- **hanzi is ONE clean form** — no slashes, parentheses, brackets, pipes, ellipses or blanks. Alternatives,
  optional characters and variants go in `fun_facts` (accepted typed answers can go in `alternatives`).
  No placeholders: fill the slot with a real word. TTS reads every symbol aloud and pauses at it.
- **pinyin** with tone marks, spaces between words. **english**: one clear meaning; other senses in fun_facts.
- **fun_facts is the explanation**: every word of a sentence (汉字 (pīnyīn) meaning) then the structure, or
  every character of a word then its usage; then the common mistake / contrast / register. No trivia.
- **sentence_clue** is one short real sentence containing the word exactly; prefer a single clause;
  no brackets, slashes, ellipses or blanks.
- **一 / 不 tone changes** are written (yí gè, yì tiān, bú shì, bù hǎo; neutral yi / bu in 看一看 / 要不要);
  no other tone sandhi (nǐ hǎo stays). ONE function applies it: `applyYiBuToneChanges(hanzi, pinyin)`
  (`shared/pinyin/toneChange.ts`, Lab `core/…/ToneChange.kt`, parity-tested) — every automatic pinyin
  goes through it: the web's `utils/autoPinyin.ts` (pinyin-pro, whose own `toneSandhi` is close but not
  ours), the Lab's `ToneChange.autoPinyin`, and Claude's pinyin in Generate / gloss / enrich (worker).
  Existing notes are never mass-rewritten; the word check proposes fixes instead.
Change the rules in `shared/cards/standard.ts` only; everything else reads from it.

### Word checks — "⚠ Possible issue" (`worker/src/services/card-check.ts`, `routes/card-checks.ts`, `shared/cards/check.ts`)
A cheap batched Haiku check (`structuredCall`, `CHECK_BATCH_SIZE` 40 words per call, forced `report_issues`
tool) for likely-wrong pinyin (wrong tones, a missing 一/不 tone change, the wrong reading of a multi-reading
character) or a wrong / misleading English gloss, plus the deterministic 一/不 rule (`mergeCheckIssues`).
**Never applied automatically**: results are stored, shown, and only an explicit Apply goes through
`content.updateNote` (`{ check: false }`, so a fix doesn't re-check itself).
- New / edited words: the content service calls `queueNoteCheck` (create / batch / an edit of hanzi, pinyin or
  english) when the account's switch is on — `users.card_check`, NULL = default ON for tutors (role tutor or
  tutoring someone), Settings → Cards "Check new words for mistakes" (`PUT /api/profile/card-check`, `card_check` /
  `card_check_setting` on `/api/auth/me`). Runs on **`card-check-queue`**; issues land in `notes.check_issues`
  (JSON `NoteCheckIssue[]`) with `notes.check_at` (migration 0104) — `/api/sync/changes` also returns notes by
  `check_at`, so `updated_at` (which the tutor→student copy rules compare) is never touched by a check. Deck page
  note rows show each live issue (`liveCheckIssues`: stale once the field changed) with Apply fix / Dismiss
  (`components/cardCheck/NoteCheckIssues.tsx`; Lab deck detail). Copies, the starter deck and `?check=none` skip it.
- Paste a list: the preview calls `POST /api/ai/check-words` (≤ 60 rows, nothing stored) and shows ⚠ per row;
  checked rows are saved with `?check=none`.
- **Per-deck "Check for errors"** (deck ⋯ menu; the tutor's student page → homework row menu, on the STUDENT's
  copy): `components/cardCheck/DeckCheckSheet.tsx` (Lab: same sheet) — cost estimate first (`estimateCheckCost`,
  "~319 words · about $0.02"), then a `deck_check_jobs` row run on the queue in batches with progress saved per
  batch (a redelivery resumes), then the review list (current → proposed, reason, checkboxes) and **Apply selected**
  (`applyDeckCheck`: a word edited since is skipped; "Also fix my source deck" when the tutor owns the source,
  matched by hanzi). Real token usage → `cost_usd` (`structuredCall`'s `onUsage`).
- E2E_TEST_MODE uses a fake model (`services/card-check-fake.ts`: 银行 yínxíng, 苹果 "banana", 长大, 妈妈).
- MCP: `check_deck_for_errors`, `apply_note_fixes` (`mcp-server/src/tools/checks.ts`); `add_note`, `batch_add_notes`,
  `create_homework_deck`, `add_words_to_student_deck` create with `?check=sync` and return `check_warnings`.

### Reader page standard
`shared/reader/standard.ts` — `READER_STANDARD`: a page is one picture and one moment, 1–2 sentences
(3 at most, ~15–45 characters), at most one exchange of dialogue, no line breaks; split rather than
pack. The story generator carries it in its prompt and gets ONE repair round when
`readerPageWarnings` flags a page; the reader co-editor chat and the MCP `READER_SPEC_DOC` repeat it;
`POST /api/readers/import`, `PUT /api/readers/:id/spec` and the MCP create / update tools return
`warnings` for pages over it (soft — the reader is still saved). Yardstick: "小明在巴黎".

### Pinyin Format
- Always use **tone marks** (nǐ hǎo), NOT tone numbers (ni3 hao3)
- Use proper Unicode: ā á ǎ à, ē é ě è, ī í ǐ ì, ō ó ǒ ò, ū ú ǔ ù, ǖ ǘ ǚ ǜ

## Offline-First Architecture

**Study mode MUST work fully offline.** This is a core requirement - users study on the subway, on planes, and in areas with poor connectivity.

### Offline-First Principles

1. **Study is 100% local-first**: All study functionality uses IndexedDB (via Dexie). No network requests are made during card reviews. Transitions between cards are instant.

2. **Event-sourced reviews**: Reviews are stored as immutable events in `reviewEvents` table. Card state is computed from events, never stored. Events sync to server when online.

3. **Data is cached locally**: Decks, notes, and cards are stored in IndexedDB. The app works immediately on load using cached data.

4. **Graceful degradation for other features**: Features that require internet (AI generation, Ask Claude, TTS generation) should fail gracefully with clear user feedback - not crash or hang.

### Event-Sourcing Architecture

**Review events are the SINGLE SOURCE OF TRUTH for card scheduling state.**

#### Core Principles

1. **Events are append-only**: Review events can only be added, never modified or deleted. Each event has a unique ID for deduplication.

2. **Card state is derived, not stored**: The `queue`, `stability`, `difficulty`, `lapses`, etc. on cards are COMPUTED from the review event history using FSRS. The stored values are just a cache for performance.

3. **Both client and server compute state independently**:
   - Client computes card state from local events
   - Server computes card state from server events
   - They should arrive at the same state given the same events

4. **Sync exchanges events, not state**:
   - Upload: Client sends unsynced events to server
   - Download: Server sends events client doesn't have
   - After sync, both sides recompute card state from merged events

5. **Idempotent event sync**: Events are deduplicated by ID. Syncing the same event twice is safe - it's skipped if already exists.

7. **Deletions travel as tombstones**: deleting a deck or note removes it locally at once (`removeDecksLocally` / `removeNotesLocally` in `db/database.ts`) and writes a `deleted_items` row on the server, which `/api/sync/changes` hands to every other device. A full sync additionally replaces decks/notes wholesale and drops cards the server no longer has. Syncs never write back an id this device removed during the session (`wasRemovedLocally`), a full sync's cursor is the moment its snapshot was taken (so deletions made mid-sync still arrive), and a deck page that gets a 404 removes the deck locally. A note the same /sync/changes response moves into a live deck survives its old deck's tombstone (`movedToLiveDecks`; Lab `SyncChanges`) — words merged into another deck and then the old deck deleted used to vanish from the device; every device runs one full sync (`sync-full-refresh-v1` / Lab `FULL_REFRESH_VERSION`) to bring such notes back. Decks deleted before tombstones existed (23 Sep 2026) were never announced, so `/api/sync/changes` also returns `live_deck_ids` (+ `live_deck_ids_at`, taken before the change queries) and the incremental sync drops local decks missing from it that predate the snapshot (`findGhostDecks`, `shared/decks/ghosts.ts`; the Lab app's port is parity-tested). The tutor's student page no longer lists shares whose tutor deck AND student copy are both gone (`dropGhostShares`).

6. **Checkpoints for performance**: `card_checkpoints` table stores computed state at a point in time. This avoids replaying all events from the beginning. Checkpoints are ALWAYS re-derivable from events.

#### What This Means in Practice

- **Never trust card state from sync**: When downloading cards from server, ignore the scheduling fields. Either:
  - Initialize as NEW and download events to compute real state, OR
  - Download events first, then compute state from events

- **Never store card state directly**: When a review happens, create an event and compute new state from events. Don't just update the card directly. The web study session stores the event and writes `computeCardState(all the card's events)` (`recomputeCardFromEvents`); cards a sync inserts are replayed if their events are already local (`recomputeCardsWithEvents`); `repairCardStatesIfDue` re-derives every row after a background sync whose event download succeeded (once per `CARD_STATE_REPAIR_VERSION`, then daily) — a card with no events is NEW, like the Lab's replay (v2 reset legacy rows carrying the server's old Anki state or no queue: 390 due on the web vs 119 in the Lab, 30 Sep). Events the server refuses (their card is not in the account) come back as `orphan_event_ids` from `POST /api/reviews` and are marked `_synced = -1` (rejected), never "synced".

- **State mismatches indicate bugs**: If computed state differs from stored state, the computed state is correct. Use `fixAllCardStates()` to repair.

#### Future: State Override Events

For manual state adjustments (e.g., admin resetting a card), we may add a `set_card_state` event type that explicitly sets state. This maintains the event-sourced model while allowing overrides.

### What Works Offline
- Viewing decks and notes (from local cache)
- **All study functionality** - card display, rating, queue management, daily limits
- Audio playback (if previously cached)
- Viewing statistics (from local data)

### What Requires Internet (Fail Gracefully)
- AI deck generation
- Ask Claude questions
- TTS audio generation
- Initial data sync (first load)
- Session creation (best-effort, non-blocking)

### Key Implementation Files
- `frontend/src/db/database.ts` - IndexedDB schema and queries (Dexie)
- `frontend/src/hooks/useOfflineData.ts` - Offline-first React hooks
- `frontend/src/services/sync.ts` - Background sync service
- `frontend/src/services/review-events.ts` - Review event creation and state computation
- `frontend/src/contexts/NetworkContext.tsx` - Online/offline detection
- `shared/scheduler/compute-state.ts` - Pure function to compute card state from events
- `frontend/src/utils/audioPlayback.ts` - The one audio player: native bridge in the Android app (`window.AndroidAudio`, see `native/README.md`), one `<audio>` element elsewhere
- `frontend/src/services/nativeAudioPrefs.ts` - Android-app playback tuning (compressor, keep-awake), toggled in Settings
- `frontend/src/utils/audioDiagnostics.ts` - Per-clip playback measurement behind Settings → "Copy Audio Report"

### When Adding Features
- **Study-related features**: Must work offline. Use `useOfflineData` hooks, store data in IndexedDB.
- **Other features**: Should fail gracefully. Show clear error messages, don't block the UI, don't prevent navigation.

## Feature Overview

### Study Flow (Offline-First)
**Study works 100% offline** - no loading spinners between cards, instant transitions.

For detailed behavior, see [docs/STUDY_SESSION.md](./docs/STUDY_SESSION.md) — including the
card-back layout (always-visible example sentences, one footer action row **Ask Claude · Edit card · ⋯**, everything else under ⋯ in
`frontend/src/components/study/`), offline mode (automatic from NetworkContext + a forced
override, `services/offlineMode.ts`), the 8s multiple-choice fallback (`services/multipleChoice.ts`),
"today is the session" (no exit confirm: ✕ just leaves and the same card — revealed, answer,
recording — comes back; ⋯ → Sentence coach and back; celebrate emptying today's queue once a
day; active study time per day, `shared/study/`, `PUT /api/me/study-time`), and tutor notes on recordings. Study-only styles live in
`frontend/src/pages/StudyPage.css`.

**Card Priority:**
1. Learning cards due NOW (highest priority - active timers)
2. Mix of new + review cards (proportional selection)
3. Learning cards on cooldown but due today (shown immediately when nothing else available)

**New Card Daily Budget (global, filled from the deck queue):**
- One budget per account (`users.new_cards_per_day` / `secondary_cards_per_day`, NULL = `DEFAULT_STUDY_BUDGET` 3 + 6; `PUT /api/profile/study-budget`, on `/api/auth/me` and `/api/sync/changes` as `study_budget` (`StudyBudgetInfo`: numbers + `is_default` + who set it), mirrored to localStorage by `services/studyBudget.ts` for offline study — refreshed on every sync, so a tutor's change applies the same day; Lab: `refreshProfile` each sync). **The tutor can set it**: student page → Homework → "Daily new cards" row → Edit (`components/tutor/DailyBudgetSection.tsx`: New words a day / Extra cards a day, Reset to default, live "At 5 a day, <deck> finishes in ~9 days"), `GET|PUT /api/relationships/:relId/student-study-budget` (`routes/student-study-budget.ts`, tutor of an active relationship; same `pickStudyBudgetUpdate` validation, `null` = default), MCP `set_student_study_budget`. It records `users.study_budget_set_by` / `_set_at` (migration 0097; the student's own change sets it back to themselves — last write wins), posts "I've set your new cards to 5 a day (+10 extra) 📚" from the tutor through the normal chat send path, and the student's Settings shows "Set by Minghui · 3 Oct"; the dashboard card shows "📚 5 + 10 a day" when not the default. Copy + the info shape: `shared/decks/tutor-budget.ts` (Lab `core/…/TutorBudget.kt`, parity-tested). The student's own decks / caps are never touched. Per-deck `new_cards_per_day` / `secondary_cards_per_day` are now **caps** on what one deck may take of it.
- **Deck queue**: `decks.study_priority` (higher first, ties newest first; `sortDecksForQueue`). `POST /api/decks/:id/move {to: top|bottom}`, `PUT /api/decks/reorder {deck_ids}`; the Decks tab shows #N badges with a move menu and **press-and-hold to drag** (`services/dragReorder.ts`: `useLongPressReorder`, pointer events + a non-passive touchmove blocker, pure `indexUnderPointer` / `moveToIndex` unit-tested; commits through `reorderQueue`), Home has "↑ Top" and the *Next up* line (`components/home/NextUpLine.tsx`: deck, words to go, ~days at the current rate). A shared homework deck lands on top (`priority: 'core'`, the default) or at the bottom (`'non_urgent'`) — `POST /api/relationships/:relId/share-deck { deck_id, priority }`, the Send-homework sheet's Core / Non-urgent choice, the MCP `share_deck_with_student` / `create_deck_for_student` `priority` param. The tutor's student page shows per packet "N/M words met · X to go, ~D days" (`words_to_go` / `days_to_go` from the student's budget in `services/tutor-dashboard.ts`) and a **#N of M** queue badge (`queue_position` / `queue_total` from the student's whole deck queue) with the same Move to top / up / down / bottom menu as the Decks tab (`components/QueuePositionMenu.tsx`, shared by both) — `POST /api/relationships/:relId/shared-decks/:id/move { to }` moves the student's copy in THEIR queue (tutor only; the MCP `move_student_deck` tool). The pure order helper is `moveInOrder` in `shared/decks/queue.ts`.
- **Primary (blue)** — cards of unseen notes, hanzi_to_meaning preferred. **"Order new cards by"** (Settings → New cards, per account; `shared/decks/new-card-order.ts`, Lab `core/…/NewCardOrder.kt`, parity-tested): four switches, all on by default, applied as tiers across ALL decks in scope before the deck queue decides — (1) **New characters first**: unseen notes that bring ≥ 1 never-seen Han character (seen = hanzi of notes with a reviewed card, any deck; with Most common first on, ranked by the character rank of the note's most common NEVER-SEEN character — the most useful new character first, unlisted characters last, re-ranked greedily after each pick — then by new characters up to 2, then word frequency; off: by new characters up to 2); (2) **New words first**: WORD notes (`noteKind`: 1–4 Han characters, no sentence punctuation) whose text appears in no studied note's hanzi, sentences included (银行 is new even when 银 and 行 are known; a word met inside a studied sentence is not; index = every 2–4 character piece inside a Han run, `StudiedIndex`); (3) **Most common first**: inside each tier (and inside a deck in the fallback) by wordfreq rank (tier 1: first by the most common new character, `characterRank`), unknown words after listed ones by their rarest character (`frequency.ts`; the list `shared/data/frequency/word-freq.txt` — wordfreq `large_zh`, CC BY-SA 4.0, 30k words + 8k characters, built by `npm run build:word-freq`; web: a lazily imported precached chunk, `services/wordFrequency.ts`; Lab: a core classpath resource, `WordFrequency.shipped`); (4) **Sentences last**: words before sentences inside tier 1, and after the tiers every word note (all decks, queue order) before any sentence; (5) then deck priority, deck by deck as before. Greedy (each pick's characters / pieces count as studied for the next), ties: deck position, shorter, card id; a heap with lazy re-checks keeps it ~10 ms on top of the queue for 10k notes. Each deck gives at most min(unseen cards, cap left): one-off 0 + 0 decks, opted-out words, bumps (first, outside the budget), the purple pool and homework passes are unchanged. `pickNewCardsFirst` (`study-queue.ts`) → `pickNewCardsByOrder`, `respreadPrimary` keeps the total, `orderWithinDeck` for the per-deck rest; Home's per-deck rows via `DeckQueueRaw.noveltyPicks`. Stored as `users.new_card_order` (JSON, NULL = defaults; migration 0113), `PUT /api/profile/new-card-order` (`pickNewCardOrderUpdate`, 400 + `problems`, `{ reset: true }`), on `/api/auth/me` + `/api/sync/changes` as `new_card_order`, cached on the device (web `services/newCardOrder.ts` localStorage, Lab `Prefs.newCardOrder`) so study follows it offline; the debug report carries it (`new_card_order`, compared by `compareDebugReports`); analytics `settings.new_card_order`
- **Long-term choice per word** (`notes.long_term`, `shared/decks/long-term.ts`; docs/HOMEWORK.md §3a): a homework pass's answer side has "Add to my long-term review". `0` = the word's NEW cards never enter a pool (only while no card of it was reviewed); `1` = introduced even from a one-off deck (caps 0 + 0), which then gives its opted-in words the default caps; `NULL` = follow the deck. `selectStudyQueue(..., longTerm)` / Lab `StudyQueue.build(longTerm = …)`, parity-tested; `PUT /api/notes/:id/long-term` (sets `long_term_at`, never `updated_at`).
- **Secondary (purple)** — additive: NEW cards whose note already has a reviewed card, so other card types of started words keep flowing even when brand-new words would fill the primary limit. Leftover primary budget can also admit secondary cards.
- The pure allocator is `allocateNewCards` in `shared/decks/budget.ts` (used by `allocateQueueCounts` in `frontend/src/db/database.ts` for the study queue, deck counts and the Study button). See docs/STUDY_SESSION.md.
- **"⚡ Study it today" — the bump pocket** (`shared/decks/bumps.ts`, Lab `core/…/Bumps.kt`, parity-tested via `android-lab/parity/fixtures/study-queue.ts`): a word the learner already has goes to the FRONT of today's session instead of being added again. Per bumped note, cards not reviewed since the bump: every NEW card (introduced today even when the budget is spent — outside the pools, never taking from or waiting for the budget; once reviewed it counts toward introduced-today like any new card), every card already due (moved to the front), plus ONE early review of the most important not-due card (hanzi_to_meaning first; ts-fsrs schedules it from the real elapsed time) unless a due card is already in or a card in circulation before the bump was reviewed since; ≤ 3 per note. Done = nothing left (each bumped card reviewed since the bump); unfinished bumps carry over; Remove from today by hand. `selectStudyQueue(…, bumps)` puts the pocket first (`bumped`, `bumpedNoteIds`), `selectNextItem` shows bumped cards first (recent-notes spacing kept), the card shows a ⚡ badge ("⚡ from Minghui" when the tutor bumped it), Home says "⚡ N bumped for today" (`bumpedLabel`; `DeckQueueCounts.bumped`). Web: `services/studyBumps.ts` (IndexedDB `studyBumps`, Dexie v27, pending add / clear uploaded at once or in sync, the server list replaces the rest), `components/bumps/BumpButton.tsx`. Entry points: every add-card sheet that finds the word (AddChunkModal — Coach Explain, chat Explain / Save as flashcard, sentence rows, picture hunt —, the reader / chat word sheet, Make flashcards' "Already in your decks", Paste a list's "Already in deck" rows) makes **⚡ Study it today** the primary action ("Add anyway" second); the Coach's quick chips get "⚡ Study this today" when the whole sentence is one of his cards (bumps only it), else "⚡ Study words from this today…" — a picker sheet (`components/bumps/SentenceBumpSheet.tsx`, pinned `.sheet-footer`) listing the matched notes longest first, single characters inside a longer match left out, NOTHING ticked, "⚡ Add N to today" (`sentenceBumps`, `shared/decks/sentence-bumps.ts`; Lab `SentenceBumps.kt`, parity-tested) — one tap never bumps a pile of words; `bump_cards` always takes an explicit list (never every word of a sentence); deck page rows / edit sheet and the card hub have ⚡; Claude's `bump_cards` tool in Ask Claude, the coach chat and chat Discuss (`BUMP_CARDS_TOOL`, run inline; their prompts say bump instead of duplicating); MCP `bump_cards` / `list_bumped_cards` / `clear_bumped_card` / `bump_student_cards`.
- **"Due today" is one shared definition**: `shared/decks/study-queue.ts` (`selectStudyQueue`, `introducedToday`, `countQueue`) — learning / review cards due by the cutoff plus the budget's new cards; Home shows the counts of exactly that queue (a learning card due tomorrow is not counted). Introduced-today is derived from review events (first-ever review at/after LOCAL midnight), never from a counter. The Lab app's `StudyQueue.kt` is parity-tested against it (`android-lab/parity/fixtures/study-queue.ts`).

**Session Flow:**
1. User selects a deck (or "All Decks") and starts a study session
2. Three card types test different skills:
   - **Hanzi → Meaning**: See characters, speak aloud, reveal answer
   - **Meaning → Hanzi**: See English, type characters, check answer
   - **Audio → Hanzi**: Hear audio, type characters, check answer
3. On answer reveal:
   - Play TTS audio (if cached)
   - **Ask Claude** about the word (requires internet, fails gracefully)
   - Rate difficulty (Again/Hard/Good/Easy)
4. Reviews are saved locally and synced to server in background
5. Today is the session: leaving Study ends nothing and the card on screen comes back as it was
   (`shared/study/resume.ts`); "All done" appears when all learning cards graduate (due tomorrow+)
   and no new/review cards remain, celebrated once a day (`shared/study/celebration.ts`) with
   "Today: 23 min · 142 reviews" (active time, `shared/study/activeTime.ts`)
6. "Study More" button appears to add 10 bonus new cards beyond daily limit

### Language explorer (docs/LANGUAGE_EXPLORER.md)
ONE reusable bottom sheet holding a STACK of views — the Character view (the character sheet below) and a Word view
(hanzi · ▶ cached practice TTS · pinyin · meaning · "#N most common word" from the shipped frequency list · a chip per
character coloured by tone · "📚 You have this card in <deck>" → Open card / ⚡ Study it today, else + Add as card
(AddChunkModal) · dictionary senses · the sentence it was tapped in + the learner's own cards with it · ✨ More about this
word (the cached `/api/reader-words/explain`, online only) · related words sharing a character with ✓ Known / 📚 badges).
Every Chinese character / word inside a view pushes another view; ← / the breadcrumb pop, ✕ closes. Rules in
`shared/explorer` (Lab `core/…/explorer`, parity-tested). Web: `components/explorer/` — `ExplorerProvider` (App.tsx,
`useExplorer().open(item, { source })`), `LanguageExplorer`, `CharacterView`, `WordView`, and **`<ExplorableText text
segments? source />`**: makes any Chinese tappable, by word when segments match the text, by character otherwise. Used on
the study card answer side, the homework pass answer side, reader word chips, chat word chips, sentence breakdown rows
(study / homework / chat Explain / Coach) and lesson note sentences — never where a tap already means something (answer
inputs, call board, games, the sentence rows' reveal). Word data: **`GET /api/words?w=银行,学生`** (≤ 50) → `{ version,
records: { hanzi: WordRecord }, missing }` from `worker/char-dict/words/NNN.dat` (60,000 most frequent CC-CEDICT words,
`npm run build:word-dict`, `buildWordDict` in `shared/chars/build.ts`, sharded by `wordShard`), cached on the device
(IndexedDB `wordDict`, Dexie v30, `services/wordDict.ts`); offline the Word view builds from the character records + cards.
**🎯 Quick drill** on both views (`shared/explorer/drill.ts` `buildDrill`: meaning / listen / tone / reverse / write, seeded so the Lab port is parity-tested) — practice only, never review events. Analytics `explorer.open / push / more / add_card / bump / write / drill_start / drill_finish`.

### Character sheet (tap a character on the card back; docs/STUDY_SESSION.md "Character sheet")
Card-INDEPENDENT dictionary data — readings, meaning, radical / components, strokes, frequency rank and
the ~20 most frequent words with the character, each marked **✓ Known** (mature card) / **📚 In your decks**
from the learner's own cards on the device (`shared/chars/status.ts`, Lab `CharWords.kt`, parity-tested);
a row → the explorer's Word view (⚡ Study it today / Open card → / + Add as card there); the radical and components are tappable too. Replaces the per-card Claude
popup (`WordDefinitionPopup`, `/api/vocabulary/define` — kept, unused by the card). Data: built by
`npm run build:char-dict` (`scripts/build-char-dict.ts`, rules in `shared/chars/build.ts`) from **CC-CEDICT**
(CC BY-SA 4.0), **Make Me a Hanzi** `dictionary.txt` (LGPL-3.0) and **wordfreq** `large_zh` (CC BY-SA 4.0
data) → ~10,200 characters in 128 gzipped JSON shards `worker/char-dict/NNN.dat` (committed, 2.3 MB), the
worker's static assets (`[assets]` binding `CHAR_DICT`, `run_worker_first = true`; `services/char-dict.ts`
keeps shards in memory per isolate) — chosen over D1 (no 10k-row data load path in CI) and R2 (no
separate upload step): immutable, versioned with the code, deployed with the worker. Bump `CHAR_DICT_VERSION`
(`shared/chars/types.ts`) when the shape or rules change so devices refetch. Device: IndexedDB `charDict` /
`charExplanations` (Dexie v28, `services/charDict.ts`), the upcoming queue's characters prefetched hourly in
sync. Licences: `/about/licences` (Settings → About · Licences).
- `GET /api/chars/:char` → `{ version, record }` (404 not in the dictionary, 400 not one Han character)
- `GET /api/chars?c=` → `{ version, records, missing }` (distinct Han characters of `c`, ≤ 100)
- `POST /api/chars/:char/explain` → `{ char, explanation, cached }` — "More about 字", Haiku from the dictionary record only (never the card), cached globally in `char_explanations`; 503 without a key and no cached answer

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

### AI Integration
- **Generate Deck**: Describe a topic, get 8-12 vocabulary cards
- **Ask Claude**: During study, ask about grammar, usage, examples, mnemonics
- Q&A is saved and viewable in note history

### MCP Server
AI assistants can manage vocabulary via MCP (see MCP Server section below).

## Development Guidelines

### Mobile-First Design

**This app is primarily used on mobile devices.** All UI work must prioritize mobile experience.

#### CSS Guidelines
- Write mobile styles first, then use `@media (min-width: 640px)` for larger screens
- Minimum touch target size: 44px height for buttons and interactive elements
- Use relative units (rem) for font sizes, not px
- Test all changes on mobile viewport (375px width) before desktop

#### Key Breakpoints
- Mobile: < 640px (default styles)
- Tablet/Desktop: >= 640px (`@media (min-width: 640px)`)
- Large Desktop: >= 1024px (rarely needed)

#### Mobile UX Checklist
- [ ] Buttons are easily tappable (min 44px height)
- [ ] Text is readable without zooming (min 16px for body text)
- [ ] Forms don't cause zoom on iOS (inputs must be 16px+)
- [ ] Content doesn't overflow horizontally
- [ ] Modals are usable on small screens
- [ ] Navigation is accessible with one hand

#### Sheets and long forms: the primary action never scrolls away
Every modal / bottom sheet puts its Save / Send / Add row in **`.sheet-footer`** (index.css) as
the LAST child of the sheet's scrolling body: it sticks to the sheet's bottom while the content
scrolls under it (edge shadow only while there is more below), settles in place at the end so it
never covers the last field, and bleeds over the scroller's padding (`--sheet-pad`,
`--sheet-pad-bottom` when it isn't 1rem). Sheets size with `dvh` so the keyboard shrinks them. A
long form on a normal page uses `.page-footer` (pinned above the tab bar). Lab app: wrap the sheet
in `SheetScaffold` (ui/kit, see android-lab/docs/UI_KIT.md). E2E: `e2e/tests/sticky-save.spec.ts`.

#### Common Patterns
```css
/* Mobile-first example */
.element {
  padding: 1rem;        /* Mobile */
  font-size: 0.875rem;  /* Mobile */
}

@media (min-width: 640px) {
  .element {
    padding: 1.5rem;    /* Desktop */
    font-size: 1rem;    /* Desktop */
  }
}
```

### When Adding Features
1. Update types in `worker/src/types.ts` and `frontend/src/types.ts`
2. Add database migrations to `worker/src/db/migrations/`
3. Add API routes to `worker/src/routes/`
4. Add frontend components/pages as needed
5. **Test on mobile viewport before committing**
6. **Add tests**: E2E tests for user-facing features, unit tests for business logic
7. Update this CLAUDE.md if the change affects project structure
8. Update docs/SPEC.md if adding new features

### Database Migrations
Migrations are in `worker/src/db/migrations/`. Run order is determined by filename prefix (001_, 002_, etc.).

**Local development**: Apply migrations with:
```bash
cd worker && npx wrangler d1 migrations apply chinese-learning-db --local
```

**Production**: Migrations are applied automatically by CI on push to main (see Deployment section).

### Running Tests

#### Unit Tests
```bash
# Run all unit tests (includes FSRS scheduler tests)
npm test

# Run tests in watch mode
npm run test:watch

# Run type checking
npm run typecheck
```

Key unit test files:
- `shared/scheduler/compute-state.test.ts` - FSRS algorithm tests
- `frontend/src/services/sync.test.ts` - Sync service tests
- `frontend/src/db/daily-stats.test.ts` - Daily stats tests

#### E2E Tests (Playwright)
E2E tests run a headless browser against the full app to test user flows.

```bash
# Run E2E tests (starts worker and frontend automatically)
npm run test:e2e

# Run E2E tests with UI (for debugging)
npm run test:e2e:ui
```

Key E2E test files:
- `e2e/tests/onboarding.spec.ts` - New user onboarding and deck generation
- `e2e/tests/fixtures/auth.ts` - Test authentication fixture

**E2E Test Auth**: Tests use a special `/api/test/auth` endpoint that bypasses OAuth. This only works when `E2E_TEST_MODE=true` is set in `worker/.dev.vars`.

### When to Write Tests

**Write E2E tests for:**
- New user-facing features (pages, flows, interactions)
- Critical paths (onboarding, study flow, deck creation)
- Features involving multiple components working together
- Bug fixes for issues that could be caught by E2E tests

**Write unit tests for:**
- Pure functions and algorithms (FSRS scheduler, etc.)
- Service logic with complex business rules
- Data transformations and validations

**CI enforces both**: PRs must pass both unit tests and E2E tests before merging.

### Running Dev Servers
```bash
# The worker uses wrangler for local D1/R2
npm run dev:worker

# Frontend proxies API calls to worker
npm run dev:frontend

# Run both together
npm run dev
```

### Environment Variables / Secrets
- `ANTHROPIC_API_KEY`: For AI card generation and Ask Claude feature
- `MINIMAX_API_KEY`: MiniMax TTS (the default provider; docs/AUDIO.md).
- `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION`: Azure Speech TTS (optional second provider; deploy.yml pushes them only when set). `MINIMAX_RPM` (wrangler var) = hard cap on the learned rate (9 = Starter), `MINIMAX_RPM_MAX` = its ceiling (60)
- `GOOGLE_TTS_API_KEY`: Google TTS, by default only an in-the-moment fallback for live playback nobody keeps (chat `/tts`, role-play replies; stored only if an admin puts it in the stored order)
- D1 and R2 bindings are configured in `wrangler.toml`

Set secrets via:
```bash
cd worker && npx wrangler secret put ANTHROPIC_API_KEY
cd worker && npx wrangler secret put GOOGLE_TTS_API_KEY
```

## API Endpoints Reference

### Decks
- `GET /api/decks` - List all decks
- `POST /api/decks` - Create deck
- `GET /api/decks/:id` - Get deck with notes
- `PUT /api/decks/:id` - Update deck name / description
- `PUT /api/decks/:id/settings` - Any subset of the deck settings (validated; 400 with `problems`) — per-deck caps on the global new-card budget
- `POST /api/decks/:id/move` - `{ to: 'top' | 'bottom' }` move a deck in the study queue (`study_priority`)
- `PUT /api/decks/reorder` - `{ deck_ids }` the whole queue, first = studied first
- `GET /api/me/chats` - The Chats tab inbox: every conversation of my active relationships (Claude role-play chats flagged `is_ai`) with the other person, last message preview, my unread count, `last_activity_at`, newest first — one query (`getChatList`, `services/chat/reads.ts`; rules in `shared/chats/inbox.ts`, docs/CHAT.md "Chats tab")
- `PUT /api/profile/email-prefs` - `{ email_chat_messages: boolean }` chat e-mails on / off (on `/api/auth/me`); every chat e-mail also carries a sign-in-free "Turn off chat emails" link + RFC 8058 `List-Unsubscribe` headers → `GET|POST /api/email/unsubscribe?t=`, `POST /api/email/resubscribe?t=` (HMAC token, `services/email-unsubscribe.ts`, `routes/email-prefs.ts`; docs/CHAT.md "E-mail opt-out")
- `PUT /api/profile/chat-prefs` - `{ chat_auto_check: boolean | null }` "Check my Chinese automatically" (Settings → Chat; on `/api/auth/me`); the check itself runs in the background after a send / edit (`services/chat/auto-check.ts`), its result rides on the sender's message as `auto_check` → the ✎ on the bubble and "✨ How to say it better" first in the message menu (docs/CHAT.md "Auto-check")
- `PUT /api/profile/study-budget` - `{ new_cards_per_day?, secondary_cards_per_day? }` the account's global daily new-card budget (0–200, `null` = default; 400 with `problems`) → `StudyBudgetInfo`; current values on `/api/auth/me` and `/api/sync/changes` (`study_budget`)
- `PUT /api/profile/new-card-order` - `{ new_characters_first?, new_words_first?, most_common_first?, sentences_last? }` (true / false, null = that default) or `{ reset: true }` → `NewCardOrderInfo` (400 + `problems`); on `/api/auth/me` and `/api/sync/changes` as `new_card_order`
- `GET|PUT /api/relationships/:relId/student-study-budget` - tutor only: the student's budget (+ `top_deck` for the hint) / set it `{ new_cards_per_day?, secondary_cards_per_day? }` (null = default) → `{ budget, changed, message_sent }`; posts a chat message from the tutor
- `GET|PUT /api/profile` - The editable profile (`routes/profile.ts`, `services/profile.ts`, validation `shared/profile`): `{ name?, bio?, about?, time_zone? }` (400 + `problems`; `name: null` = back to the Google name) → `{ name, picture_url, picture_source: google|upload|none, name_custom, google_name, google_picture_url, bio, about, time_zone }`
- `POST /api/profile/picture` (raw image or multipart `picture`; JPEG/PNG/WebP sniffed from the bytes, ≤ 2 MB; the clients crop to a square and send ~512px JPEG) · `DELETE /api/profile/picture?use=google|none`
- `DELETE /api/decks/:id` - Delete deck (tombstones for every device; audio clean-up in the background)

### Folders (`worker/src/routes/folders.ts`, `services/folders.ts`, `shared/folders`)
Per user, organisation only (the deck queue / `study_priority` is the same with or without folders). Web:
`components/folders/` (`FolderGroups` + `useFolderUi`: collapsible groups with Unfiled last, ⋯ Rename / New folder
inside / Delete, press-and-hold a folder header to reorder, "＋ Folder", "☑ Select" → Move N to folder…,
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

### "⚡ Study it today" (`worker/src/routes/study-bumps.ts`, `services/study-bumps.ts`)
- `GET /api/me/bumps` → `{ bumps }` — the active pocket (note text + deck; `bumped_by_name` when the tutor bumped it); finished bumps get `done_at` and drop out
- `POST /api/me/bumps` `{ items?: [{ id, note_id, created_at?, source? }], note_ids?, hanzi?, source? }` → `{ bumps, added, already, not_found }` (idempotent by note + client id; hanzi matched among my notes with `normalizeHanzi`; a finished / cleared bump is re-opened with a fresh created_at; 404 when nothing matched)
- `DELETE /api/me/bumps/:noteId` → `{ cleared, bumps }` (idempotent)
- `POST /api/relationships/:relId/student-bumps` `{ note_ids?, hanzi? }` — the tutor bumps the STUDENT's own cards (tutor of an active relationship only)
- `/api/sync/changes` carries `bumps` (the whole active list)

### Notes
- `GET /api/notes/:id` - Get note with cards
- `POST /api/decks/:deckId/notes` - Create note (`hanzi`, `pinyin`, `english`, `fun_facts?`, `context?`, `sentence_clue?` + pinyin / translation, `alternatives?`); cards made, word + sentence TTS in the background, sentence set queued
- `POST /api/decks/:deckId/notes/batch` - `{ notes: [...] }` (≤500) → `{ created, failed: [{ index, hanzi, error }] }`; audio queued; `?skip_existing=1` leaves out words already in any of my decks → `existing: [{ index, hanzi, note_id, deck_name }]`
- `PUT /api/notes/:id` - Update note (a changed hanzi gets a new word clip, a changed clue a new sentence clip)
- `POST /api/notes/:id/check-issues/:issueId/apply` | `/dismiss` - a word check's "⚠ Possible issue" → `{ note }` (apply = the fix through updateNote)
- `POST /api/notes/check` - `{ note_ids }` (≤ 100) run the word check now and store it → `{ issues: { [noteId]: NoteCheckIssue[] } }`
- `POST /api/ai/check-words` - `{ words: [{ hanzi, pinyin, english }] }` (≤ 60) → `{ issues: [{ index, field, kind, current, proposed, reason }] }`, nothing stored (Paste a list's preview)
- `GET|POST /api/decks/:id/check` - per-deck "Check for errors": `{ estimate, job }` / start → 202 `{ job }`; `GET|POST /api/relationships/:relId/shared-decks/:id/check` the same on the student's copy (tutor; `can_fix_source`); `GET /api/deck-checks/:jobId`; `POST /api/deck-checks/:jobId/apply` `{ proposal_ids, also_source? }` → `{ applied, source_applied, failed, job }`
- `PUT /api/profile/card-check` - `{ card_check: boolean | null }` "Check new words for mistakes"
- `PUT /api/notes/:id/long-term` - `{ long_term: true | false | null }` the learner's "Add to my long-term review" choice (idempotent; `long_term_at`, not `updated_at`)
- `DELETE /api/notes/:id` - Delete note (tombstone; clips removed only if no copy references them)
- `POST /api/notes/move` - `{ note_ids, deck_id }` move notes between your decks, cards and history kept
- `GET /api/notes/:id/history` - Get review history and card stats
- `POST /api/notes/:id/ask` - Ask Claude about a note (`{ question, context?, conversationHistory?, language?: zh|en, quick?, listening? }` → the Q&A with `answer_lang`, `question_check`, `question_check_pending`, `answer_clip_ready`, tool results; `routes/ask-claude.ts`)
- `PUT /api/profile/ask-claude-listening` - `{ ask_claude_listening: boolean }` Ask Claude 🎧 Listen first (on `/api/auth/me`)
- `GET /api/note-questions/:id` - one Q&A shaped (word chips, translations, the question's check) · `POST /api/note-questions/:id/words|translate` `{ part: answer|question }` → `{ words, cached }` / `{ translation, cached }` (made on request, cached on the row) · `PUT /api/profile/ask-claude-language` `{ ask_claude_language: zh|en|null }`
- `GET /api/notes/:id/questions` - Get Q&A history
- `GET /api/notes/search?q=&limit=` - Server-side search of my notes (hanzi / pinyin, tone-free too / english / card sentence) with `deck_name` + `total_notes` — the Decks tab search is local-first (`services/noteSearch.ts` `noteMatches`, cards + recent ratings loaded only for the notes on screen) and falls back to this when the device finds nothing, saying how many of the account's cards the device holds (`routes/note-search.ts`)
- `POST /api/notes/:id/generate-audio` - Generate TTS audio for note
- `POST /api/notes/:id/ensure-audio` - `{ broken?: string[] }` → `{ note, word, sentence }` (ok | copied | generated | queued | failed | none). Idempotent: makes only the MISSING word / sentence clips (a reported 404 key only if R2 really lacks it; a student's copy first takes the tutor's clip), at interactive priority; `queued` = MiniMax is busy, the clip is on tts-queue and coming. Both apps' auto-audio: web `services/noteAudioEnsure.ts` (study card; "Audio coming…" instead of the device voice), Lab `data/audio/NoteAudioFixer.kt` (on the card, queued offline, background pass over the upcoming queue after sync); `content.ensureNoteClips`

### Sentence sets (graded example sentences per note)
Each note can have a **set** of example sentences (separate from the single `sentence_clue`
shown inline on the card): ordered easiest → hardest, with a couple deliberately placing the
word in the language (one uses a word sharing a character, one contrasts an easily-confused
word, one shows the usual collocation). Each sentence gets its own TTS clip and is cached in
IndexedDB, so the whole set works offline. Generated with Sonnet for speed.
On the study card there is ONE sentence list: the note's own `sentence_clue` is rendered as
row 1 (badged "From the card", read straight from the note — never copied into the set, so
editing it stays reflected), followed by the generated set. The list is always visible under the
meaning and scrolls under the card's footer. Rows start blank (listen first): **▶** on the right
plays the clip, and each tap on the row uncovers one more line — hanzi, then pinyin, then the
English — with a tap on a fully open row hiding it again (steps a row hasn't got are skipped;
"Show all" opens every row for the current card). **EN** on the left flips a row into
English-first mode for the reverse exercise: the translation goes up alone as the prompt and the
reveal chain drops the translation step (hanzi, then pinyin) so you translate back into Chinese
before checking. A fully open row carries a tools line: "What's going on here?" (an on-demand
breakdown — word glosses + the construction — generated with Haiku; each word in it is tappable
to add as a card) and **+ Add as card** for the whole sentence.
Set rows cache their breakdown server-side; the clue row has no row to cache on, so it uses
`/api/sentences/explain-text` and caches in the `sentenceTextExplanations` IndexedDB table.
**The clue row reveals like every row even when the note has no clue pinyin / translation** (~⅓ of
notes — MCP-added / older ones): missing pinyin is made on the device (`devicePinyinLine`, Lab
`devicePinyinLine` in `ui/study/Sentences.kt`), and the English step is always there — the line is
fetched once as the row starts opening (`getClueTranslation` → explain-text's `translation`, only the
line cached, key `translation:<hanzi>`; Lab `CardTools.clueTranslation`, `study/clue-translation/<hanzi>`);
offline and never fetched → "Translation needs a connection". Not written back to the note (that
would bump `updated_at` and break the tutor→student copy rules). "From the card" is a small badge on
its own line at the row's top right.

Sets are pre-generated in the background so study never waits on an AI call: notes are
enqueued on `sentence-set-queue` when created, and the client's sync tops up the backlog
(`topUpSentenceSets`, throttled to hourly) passing the upcoming study queue as priority.
Rating a card **Again** also calls `ensureSentenceSetForNote` (fire-and-forget, once per note
per session), so a word you just got wrong has sentences waiting when it comes back a minute
later.
`note_sentence_jobs` stops a note being queued twice or retried forever.
- `GET /api/notes/:id/sentences` - List a note's sentence set
- `POST /api/notes/:id/sentences/generate` - Generate a set (`{ count?: 3-10, customPrompt?, keepExisting? }`)
- `DELETE /api/notes/:id/sentences` - Delete a note's set
- `GET /api/sentences/changes?since=` - Offline sync: every sentence changed since a timestamp
- `POST /api/sentences/prefetch` - Queue background generation (`{ note_ids?, limit? }`, default 20/call)
- `POST /api/sentences/:id/ensure-audio` - One set row's clip for a ▶ on a row with none: `{ status: ready|queued|failed, audio_url }` (made now, else queued at interactive priority; both apps show "Audio coming…" and ask again)
- `POST /api/sentences/:id/explain` - Brief breakdown of one sentence (cached on the row)
- `POST /api/sentences/explain-text` - Same breakdown for a sentence with no row (the card's own clue); breakdowns carry a one-line `translation` (Haiku via `structuredCall`; 503 retryable / 502 declined)
- `GET /api/sentences/stats` - Coverage + background-job state, for the settings overview
- `POST /api/sentences/clue-audio` - Backfill TTS for card sentences that have none (`{ limit? }`, default 50, max 250; queued one per message)

**Card-sentence audio**: `sentence_clue` is written by several paths that don't generate TTS
(MCP `add_note`/`batch_add_notes`, `PUT /api/notes/:id`, Claude's `edit_current_card`), which left
those sentences with a ▶ that had nothing to play. `ensureSentenceClueAudio` now fills it in from
`POST /api/notes/:id/generate-audio` (the endpoint both MCP paths call), on a note update whose clue
changed, after Claude edits a card, and as part of each background sentence-set job. The Sentence
Coverage page has a button to backfill the rest.

**Sentence Coverage page** (`/settings/sentences`, linked from Settings): what fraction of notes
have a card sentence vs a generated set, how many sentences are missing audio, the
`note_sentence_jobs` breakdown (queued / done / failed / stuck / given-up) with the failing words
and their errors, per-deck coverage, and buttons to queue a batch (20 or 100) or pull new sets down
to the device. It polls `/api/sentences/stats` every 5s while jobs are in flight (capped at ~10
minutes so a wedged job can't poll forever).

### Cards & Study
- `GET /api/cards/due` - Get due cards (optional `?deck_id=`)
- `PUT /api/me/study-time` - `{ device_id, days: [{ date, active_ms }] }` this device's running active study time per local day (rows only go up) → `{ days: [{ date, active_ms, device_ms }] }` over every device; `GET /api/me/study-time?from=&device_id=` the same totals
- `POST /api/study/sessions` - Start study session (kept for older clients; best-effort, nothing reads it for time)
- `POST /api/study/sessions/:id/reviews` - Record a review
- `PUT /api/study/sessions/:id/complete` - Complete session

### Audio
- `POST /api/audio/upload` - Upload user recording
- `GET /api/audio/*` - Get audio file from R2
- `GET /api/audio-manifest` - All audio URLs the user owns (note audio, sentence clues, sentence sets, recordings) for offline prefetch

### Pronunciation transcription ("You said: …" on read cards)
A take is transcribed **as soon as the learner stops**, not when the card flips. When `SONIOX_API_KEY` is set, the
take **streams to Soniox real-time while they speak** (`stt-rt-v5`, zh + en hints, no context, so the answer never
biases the recogniser), and the transcript is final a few hundred ms after Stop. The permanent key never leaves the worker:
`POST /api/transcribe/live` mints a **temporary Soniox key** (`usage_type: transcribe_websocket`, 30 min, tagged with the
user id; `services/live-transcription.ts`, `routes/transcription.ts`) that the client caches and reuses until a minute
before expiry, fetched ahead of time when a read card shows. The protocol (config frame, token folding, end-of-audio) is
`shared/transcription/soniox.ts`. Web: `services/liveTranscription.ts` (`LiveTranscriber`: MediaRecorder webm chunks
every 250 ms, `audio_format: auto`) + `useTranscription(…, live)`. Lab: `ui/study/LiveTranscription.kt` (a port of the
protocol + `SonioxStream` on OkHttp) with `VoiceRecorder.startLive` (AudioRecord 16 kHz PCM → `pcm_s16le`, the take kept as
WAV). **Fallback**: no key, the mint fails, the socket errors, empty text or a 4 s timeout → the take is uploaded to
`POST /api/transcribe` with `live_error` (why live gave nothing — logged as `[transcribe] live stream failed on <client>: …`,
the only place a device's live failure reaches the server logs); the server tries **Whisper → Soniox async
(stt-async-v5) → Gemini** (`services/take-transcription.ts`, each provider's own error logged); offline shows "will
transcribe when online". **Never silent**: when live and the upload both fail the card shows **"Couldn't transcribe — tap
to retry"** (web `services/takeTranscription.ts` `transcribeTakeOutcome` + `useTranscription().retry`; Lab
`TakeTranscription.outcome` + `StudyViewModel.retryTranscription`), which re-sends the SAME saved take; the recording is
kept either way. A take Soniox refuses for its key (401 / 403, `liveFailureInvalidatesKey`) drops the cached key.
**End of audio is an EMPTY TEXT frame** (`SONIOX_END_OF_AUDIO` / Lab `SonioxProtocol.END_OF_AUDIO`): an empty
*binary* frame is just an empty audio chunk to Soniox — the Lab app sent that until Oct 2026, so every take timed out
after 4 s and went the upload way. Every take emits `study.take_transcribed { via, live_error, ms }` (analytics), so a
broken live path shows in `event_counts` without reading logs.
- `POST /api/transcribe/live` - `{ provider: 'soniox', api_key, expires_at, websocket_url, model, language_hints }` or `{ provider: 'upload' }`; 502 when Soniox refuses (client falls back)
- `POST /api/transcribe` - multipart `file` (+ `live_error`, `client`) → `{ text, language, provider }`; 502 `{ error, providers }` when every provider failed (`routes/transcription.ts`)
- `GET /api/admin/transcription` - admin: which providers are configured (booleans only, never a key)

### AI
- `POST /api/ai/generate-deck` - Generate deck from prompt
- `POST /api/ai/suggest-cards` - Get card suggestions
- `POST /api/sentence/analyze` - Break a sentence into aligned chunks
- `POST /api/sentence/coach` - Correct/critique a learner-written sentence
- `POST /api/sentence/explain` - Thoroughly explain a Chinese sentence

### Sentence Coach conversations (page at `/coach`, supports `?text=` deep link)
The Coach page offers buttons by what is in the box (`coachButtons` in `shared/coach/actions.ts`, Lab port
`core/…/CoachActions.kt`, parity-tested): Chinese or mixed → **✏️ Check my sentence** (`coachSentence`: correction + 1–3
sentence critique + up to 2 alternatives) and **🔍 Explain** (instead of Google Translate: `explainSentenceBriefly`, the
SAME Haiku breakdown as the example sentences' "What's going on here?" — now with a one-line `translation` — rendered by
the same component, `components/SentenceWordBreakdown.tsx` / Lab `SentenceBreakdown`: one word per row, each row adds that
word as a card through `AddChunkModal`, plus "+ Add whole sentence as card" whose fun_facts gloss every word,
`breakdownSentenceCard`); English → **Translate** (`translateSentence`: recommended translation + up to 2 alternatives +
usage note); empty → the two Chinese buttons disabled. The widget's `?focus=1`, the study card's `?draft=` and a Chinese
`?text=` land on the buttons without sending; an English `?text=` translates at once. `POST /api/coach/conversations`
takes `action` (check | explain | translate; none = the old auto-detect, `resolveCoachAction`) and, for explain, the
breakdown the device has cached (stored as is, no Claude call); the action is recorded in `coach_conversations.action`
(migration 0084) and the analysis is `{ kind: 'explain', breakdown }`. Explain results are cached by text with the card
clue's breakdowns (`sentenceTextExplanations` / Lab `study/explain-text/<hanzi>`) and shown from there offline. The
first replies are deliberately LEAN so the answer comes back fast; nothing is added to a deck from the analysis itself. Everything deeper is one tap away: **quick-action chips** under the conversation
(`QUICK_ACTIONS` in `pages/SentenceCoachPage.tsx`: Make a card · Card for the whole sentence · More examples · Other
ways to say it · Explain the grammar, plus a "Cards go to" deck picker) send a prepared message into the follow-up chat,
where `coachChatWithTools` has `CARD_STANDARD` in its prompt and the tools. Every `create_flashcards` tool (Ask Claude,
coach chat, chat "Discuss with Claude") shares ONE item schema, `FLASHCARD_ITEM_SCHEMA` in `services/ai.ts`:
hanzi / pinyin / english / fun_facts (required) + sentence_clue (+ pinyin, translation) for word cards — the same
fields the content service validates, so a coach-made card is a full standard card, never the critique as fun_facts.
Conversations persist (`coach_conversations` / `coach_messages` tables); the chat's tools are create_flashcards,
create_custom_lesson, search_cards, get_note_cards, get_note_history, get_overall_stats. **Replies are written in the
background** (`routes/coach.ts`, `services/coach-replies.ts`, `coach-reply-queue`; docs/CHAT.md "Chat ↔ Coach"): with
`background: true` the POST returns 202 with a pending assistant message, the queue writes it (checkpointed: answer +
tool actions applied, retried on a busy model, failed → Retry), the page polls while pending — leaving never cancels it;
the list shows "Thinking…". **Open in Coach** from a chat message (menu item, the chip under an improvable bubble, the
How-to-say-it-better sheet) → `/coach?text=&action=check|explain&from_message=` (an explicit action runs at once,
`coachDeepLinkAction`); my message's stored auto-check becomes the analysis without a Claude call. Direct quick actions:
**➕ Add new words (N)** (`newWordsInSentence` in `shared/coach/newWords.ts`, picker with nothing ticked → enrich →
`POST /api/decks/:id/notes/batch?skip_existing=1`, existing words get ⚡) and **🃏 Card for this sentence**.
- `POST /api/coach/conversations` - Start a conversation from a sentence: `{ text, action?: check|explain|translate, explanation?, background?, chat_message_id? }` (no action = auto-detect; 400 for check / explain without Chinese; `background: true` → 202 with a pending analysis; 201 when ready at once; 200 `reused` for a chat message already opened)
- `GET /api/coach/conversations` - List conversations
- `GET /api/coach/conversations/:id` - Get conversation with messages
- `POST /api/coach/conversations/:id/messages` - Follow-up message (agent loop with tools); `background: true` → 202 `[user, pending]` (409 while one is pending)
- `POST /api/coach/conversations/:id/messages/:messageId/retry` - Re-queue a failed reply → 202
- `DELETE /api/coach/conversations/:id` - Delete a conversation

### Audio lessons (`worker/src/routes/audio-lessons.ts`, `services/audio-lessons/`, page at `/audio-lessons`; read docs/AUDIO_LESSONS.md)
Agent-written listening lessons rendered to ONE MP3 each. **dialogue** = English host + a Chinese dialogue
played three times, line by line, then the new words / structures; **sleep** = Chinese, very slow:
the new words of a pasted text, per word: "这是一个新词。我说三遍。" + the word ×3 (short pauses), each character's tone
(`char_tones`) + its characters (`characters_zh`), what it MEANS in 5–8 short comprehensible-input sentences
(`meaning_zh`), ONE English recap line in a calm English voice ("The word was 银行: bank, as in …" — `recap_en`, voice
role `recap`), then three sentences each ×3 followed by its English translation (recap voice); **story** ("Listen &
repeat a story", `shared/audio-lesson/story.ts`, worker `services/audio-lessons/story.ts`) = a pasted longer story or
conversation split BY CODE (`splitStoryText`: after 。！？!?…, at line breaks / speaker turns, never inside quotes; labels
"A：" / "明慧：" off the spoken text and onto two voices `speaker_a` / `speaker_b`, narration in the app voice `teacher`;
`# …` / 第一章 headings = chapters, else a chapter every 10 chunks; a short sentence merged into the next, ~8–40
characters a chunk), each chunk said ×3 at the slowest rate with 2 s after each, then its English once (recap voice),
2.5 s; Claude only TRANSLATES (`structuredCall`, Sonnet, forced tool, thinking off, 30 chunks a call, checkpointed in
`agent_transcript`; pinyin through `applyYiBuToneChanges`) — the Chinese is never rewritten; ≤ 6,000 characters pasted,
≤ 60 minutes / 120 chunks made (`fitStoryChunks`; the rest is left out and `notice` says so); no `target_minutes`. The sleep
voice (and any Chinese at app rate 0.5, i.e. a story's chunks) runs at each provider's slowest natural rate
(`SLEEP_ZH_PROVIDER_RATE`: MiniMax 0.5, Azure 0.6, Google 0.6). Both players mix a
soft procedural music loop under the lesson (`shared/audio-lesson/music.ts`; CC0, made by
`scripts/audio/generate-lesson-music.mjs` → `frontend/public/audio/lesson-music-v1.mp3` + Lab `res/raw/lesson_music.mp3`;
🎵 toggle + volume, on for sleep and story / off for dialogue); the MP3 and the podcast feed stay speech-only. The players'
transcript has 拼 / EN toggles (remembered per device).
Claude Opus 5.5 (`agent.ts`, tools `check_known_words` + `submit_lesson`, transcript checkpointed) writes a
PLAN; `shared/audio-lesson/compile.ts` makes the speech/pause SCRIPT; each distinct clip goes through
`callProviderTTS` (`synth.ts`; Chinese in the stored order with the first provider PINNED per lesson,
English Azure → Google; all clips 24 kHz mono MP3); `mp3.ts` joins frames + generated silence + one Xing
header in the Worker. Queue `audio-lesson-queue` (re-enqueues on rate limits / after 4 min). R2
`audio-lessons/` (person-made). Web player: offline (Cache API), chapters, ±10 s, speed, transcript,
sleep timer, Media Session. MCP `create_audio_lesson` / `get_audio_lesson` / `list_audio_lessons` / `get_audio_lesson_feed`.
- `GET|POST /api/audio-lessons` (POST `{ format: dialogue|sleep|story, … }` → 202 `{ lesson, notice?, chunks? }`), `GET|DELETE /api/audio-lessons/:id` (a story's detail carries `notice`), `GET /api/audio-lessons/:id/audio`, `POST /api/audio-lessons/:id/retry`
- **Private podcast feed** (`routes/podcast.ts`, `services/podcast-feed.ts`, docs/AUDIO_LESSONS.md "Podcast feed"): public,
  mounted BEFORE the auth middleware — `GET /api/podcast/:token/feed.xml` (RSS 2.0 + iTunes + `podcast:chapters`, one item
  per ready lesson), `GET /api/podcast/:token/lessons/:id/:version/audio.mp3` (Range → 206, HEAD, 416),
  `…/lessons/:id/chapters.json`; the token (32 random bytes) is the only credential and grants that user's lessons only;
  stored as SHA-256 (lookup) + AES-GCM (key from `SESSION_SECRET`, so Settings shows it again); wrong / reset token = 404;
  rate-limited (`PODCAST_RATE_LIMITER` `[[ratelimits]]`, 120/min per token, per IP for unknown tokens); never logged (the
  request log carries the route pattern). Signed in: `GET /api/me/podcast-feed` (made on first use), `POST …/reset`,
  `DELETE` (off). Settings → "🎧 Audio lessons · Podcast feed" (`components/settings/PodcastFeedSection.tsx`; Lab
  `ui/audiolessons/PodcastFeed.kt`, also a sheet from the Audio lessons screen). Artwork `frontend/public/podcast-artwork.jpg`.

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
Any new queue must also be added to the "Ensure Queues Exist" step in `deploy.yml`. Queues: `coach-reply-queue` (Sentence Coach replies, docs/CHAT.md "Chat ↔ Coach"), `story-generation-queue`, `image-generation-queue`, `sentence-set-queue`, `quest-generation-queue`, `tutor-notes-queue`, `picture-hunt-queue`, `tts-queue` (docs/AUDIO.md), `card-check-queue`, `recording-check-queue` (docs/RECORDING_REVIEW.md), `audio-lesson-queue` (docs/AUDIO_LESSONS.md), `idiom-queue` (docs/IDIOMS.md).

Endpoints (rows live in `quests`):
- `GET /api/quests` - List quests (status, progress, goal/object counts, best moves)
- `POST /api/quests` - Generate one (`{ topic?, difficulty?: easy|medium|hard, goal_count?, deck_ids? }`) → 202
- `GET /api/quests/:id` - Get a quest with its full world JSON
- `POST /api/quests/:id/retry` - Rebuild a failed quest in place, keeping its topic
- `POST /api/quests/:id/complete` - Record a finished play-through (`{ moves }`)
- `DELETE /api/quests/:id` - Delete a quest

### 成语 Idioms (beta; `worker/src/routes/idioms.ts`, `services/idioms.ts`, `shared/idioms`, docs/IDIOMS.md)
One entry per idiom, generated once by Claude (`structuredCall`, forced `write_idiom_entry`, thinking off, no Haiku
fallback) on **`idiom-queue`** and shared by everyone: meaning, character by character, the 典故 in simple Chinese
(pinyin + English per paragraph; source / era only when certain, uncertain or modern origins say so, a confidence
field), usage (roles, register, 褒义 / 贬义), collocations, examples easiest → hardest, the common mistake,
近义 / 反义, 2–3 "Try it" questions (practice only). Web `pages/IdiomsPage.tsx` / `IdiomPage.tsx`,
`services/idioms.ts` (IndexedDB `idioms`, Dexie v31 — opened entries read offline, narration prefetched through
practice TTS); Lab `ui/idioms/`, `data/idioms/IdiomStore.kt`, core `idioms/Idioms.kt`. The explorer's Word view
links a 成语 ("📜 Story & usage", `showIdiomLink`). E2E_TEST_MODE: `services/idioms-fake.ts`.
- `GET /api/idioms` → `{ starter, more }` (IdiomSummary rows with status) · `GET /api/idioms/:hanzi` → `{ idiom }` (status `missing` when never asked)
- `POST /api/idioms` `{ hanzi, retry? }` → get-or-generate: 200 ready / not_idiom, 202 generating; 400 not a possible 成语 key; 503 without AI
- `POST /api/admin/idioms/backfill` `{ limit? }` - admin: queue starter idioms with no entry yet

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

### Custom mini lessons (agent-authored, in the study session)
The generalized successor to the fixed-phase grammar lesson: a **schema-driven lesson**
(`shared/lesson`) that agents author — sections in any order, each holding any number of
exercises of any type. Exercise types: `note` (teaching text + example sentences with TTS),
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
transcribed server-side when a transcriber is configured) and `conversation` (a 2–3 speaker
dialogue played with a distinct TTS voice per speaker — `shared/lesson/voices.ts`, `voice_id`
on `/api/practice/tts`, cached per voice + speed for offline — then comprehension questions, one point
each, transcript revealed at the end). Conversation lines are spoken at the provider's own
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

Lessons are cached whole in IndexedDB (`customLessons`) and studied fully offline,
**mixed into the study session's card flow** — one is offered every ~8 card reviews
(`LESSON_MIX_INTERVAL` in useStudySession), leftovers run before the readers. NEW lessons are
paced per local DAY: at most **"New lessons a day"** (default 1, Settings → "Lessons & readers",
`new_lessons_per_day` in `users.revisit_settings`), oldest first, counted from completion events —
a lesson whose first finish is today (`newLessonsIntroducedToday` / `pickNewLessonsForToday`,
one-off homework left out). Lessons come back on the **"revisit later" schedule**, NOT
FSRS (`shared/study/revisit.ts`, Lab `core/…/Revisit.kt` parity-tested; docs/STUDY_SESSION.md
"Mini lessons"): the lesson ends with Again/Hard/Good/Easy (+ **✓ Done for good**), each
completion event carries the rating, and the next gap is Again 1 day · Hard 2 · Good 14 · Easy 42,
growing ×2 (Hard ×1.2) each later visit, capped at 180 (rating NULL on legacy events = Good). Done for
good / Bring back are `revisit_events` (migration 0110, `POST /api/me/revisit-events`, `revisit_events`
on `/api/sync/changes`); the gaps are per account (`users.revisit_settings`, Settings → "Lessons &
readers", `PUT /api/profile/revisit-settings`, `revisit_settings` on `/api/auth/me` + sync). Due
revisits re-enter the mix at most `MAX_LESSON_REVISITS_PER_DAY` (2) a day, most overdue first. Completions are
offline events (idempotent by id) uploaded in sync; other devices' completions come down
inside `GET /api/custom-lessons`. Authoring paths: the MCP `create_custom_lesson` tool, the in-app
Ask Claude chat's `create_custom_lesson` tool, or the REST endpoint. The shared exercise
views live in `frontend/src/components/lesson-exercises.tsx` (StudyGrammar reuses the
scramble/choice/translate ones). The **Mini Lessons page** (`/lessons`, in the profile
menu) inspects pending + completed lessons — full exercise listing per lesson, delete, and an
**Edit** link into the lesson editor (see "Lesson library & editor" below).
- `GET /api/custom-lessons` - Active lessons with parsed spec (`?status=done|all` for the rest)
- `POST /api/custom-lessons` - Create from `{ spec }` (validated; queues describe_image illustrations)
- `PUT /api/custom-lessons/:id` - Replace a lesson's spec in place (validated; same id so history/schedule carry over; keeps generated illustrations whose image_prompt is unchanged)
- `DELETE /api/custom-lessons/:id` - Delete a lesson
- `POST /api/custom-lessons/offline-complete` - Upload completion events (idempotent by event id); an event may carry `attempt` (per-exercise answers + time), stored in `custom_lesson_attempts`

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
- `GET /api/readers` (`?include_pages=true` for sync), `GET|DELETE /api/readers/:id`, `POST /api/readers/generate`
- `POST /api/readers/:id/retry` - Re-queue a FAILED reader in place (same id; status back to `generating`). The Readers list folds every failed reader into one "N failed generations" row with Retry / Delete / Delete all; raw API errors only appear behind "Show details" (`services/readerFailures.ts`). `ensureDailyReader` asks the server at most once per local date (`daily-reader-attempt` in localStorage) and the daily reader's failed row is reused on retry instead of a new one being created every session. **Read once, one a day** (`shared/study/daily-reader.ts`, Lab `core/…/DailyReader.kt` parity-tested; docs/STUDY_SESSION.md "Graded readers"): a reader with a review event is READ and never offered again (no reader scheduling — old reads open by hand from the Readers list, "✓ Read 3 Oct"); the session offers the newest UNREAD story, nothing more once one was read today, so an unread daily reader keeps being offered; `ensureDailyReader` generates a new story only when no unread story waits and nothing was read today (`shouldGenerateDailyReader`). After the last page: **Finish ✓** (no rating). **Listen-first**: every page's narration of the next unread story is cached on the device as soon as it exists (`cacheReaderNarration` in `prefetchReaderMedia`), and **▶ Play whole story** plays page after page, turning the pages, at the speed chip's speed — listening to the end counts as finishing (`reader.finish { how: 'listened' }`)
- `POST /api/readers` (blank), `PUT /api/readers/:id`, page CRUD + `reorder`, `publish`, `generate-image`, `generate-text` (older per-field routes in index.ts)
- `GET|PUT /api/readers/:id/spec` - The reader as a `ReaderSpec` / replace it whole (`{ spec }`; returns `image_jobs`)
- `POST /api/readers/import` - New reader from `{ spec }` (owner = caller; page ids never reused)
- `GET /api/readers/:id/export.md|json|csv`
- `POST /api/readers/:id/assist` - `{ field: 'english'|'image_prompt', chinese, english? }` → `{ text }` (503 without an API key)

**Reader word chips** (`shared/reader/words.ts`, `worker/src/services/reader-words.ts`, `routes/reader-words.ts`;
web `components/reader/ReaderWords.tsx` + `ReaderWordSheet.tsx` + `services/readerWords.ts`; Lab `core/ReaderWords.kt`,
`ui/readers/ReaderWordSheet.kt`). Every reading view (reader page, in-session reader, homework, Lab Today's story) shows
the revealed Chinese as tappable word chips. Each page carries `words` — `{ text, pinyin, gloss }` segments whose texts
**concatenate to `content_chinese` exactly** (punctuation, quotes and line breaks are segments with empty pinyin / gloss).
Made with Haiku via `structuredCall` (forced `split_words` tool, thinking off); `alignReaderWords` repairs whatever comes
back (unmatched stretches → one character per segment; < 85 % coverage is retried once). Made at story generation (queue
consumer), in the background after an editor save / import / page edit, copied with a shared reader, and lazily:
`POST /api/reader-words/backfill { reader_id?, limit? }` → `{ pages, remaining }` (≤ 12 pages of the caller's, that reader
first) — called when a reader opens and a couple of times per sync until none remain. Stale words (text edited since) are
never served (`parseReaderWords` / `ReaderWords.matches`). Until words exist the page is plain text. Tapping a chip opens
the word sheet: hanzi · pinyin · gloss, ▶, the sentence (`sentenceAround`), **More about this word**
(`POST /api/reader-words/explain { word, sentence, pinyin?, gloss? }` → explanation + card-standard `fun_facts` / sentence
clue, Haiku, cached server-side and on the device) and **+ Add as card** (deck picker, duplicate warning). Words already in a
deck get a quieter chip. (Before this, readers called `/api/sentence/analyze` per sentence on reveal — free-text JSON that
failed on pages with quotes / line breaks, all-or-nothing per page, and the in-session reader had no chips at all.)
- `GET|POST /api/editor-chat/reader/:id[/messages]`, `…/messages/:id/accept|reject` - the co-editor chat (see Lesson library & editor)

### Video calls (experimental — `worker/src/routes/calls.ts`, full design in docs/VIDEO_CALLS.md)
1:1 WebRTC lesson (video, whiteboard, chat, screen share) between the two sides of a tutor
relationship, or a solo test call. Signalling / whiteboard / chat go through the **CallRoom
Durable Object** (`worker/src/durable/call-room.ts`, binding `CALL_ROOM`, SQLite class); media is
peer to peer (STUN, plus Cloudflare Realtime TURN when `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` are
set). Each participant records **their own mic** (`frontend/src/services/calls/recorder.ts`: a new
MediaRecorder every 5 min = a standalone webm piece, 10 s chunks) into the IndexedDB upload queue
(`callUploads`, drained by `services/calls/uploads.ts` during the call and in every sync). After the
call `call-processing-queue` transcribes each piece (`services/calls/transcribe.ts`: Soniox if
`SONIOX_API_KEY`, else Gemini with the existing key — pinyin + translation per line — else Workers AI
Whisper; failures fall back to Whisper) and Claude writes the lesson report (`services/calls/report.ts`:
summary, corrections, card-standard vocabulary). Processing is readiness-driven
(`advanceCallProcessing`), so late uploads still get transcribed. Pages: `/calls` (list + start),
`/calls/:id` (the call, immersive; `hooks/useCall.ts` holds all the logic), `/calls/:id/review`.
- `GET /api/calls/ice-servers` · `GET /api/calls?relationship_id=&live=1` · `POST /api/calls` `{ relationship_id?, title? }` (posts a Join link into the relationship's chat)
- `GET /api/calls/:id` (call, participants, board, chat, pieces with `audio_url`, merged transcript, report) · `DELETE /api/calls/:id` (creator)
- `POST /api/calls/:id/join` → `{ ticket, ws_path, ice_servers }` — `GET /api/calls/:id/ws?ticket=` (WebSocket; one-minute HMAC ticket instead of the session, registered before the auth middleware)
- `POST /api/calls/:id/end` · `POST /api/calls/:id/process` (force-close stale pieces, retry failures, redo the report)
- **Presence & auto-end** (docs/VIDEO_CALLS.md "Who is in the call"): the CallRoom counts a socket as present while open, not `leave`-d and heard from in the last 45 s (`shared/calls/presence.ts` `planRoom`, alarm-driven); a call ends itself like End 10 min after the last person left, 10 min after creation if nobody ever entered. `GET /api/calls` rows carry `present_user_ids` (the room's `presence()` RPC, which also sweeps overdue rooms); banners / ring only for a call someone else is in and I'm not (`someoneElseInCall`). `POST /api/calls/:id/leave` `{ client_id, token }` = the pagehide beacon (before auth; token from `welcome.leave_token`). `POST /api/calls` returns the relationship's live call (`reused: true`) when someone is in it or it's < 10 min old — no duplicate calls when both press call at once
- `POST /api/calls/:id/pieces` · `PUT /api/calls/:id/pieces/:pieceId/chunks/:idx` · `POST /api/calls/:id/pieces/:pieceId/close`
- `POST /api/calls/:id/flashcards` `{ deck_id? | deck_name?, words }` → notes via the content service
- **Staying connected / joining** (docs/VIDEO_CALLS.md): the room socket carries a per-page `instance`; a reconnect from the same instance keeps the RTCPeerConnection (`shouldAdoptPeer`), a departed peer stays frozen 30 s, ICE restarts follow `nextIceRestartAt` (`shared/calls/connection.ts`, Lab `CallConnection.kt` parity-tested), encoders follow `videoEncodingFor`, and both sides send `diag` events → `calls.diagnostics_json` (migration 0085) → the review page's Connection log. Joining never needs devices: `services/calls/mediaAccess.ts` classifies getUserMedia failures (blocked / system / in-use / waiting…) with per-browser steps and Try again; Devices sheet picks camera / mic / speaker. The room relays text / board ops before persisting (coalesced, `allowUnconfirmed`); `text_cursor.compose` shows the other person's IME composition in their caret flag. Board / draw / chat are always light paper.
- **Layout** (docs/VIDEO_CALLS.md "Tiles & layout"): six tiles (remote / self / screen / text / draw / chat) arranged by the pure `shared/calls/layout.ts` (reducer, presets, `arrangeTiles`, `layoutRects`; Lab `CallLayout.kt` parity-tested) and drawn by `components/calls/CallTiles.tsx` (one element per tile, moved by transform — nothing remounts); the other person's camera is never hidden; phones = focus + swipe. With content on the stage both cameras float together as ONE faces box (theirs first, top-left, drag → snaps to a corner, grip resizes, tap → Speaker; `pip` / `pairCorner` / `pairScale`, `pairSize`, `TILE_HEADER`); ▦ → Cameras: Together / Separate is the only thing that changes `pip`, so a remembered "separate" wins, also when their share starts (`shareStarted`). Screen share rides its own (third) transceiver so camera + screen show together.
- **Board pages** (docs/VIDEO_CALLS.md "Board pages", `shared/calls/pages.ts`): the text board belongs to the relationship, as numbered pages across calls — a call opens on a new page, or continues the page used within 3 h on the same day; a thumbnail strip along the board's bottom (+, ⋯ Rename / Duplicate / Delete); each person turns pages on their own, **Follow <name>** / **Bring <name> here**; the room holds the pages (`page_*` messages) and writes them to `board_pages` + `call_board_pages`; `calls.board_text` = the pages written in that call (review page, report, homework agent unchanged). Outside a call the **Lesson board** `/connections/:relId/board` reads them (read-only, offline via IndexedDB `boardPages` / Lab JsonCache). `GET /api/relationships/:relId/board-pages`, `GET /api/me/board-pages`, `GET /api/calls/:id/board-pages` (`routes/board-pages.ts`). The drawing board stays per call.
- **Board**: the board tile is a shared text document first (`shared/calls/textDoc.ts`, an RGA CRDT kept and relayed by the CallRoom; `text` / `text_cursor` messages; carets + selections of the other person; IME-safe), Draw second; the text is saved as `calls.board_text` (migration 0081) → review page, lesson report, session-notes agent
- **Round 4 fixes** (docs/VIDEO_CALLS.md): the other person's board edits ALWAYS go into the document — the field shows a `TextView` (`shared/calls/textDoc.ts`, Lab `CallTextView`) and catches up when an IME composition ends, idles 1.5 s (`COMPOSE_IDLE_MS`; Gboard's lingering span) or blurs; remote carets are a line + dot, the name shows in the strip under the board; a failed / closed / never-started media link is renegotiated (`shouldAdoptPeer(…, pc)`, link ids + `hello`, `linkSignalAction`); mic / camera on-off are restored on rejoin (`DevicePrefs.micOff/camOff`, join waits ≤ 4 s for the preview); the room logs kind `call` lines (who entered / left / timed out / ended the call)
- **Lessons** (round 4, docs/VIDEO_CALLS.md "Lessons"): calls between the same two people within 2 hours (`LESSON_GAP_MS`, 20 min until round 5, `shared/calls/lessons.ts`) are ONE lesson — `call_lessons` + `calls.lesson_id` (migration 0089, back-filled); the review page, report (per lesson, rewritten as each call is transcribed), Past calls list and Make homework (once per lesson) work on the lesson (`services/calls/lessons.ts`). In the call, 🚪 Leave (the call goes on, Rejoin) is separate from End (for everyone, confirmed); an empty call ends after 10 min
- **Same view** (round 6, docs/VIDEO_CALLS.md "Same view", `shared/calls/view.ts`, Lab `CallView.kt` parity-tested): the stage (tiles, focus / split / grid, ratio, open boards, board page) is SHARED — either person's change goes through the CallRoom (`view` messages, `welcome.view`, last change wins in the room's order) and both screens apply it; cameras / faces box / rectangles stay per device; a share starting on either side goes on both stages. Top-bar chip 👥 Same view ✓ / 👤 My own view (per person, `state.view`), "Bring <name> to my view" (an invitation to someone on their own view). Replaces round 5's Show for student (an older app's `show` becomes a view change)
- **The tutor leads** (round 5, docs/VIDEO_CALLS.md "The tutor leads"; Show for student superseded by Same view): **Show for student** (in her stage tile's top-right control row — `TileSpec.actions`, the tile's own bars keep `--tile-chrome-w` clear —, never over the tile's tools; opening the board does it automatically) puts the same view on the student's stage once with a "Minghui is showing you this" pill — their own layout wins until she shows something new, board page turns follow while they're on the board; **Stop their share** on the student's screen tile. Room-enforced (relationship tutor only): `show` / `stop_share` → `shown` / `share_stopped`, `welcome.tutor_id` + `shown` (storage, reconnect-safe). Rules `shared/calls/follow.ts` (Lab `CallFollow.kt`, parity-tested). The camera always starts ON (`shared/calls/devices.ts`: never remembered off; a device opening while joining is announced)
- **Board tab-complete**: after typing Chinese and a 500 ms pause (no IME composition), a grey ` - pīnyīn - meaning` after the caret — Tab (web) / a "⇥ …" chip (touch, Lab) types it in through the CRDT; rules in `shared/calls/gloss.ts` (Lab `CallGloss.kt`, parity-tested); `POST /api/calls/:id/gloss { text }` → `{ pinyin, english }` (call members; Haiku via `structuredCall`, cached per text, 30 uncached/min per user; 503 without a key) — see docs/VIDEO_CALLS.md
- **Lesson materials** (docs/VIDEO_CALLS.md "Lesson materials", `shared/materials`, `routes/materials.ts`, `services/materials/`): More → 📑 Lesson materials (`/materials`, `/materials/:id`) uploads a PDF (pdf.js), PowerPoint (`frontend/src/services/materials/pptx.ts`: slide XML → text boxes + pictures on a canvas, `PPTX_RENDER_NOTE` = export as PDF for exact slides — no server converter / Container) or picture; the DEVICE draws the pages (1600 px JPEG) and uploads them. In a call ⋯ → 📑 Present material → the `material` tile for both (`material_open` / `material_page` / `material_close`; either turns pages; **☰ Contents** — the PDF outline / slide titles read on the uploader's device, `materials.toc`, else the pages by their first line — jumps both people to a section, `shared/materials/toc.ts`), Pen / Text over the page with annot messages carrying `target: material:<id>:<page>`, kept per page per lesson. Page pictures cached in the Cache API `materials-v1` (offline). The homework agent reads the presented materials (+ `list_materials` / `read_material` tools); MCP `list_materials` / `read_material`. `GET|POST /api/materials`, `PUT /api/materials/:id/original|pages/:n`, `POST …/complete`, `GET /api/materials/:id[/pages/:n/image|/original|/text|/annotations?lesson_id=]`, `PATCH|DELETE /api/materials/:id`, `POST …/share` `{ relationship_id }`, `DELETE …/share/:relId`
- **In-call activities** (docs/VIDEO_CALLS.md "In-call activities", `shared/call-activities`): ⋯ → 🎲 Activities starts a two-person activity from the catalogue for both (`activity` tile; plus **🎧 Review together**, kind `review`, built per call by `services/calls/review-activity.ts` from the student's "Needs your ear" queue + open flags + needs-work marks — clips play on both devices, the tutor's mark is a real mark; docs/RECORDING_REVIEW.md); the CallRoom runs the state machine (`activity_start` / `activity_action` / `activity_close` → `activity { session }`, `welcome.activity`); either person may start / end one, the relationship’s tutor is host (restart / swap), who may press what is ONE pure rule `mayAct` (guesser-only picks, Next for whoever’s turn it is, answers attributed `by`), big role badges, describe = 8 choices + "Words you needed" → + Add as card; roles a / b per activity, solo = both roles; results → `call_activities` → `GET /api/calls/:id` `activities` (review page) and the homework agent's notes. Web `components/calls/activities/`; Lab `ui/calls/ActivityTile.kt` + core `CallActivities.kt` (parity-tested)
- **Screen share sound + no mirror** (docs/VIDEO_CALLS.md "Screen share: sound", `shared/calls/share.ts`, Lab `CallShare.kt` parity-tested): `getDisplayMedia(displayCaptureOptions())` asks for the tab's / system's sound (`suppressLocalAudioPlayback: false`, `systemAudio: 'include'`, never the call's own tab); the sound rides a SECOND audio transceiver (4th m-line, added by renegotiation for a 3-m-line peer) — never mixed into the mic or the recording — played by the viewer's own `<audio>` (`CallAudio`), `state.screen_audio`; no sound (window / macOS screen / Safari / Firefox / the Lab app) → the sharer's note "Sound isn't shared — share a Chrome tab and tick 'Also share tab audio'". The SHARER's screen tile is a compact card (`SharingCard`: You're sharing your screen · ⏹ Stop sharing · ✏️ Draw on it · 👁 Show it here, `myShareTile`) instead of a mirror; the viewer's stage is unchanged
- **Drawing on a shared screen**: both people draw — the viewer over the other person's share, the sharer on their own screen tile (share bar → ✏️ Draw on it); pens default to a colour per role (`defaultAnnotColor`), **Keep** (`annot_mode`, shared) stops fading. The viewer draws / pings over the other person's share (`components/calls/AnnotationLayer.tsx`, `annot*` room messages, never stored); the sharer sees it on their preview and in a Document PiP mini window on Chrome desktop (`services/calls/annotationPip.ts`) — a browser can't draw on the real screen; the Lab app draws over every app (`ScreenAnnotationOverlay.kt`)
- **Finding the call** (docs/VIDEO_CALLS.md): `shared/calls/alerts.ts` decides the "📹 <name> is calling — Join" banner (Home card, a bar on every normal page — `components/calls/CallAlerts.tsx` in App.tsx —, the student / tutor page, the chat) and the in-app ring; `POST /api/calls` also sends Web Push (`services/push/`, WebCrypto VAPID + aes128gcm; `public/push-sw.js` in the service worker), "Missed video call" when they never joined. `GET /api/push/config`, `POST|DELETE /api/push/subscriptions`, `POST /api/push/test`, `PUT /api/profile/call-alerts { call_alerts: ring|silent }` (Settings → Video call alerts)

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

### Usage analytics (`docs/ANALYTICS.md`; `shared/analytics/`, `routes/analytics.ts`, `services/analytics/`)
What people do in the apps, so Claude (MCP, admin) can say "Minghui hasn't used X yet" / "she still uses the old Y".
**Every new user-facing feature must emit its catalogue event(s)**: one line in `shared/analytics/events.ts`
(+ the Kotlin mirror `android-lab/core/…/analytics/AnalyticsEvents.kt`, parity-tested; `replacedBy` when it
supersedes an older path) and one call — web `track('area.event', { … })` (`frontend/src/services/analytics.ts`),
Lab `app.analytics.track(…)` (`data/analytics/`), worker `trackServer(…)`. **Privacy rule: ids, enums, counts,
durations, booleans only — never message text, card content, answers, recordings, tokens, URLs or e-mails**;
`sanitizeProps` (`shared/analytics/privacy.ts`) enforces it on the device and again on the server.
- Clients queue events offline (web: own IndexedDB `usage-analytics`; Lab: own Room db) and upload in sync + every
  ~60 s: `POST /api/me/usage-events { events }` (idempotent by id; NOT `/api/analytics/events` — EasyPrivacy's generic `/analytics/event` rule makes content blockers drop it in the browser; the old path stays for old Lab builds) → D1 `usage_events` (migration 0100). Screen
  views (route pattern + time on screen) come from ONE router hook per app.
- Server: `trackServer` for content created / homework assigned / push / e-mail; every Anthropic + Gemini call's
  tokens and estimated cost via a `fetch` wrapper (`services/analytics/ai-usage.ts`) and an AsyncLocalStorage
  request scope (`scope.ts`, compat flag `nodejs_als`); one JSON log line per request with the route pattern
  (`request-log.ts`, Workers Observability, sampling 1.0).
- Switches: `ANALYTICS_LEVEL` = off | basic | verbose (default); per user Settings → Advanced → "Share usage data"
  (`PUT /api/profile/analytics { share_usage }`, `users.analytics_opt_out`, off deletes their rows; `share_usage`
  on `/api/auth/me`). The daily cron (`[triggers]`, `scheduled()` in index.ts) prunes rows older than 180 days.
- Admin endpoints `GET /api/admin/usage/summary|adoption|timeline|counts|errors|ai` → MCP tools `usage_summary`,
  `feature_adoption`, `user_timeline`, `event_counts`, `recent_errors`, `ai_usage` (`mcp-server/src/tools/usage.ts`).

### Conversation voices (`worker/src/routes/conversation-voices.ts`, `services/conversation-voices.ts`)
- `GET /api/conversation-audio` - the account's conversation-audio prefs + the active provider, its default speed, speed steps, voices (with the deliveries each supports)
- `PUT /api/conversation-audio` - partial update `{ speed?, delivery?, voices?: { <provider>: { female?, male? } }, exercise_voices?: { "<provider>:<key>": [voice|null…] | null } }` (400 + `problems`)
- `POST /api/practice/tts` with `kind: 'conversation'` - a conversation line: `speed` = the provider's own rate (clamped), `delivery`, `regenerate`; `voice_id` may be any provider's conversation voice
- `GET /api/conversation-voices` - catalogue + `enabled`, `customised`, `default_enabled`, `default_source` (admin | app), `is_admin`, `speed`
- `PUT /api/conversation-voices` - `{ enabled: string[] }` (known ids, ≥ 1 female and ≥ 1 male; 400 with `problems`) or `{ reset: true }`; an admin's selection is everyone else's default
- `GET /api/conversation-voices/sample?voice=` - `{ audio_base64, content_type }`: the sample line in that voice, MiniMax only (no fallback voice), made once and kept in R2 (`voice-samples/v1/…`)

### Stats
- `GET /api/stats/overview` - Overall statistics
- `GET /api/stats/deck/:id` - Deck statistics

**Characters & words known** (Progress page, `shared/progress/known.ts`, Lab port `core/…/Known.kt`,
parity-tested): computed on the device from notes + cards + review events, so it works offline. A
card is *known* when its replayed state is mature (Review, stability > 21 days — the deck page's
"mastered"); a note takes its best card; a note is a **word** with 1–4 Han characters and no sentence
punctuation (else a sentence), counted once per spelling; a **character** is known when it appears
in any known note. The history chart replays every card with `computeCardTimeline`
(`shared/scheduler`) — ~1 s of FSRS for 35k events, so the web runs it in a Web Worker
(`services/knownProgress.worker.ts`) and shows the last result from localStorage meanwhile. The
tutor's `GET /api/relationships/:relId/student-progress/daily` carries `known` (same grouping via
`knownCountsFromTiers`, from the server's cached card state — `services/known-counts.ts`). No HSK
list is in the repo, so there is no HSK coverage yet.

### "Needs your ear" — recording review queue (docs/RECORDING_REVIEW.md)
Every uploaded pronunciation take gets a background check on **`recording-check-queue`**
(`services/recording-checks.ts`, table `recording_checks`, migration 0109): a transcript (`transcribeTake`) compared
with the card like the study card's ✅ (`shared/recordings/transcript.ts`, pinyin with tones) and an **Azure
Pronunciation Assessment** score per character (`services/pronunciation/azure.ts`, zh-CN scripted, REST short
audio; `pronunciation/audio-convert.ts` remuxes WebM/Opus → Ogg/Opus and resamples WAV; F0 limits kept:
18 req/min, 4.5 audio h/month). Queue rule `shared/recordings/queue.ts` (`reviewQueueReasons`: transcript
mismatch, Again / Hard, score < 85, a character < 80, an open flag; a mark takes it out; thresholds conservative).
`GET /api/relationships/:relId/recordings/queue?view=queue|all` → items with `labels` ("Sounded off: 银 (tone)");
the recordings page has **Needs your ear** / **All recordings** tabs (web + Lab), `pills.recordings_need_ear` on the
dashboard, MCP `list_student_recordings` `queue: true`. **Mix-ups** (`shared/recordings/mixups.ts`): confused
character pairs from wrong typed characters + multiple-choice picks → insights `mix_ups`.

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
- `PUT /api/relationships/:relId/recordings/:eventId/mark` - `{ status: listened|needs_work, comment? }`
- `DELETE /api/relationships/:relId/recordings/:eventId/mark`
- `GET /api/relationships/:relId/history?from&to&deck_id&card_type&rating&q&cursor&limit` -
  Flat review events newest first (keyset cursor); the "by word" view groups client-side

Student side of the marks (`worker/src/routes/recording-notes.ts`; migration 0066 adds
`tutor_recording_marks.student_seen_at`): a needs-work comment is shown once under the pinyin
on the back of that card ("From <tutor>: …"), cached in IndexedDB (`recordingNotes`) by
`services/recording-notes.ts` during sync so it works offline. See docs/STUDY_SESSION.md.
- `GET /api/me/recording-notes` - Unseen needs-work notes on my recordings (event, card, note, hanzi, comment, tutor name) **plus** unseen tutor replies to my flagged cards (`kind: 'flag'`, `event_id` = the flag id, `card_id` may be null → matched on note_id)
- `POST /api/me/recording-notes/:eventId/seen` - I have seen this note (idempotent, scoped to my own events; a flag id marks that reply seen)
- `GET /api/me/tutor-notes?include_seen=1&limit=&before=` - The **Tutor notes page** (`/tutor-notes`): every note, new AND seen, newest first, keyset paged (`next_cursor`), with the card's pinyin / meaning / card type, `seen_at`, my `recording_url` and, for a flag, my `student_message`. Cached by each sync (IndexedDB `tutorNotes`, Dexie v22; Lab JSON cache) so the page works offline; the unseen feed still decides what is NEW (`mergeTutorNotes`, `shared/tutor-notes`). Viewing marks the new ones seen. Home shows "🗒 N new notes from <tutor>" while any is unseen. **Practice this card / Practice all** → `/tutor-notes/practice?cards=&notes=` (immersive): the study card, the note pinned on the back; **a rating is a review only when the card is due today** (`practiceRatingCounts` = `isDueByCutoff`), otherwise practice only — no review event (docs/STUDY_SESSION.md)

### Card flags & card hub (`worker/src/routes/card-flags.ts`, `routes/claude-chats.ts`, `services/card-flags.ts`)
A student flags a card for their tutor from the study screen (⋯ → **Flag for tutor**,
`components/study/FlagCardSheet.tsx`; only with a human tutor) or from the card's hub page. Offline-first:
`services/cardFlags.ts` writes `pendingCardFlags` (Dexie v17) with a client id, posts at once when online,
else in sync (`uploadPendingCardFlags`); `POST /api/card-flags` is idempotent by id. Every flag and every
reply is also mirrored into the relationship's chat as a message from the sender (`flagChatMessage` /
`replyChatMessage`), so the usual unread badge fires. The tutor's reply resolves the flag and reaches the
student once on the card back through the recording-notes feed (above). Tutor side: **Flagged cards** and
**Asked Claude** sections on the student page (`components/tutor/FlaggedCardsSection.tsx`,
`ClaudeChatsSection.tsx`), a `🚩 n flagged cards` pill (`pills.flags_open`) on the dashboard card, and the
MCP tools `list_card_flags` / `reply_to_card_flag` / `list_student_claude_chats`. Student side: **Cards you
flagged** on their tutor page, **More → Claude conversations** (`/claude-chats`). The **card hub page**
(`pages/CardHubPage.tsx`: `/cards/:noteId` for the owner, `/connections/:relId/cards/:noteId` for the tutor)
shows the note, each card's state, flags (with reply box / flag form), every Ask-Claude thread about it and
the recent reviews; the deck page's History modal links to it. Shared list/thread components live in
`components/cardFlags/`.
- `POST /api/card-flags` - student: `{ id?, relationship_id, note_id, card_id?, message, created_at? }` → `{ flag, created }` (201 new, 200 existing id)
- `GET /api/relationships/:relId/card-flags?status=open|resolved|all&limit=` - either party → `{ flags, open }`; flags carry hanzi/pinyin/english/deck_name/card_type/student_name/tutor_name
- `POST /api/card-flags/:id/reply` - tutor: `{ reply }` → resolves + chat message + shown to the student once on the card
- `POST /api/card-flags/:id/resolve` | `/reopen` - either party; `DELETE /api/card-flags/:id` - the student who sent it
- `GET /api/me/claude-chats?limit&before&note_id` and `GET /api/relationships/:relId/claude-chats…` (tutor) - Ask-Claude Q&A rows newest first with note + deck fields, keyset paging on `asked_at` (`next_cursor`), `total`
- `GET /api/notes/:noteId/hub` (owner) and `GET /api/relationships/:relId/notes/:noteId/hub` (tutor) - `{ note, deck, owner, cards[], recent_reviews[], review_count, questions[], flags[] }`

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

### Homework assignments: one-off passes with due dates (`worker/src/routes/homework.ts`, design in docs/HOMEWORK.md)
Anything a tutor sends is an **assignment** with a `mode`: `one_off` (a single pass by a due date — NOT spaced
repetition), `fsrs` (long-term review, what sharing always did) or `both`. `services/homework.ts`
`assignHomework` copies each item through the usual paths (`shareDeck` — now with `excludeNoteIds` so words the
student already has are left out, matched on normalised hanzi — `createAssignedLesson`, `shareReader`) and writes
the rows (`assignmentRowsFor`: a one-off deck split over N days = N rows with consecutive due dates). A one-off-only
deck copy gets caps 0 + 0 so the FSRS budget never introduces it (the deck page says so and offers *Add to my daily
review*); one-off-only lessons / readers are left out of the session mix / daily reader on the client
(`oneOffOnlyTargetIds`). **Student**: `services/homework.ts` syncs `homeworkAssignments` / `homeworkEvents`
(Dexie v19) in every sync; Home shows the **Homework** card (overdue first, labels "overdue" / "due today" /
"due in N days", `dueLabel`); `/homework` lists all; `/homework/:id` is the pass (immersive): a word list shows each
word once, *Not yet* words come back until *Got it* (`passProgress`), a lesson / reader plays once in the regular
player — finishing a lesson / reader anywhere records the `done` event (`recordTargetDone`). **Tutor**: the Send
homework sheet has One-off / Long-term / Both + due date + "spread over N days" + "leave out words they already
have" (`HomeworkModePicker`); the student page's Homework section shows the **load gauge** (`LoadGauge`,
`computeHomeworkLoad`: pending one-off items / words, overdue, next 7 days, FSRS words to go ~days at their budget,
light / moderate / heavy) and the open one-off assignments with the student's progress (tap: move date / cancel).
Lesson types and future kinds plug into this model — never a second queue (contract in docs/HOMEWORK.md §2).
- `GET /api/me/homework` - The student's assignments + events of active ones (offline sync)
- `POST /api/me/homework/events` - `{ events: [{ id, assignment_id, item_id, result, created_at }] }` → `{ accepted, assignments }` (idempotent; progress recomputed)
- `GET /api/relationships/:relId/homework?today=` - tutor: `{ assignments, load }`
- `POST /api/relationships/:relId/homework` - tutor: `{ items: [{ kind, source_id, mode, due_date?, split_days?, priority?, skip_known?, include_known? }], today? }` → 201 `{ assignments, skipped, errors, copies }` (`copies`: the student's copy + share id per item). Every tutor send path defaults to `both`, due at the next logged lesson else in two days (`DEFAULT_SEND_MODE`, `defaultHomeworkDueDate`; docs/HOMEWORK.md §4a): the Send homework sheet, the library Assign sheet, the MCP send tools (`mcp-server/src/tools/homework-send.ts`)
- `PATCH /api/relationships/:relId/homework/:id` - tutor: `{ due_date?, status?: 'cancelled' | 'active' }`

**Homework library, link homework, updating students' copies** (`routes/homework-library.ts`, `services/homework-library.ts`,
pure rules `shared/homework/library.ts` + `link.ts`; docs/HOMEWORK.md §8–10). The **library** is one row per thing a tutor
sent (deck copy / lesson / reader / link) built by `buildHomeworkLibrary` from the share rows + the assignments on the same
copy: sent, due, kind, % (pass words / words met / lesson completed / reader read / link done) and status Completed (green) ·
In progress (blue, amber when due today / tomorrow) · Overdue (red) · Not started (grey) (`libraryStatus`, `statusTone`).
A deck sent for long-term review only is **In long-term review** (grey, no %; docs/HOMEWORK.md §11).
Web: `/connections/:relId/homework` (one student) and `/homework-library` (all; More → Teaching, Students dashboard) —
`pages/tutor/HomeworkLibraryPage.tsx`, `components/tutor/library/` (filters, row actions Open · Edit · Update their copy ·
Change due date · Remove); **Most recent homework** (`mostRecentHomework`: newest + whatever was sent within 30 min, max 3)
at the TOP of the student page (`RecentHomeworkCard`) and one line on each dashboard card. Students see the same statuses on
`/homework` (`itemStatus`) and their tutor page lists that tutor's items. **Link homework** (tutor-first: made in her account,
nothing reaches a student until she sends it): Send homework → 🔗 A link (`LinkHomeworkForm`), the student's `/homework/:id`
is `components/homework/LinkPass.tsx` (Open link ↗ in the browser — nothing embedded —, Mark as done + optional note,
offline-first). **Update copies on save**: after saving a sent deck word (deck page), library lesson (lesson editor), reader
(reader editor) or link, `UpdateCopiesPrompt` offers "Also update <student>'s copy" per student, default on.
- `GET /api/relationships/:relId/homework-library?today=` → `{ items, counts, today }` · `GET /api/tutor/homework-library?today=` → `{ students, items, counts, today }`
- `GET|POST /api/homework-links` (`{ title, url, instructions? }`, 400 + `problems`) · `PUT /api/homework-links/:id` (+ `update_student_copies?: true | relId[]` → `copies`) · `DELETE` (soft); send with `POST …/homework` `{ items: [{ kind: 'link', source_id, due_date? (null = none) }] }`
- `GET /api/student-copies?kind=deck|lesson|reader|link&source_id=` → `{ copies: [{ relationship_id, student_name, target_id, share_id, behind }] }` · `POST /api/student-copies/update` `{ kind, source_id, relationship_ids? }` → `{ updated, results }` (deck = `updateSharedDeckCopy`; lesson = `pushLibraryLessonUpdate`, `services/lesson-push.ts`; reader = `updateSharedReaderCopy`, pages matched by position, the copy's page ids kept; link = the sent assignments' snapshot)

**Lesson notes → draft → review → assign** (`routes/homework-drafts.ts`, `services/homework-drafts.ts`): the student
page's **Lesson notes** section (`components/tutor/LessonNotesSection.tsx`, replaces Session notes) lists
`tutor_lesson_log` entries (+ `title`, migration 0073) with their homework state (No homework yet · Drafting… ·
Draft ready → Review · Assigned). *+ Add lesson notes* saves an entry and, by default, starts a DRAFT: a
session-notes job with `review = 1` — the same agent/queue/checkpoints, but it never shares; the briefing carries
the student's load and says DRAFT; extra tools `remove_cards`, `update_card`, `set_plan`; `finish` writes the
reply into `chat` and a plan into `plan` (`DraftPlan`, `shared/homework/plan.ts`). The review page
`/connections/:relId/homework/:jobId` (`pages/tutor/HomeworkDraftPage.tsx`; side-by-side at ≥1024px, Draft / Claude
tabs on phones) shows the load gauge now → after, the words with the ones the student already has skipped
(*Include anyway*), per item One-off / Long-term / Both + due date, "spread over N days", and a Claude chat: a
message is appended to the job's transcript (`appendTutorRequest`) and the job is re-queued, so revisions reuse
the whole agent. **Assign** (`assignDraft`) turns the plan into assignments through `assignHomework`
(`batch_id` = the job), once. E2E seeds a finished draft with `POST /api/test/homework-draft`.
- `GET|POST /api/relationships/:relId/lesson-notes` - entries with their draft job / `{ notes, title?, lesson_at?, draft? }` (draft default true → 201 `{ entry, job }`)
- `POST /api/relationships/:relId/lesson-notes/:logId/draft` - draft homework from an existing entry → 202
- `GET /api/relationships/:relId/homework-drafts/:jobId?today=` - the review view (`words` with `known` / `skipped`, `plan`, `load`, `load_after`, `job.chat`, `assignments`)
- `PUT …/homework-drafts/:jobId/plan` `{ plan }` · `POST …/messages` `{ message }` → 202 (503 without a key; 409 while running / once assigned) · `POST …/assign` → 201 `{ assignments, skipped, errors }` (409 twice)

### Invites & access requests (invite-only sign-up; `worker/src/routes/invites.ts`)
- `GET /api/invites/:id/public` - **No auth.** What the `/join/:token` page shows: inviter name/avatar, `valid`, `status`, `email_bound` (never the email itself)
- `GET /api/invites` - Invites I created (`?all=1` for admins: everyone's), each with `url`, `status`, `redemptions`
- `POST /api/invites` - Create one (needs `can_invite` or admin): `{ email?, inviter_role?: 'tutor'|'student'|null, share_deck_ids?, max_uses?, expires_in_days?, note? }` → invite with `url`
- `DELETE /api/invites/:id` - Revoke (owner or admin)
- `POST /api/invites/:id/redeem` - A signed-in user accepting someone's link (relationship + decks, no new account)
- `GET /api/admin/access-requests` - Pending uninvited sign-in attempts (`?status=all|approved|dismissed`)
- `POST /api/admin/access-requests/:id/approve` - Creates an email-bound invite from the admin; the person just signs in again
- `POST /api/admin/access-requests/:id/dismiss`
- `PUT /api/admin/users/:id/can-invite` - `{ can_invite: boolean }`
- `GET /api/auth/login?invite=<token>` - Starts Google sign-in with the invite riding in the OAuth `state`

Invite rows also carry `welcome_message` (optional; `POST /api/invites` accepts it, and on the
first redemption `deliverWelcomeMessage` in `services/signup.ts` posts it as the inviter's first chat
message in the relationship's conversation + an unread notification) and `opened_at` (set by the
first `GET /invites/:id/public`, i.e. the /join page loading — the tutor's list shows
"Link opened · not signed in yet"). Migration 0065.

### Student onboarding & home (`worker/src/routes/onboarding.ts`)
- `GET /api/me/onboarding` - What a new invitee's first-open screen needs: `invited`, `inviter`
  (name/picture), `inviter_role`, `relationship_id`, `welcome_message` + `welcome_conversation_id`,
  `decks` copied by the invite (id/name/note_count), `has_reviewed`/`review_count`. The client
  (`components/onboarding/useOnboarding.ts`) caches it in localStorage and shows `FirstOpenScreen`
  while the user came in via a tutor invite and has zero reviews (server and local); after the
  first review the normal home renders. `FirstCardExplainer` (rendered once by StudyPage) shows a
  three-line explainer over the first card when there are no review events yet.
- `POST /api/decks/starter` - Idempotent: creates the caller's built-in **"Starter Chinese"** deck
  (`services/starter-deck.ts`, 15 words with tone-marked pinyin + one example sentence each, word and
  sentence TTS generated after the response) or returns the existing one by name. The invite sheet
  preselects it and requires at least one deck when inviting a student.
- The student home (`pages/HomePage.tsx`, `components/home/`) is one **Study today's cards** button
  with a plain subtitle ("24 cards due · about 8 min", ~20 s/card; four-colour breakdown behind ⓘ),
  the "🗒 N new notes from <tutor>" row, ONE compact **From <tutor>** homework card
  (`HomeworkHomeCard.tsx`: a slim row per active item — title, "5 / 12", due label — from the shared
  `homeHomework`, `shared/homework/home.ts`; a tap opens the pass / the deck; an unread tutor message is
  one small line), a slim one-line top-5 deck list linking to `/decks`, and one
  **+ Add a deck** link (modal with "Generate with Claude" inside). It never says "Flashcards done"
  until a full sync has completed once (`hooks/useSyncStatus.ts`).

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

### Tutor accounts (users.role = 'tutor')
Set by the admin (sheet or `admin_set_role`). `useNavRole` exposes `isTutorAccount` (from the signed-in user, never waits
for relationships): tabs **Students · Decks · Library · More** (`tabsFor`), landing always Students unless "Start on" says
otherwise (`resolveLanding`), `/` renders `components/home/TutorHome.tsx` (students, Make, "Try it as your student") instead
of the study home — no streak, due-card button, homework card or learner onboarding; More shows Teaching / Tools; the
background sync generates no daily story (`services/accountRole.ts`). **Try it** previews record nothing:
`/decks/:id/try` (`pages/DeckTryPage.tsx`, a card viewer over IndexedDB in any of the three card types; the tutor's deck
page shows "▶ Try it as a student" instead of Study) and `/library/:id/try` (`pages/editor/LessonTryPage.tsx`, the real
`StudyCustomLesson` with `preview`: no counts, no rating, no completion event). Both are immersive routes.

## Invite-only sign-up

**A Google sign-in for an email with no `users` row creates a user only if an invite admits it.**
The gate lives in the `/api/auth/callback` handler (`worker/src/index.ts`) and
`worker/src/services/signup.ts`:

1. `findExistingUser` — existing users (by google_id, then email) always get in; nothing changes for them.
2. Otherwise `resolveSignup(db, googleUser, { inviteToken, adminEmail })` tries, in order:
   the invite token carried in the OAuth `state` (from `/join/<token>` → `/api/auth/login?invite=`),
   a still-valid `invites` row bound to the Google email, a `pending_invitations` row whose
   inviter has `can_invite`/is admin (the pre-existing email-invite path), and finally
   **`ADMIN_EMAIL`, which is permanently invited so the admin can never lock themselves out.**
3. No match → **no user is created**; the attempt is upserted into `access_requests` (one ntfy
   ping via `NTFY_TOPIC` the first time) and the browser lands on `/?signup=invite_only`.
   A valid link whose invite is bound to a *different* email → `/?signup=email_mismatch&inviter=…`.
4. A match → `createUser`, then `redeemInvite` (idempotent, awaited before the redirect so the
   first screen already has the deck): records the redemption, creates the relationship in
   `active` status with the inviter in `inviter_role`, and copies `share_deck_ids` via the
   existing `shareDeck`. An *existing* user who opens a `/join` link is also redeemed (no account
   change) so a tutor can connect current students the same way.

**Who may invite** is `users.can_invite` (admin page toggle; admins always may). It gates
`POST /api/invites` and the email path of `POST /api/relationships` when the target has no
account; connecting with an existing user stays open to everyone. Invite tokens are 32 random
bytes base64url — treat them as bearer secrets (don't log them). `E2E_TEST_MODE`'s
`/api/test/auth` still creates users directly.

## Common Tasks

### Add a new API endpoint
1. Create handler in `worker/src/routes/`
2. Register route in `worker/src/index.ts`
3. Add API client function in `frontend/src/api/`

### Modify database schema
1. Create new migration file in `worker/src/db/migrations/`
2. Update types in both worker and frontend
3. Test locally with `wrangler d1 migrations apply`

### Add a new card type
1. Update `CardType` enum in types
2. Update card generation logic in `worker/src/services/cards.ts`
3. Update study flow in frontend

## MCP Server

The app includes an MCP (Model Context Protocol) server that allows AI assistants like Claude to interact with your vocabulary data.

### MCP Server URL (Streamable HTTP)
`https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp`

### Architecture Overview

Tool modules live in `mcp-server/src/tools/` (`students.ts`, `content.ts`, `apps.ts`) and call the main API
through `ApiClient` (`mcp-server/src/api.ts`) as the signed-in user — each call mints a short-lived
`auth_sessions` token and revokes it afterwards — so tutor access checks stay in the API worker.

The MCP server uses several key technologies:
- **`@cloudflare/workers-oauth-provider`**: Wraps the worker with OAuth 2.1 support
- **`agents/mcp` (McpAgent)**: Class-based MCP server pattern from the `agents` package
- **Hono**: HTTP routing framework for the OAuth flow endpoints
- **Google OAuth**: User authentication via Google Sign-In

### Critical Implementation Details

#### 1. SQLite-Backed Durable Objects (IMPORTANT!)

The `McpAgent` class **requires SQLite-backed Durable Objects**. This is a common pitfall:

```toml
# wrangler.toml - CORRECT configuration
[durable_objects]
bindings = [
  { name = "MCP_OBJECT", class_name = "ChineseLearningMCPv2" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ChineseLearningMCPv2"]  # Must use new_sqlite_classes, NOT new_classes!
```

If you see this error, the Durable Object is not SQLite-backed:
```
Error: SqlError: SQL query failed: This Durable Object is not backed by SQLite storage
```

**Note**: An existing non-SQLite class cannot be converted. You must create a new class with a different name using `new_sqlite_classes`.

#### 2. OAuth Flow Implementation

The `OAuthProvider` does NOT auto-handle the authorization UI. Your `defaultHandler` must implement:
- `GET /authorize` - Parse OAuth request, store state in KV, redirect to Google
- `GET /callback` - Exchange Google code for tokens, get user info, call `completeAuthorization()`

```typescript
// Key pattern in callback handler:
const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
  request: oauthReqInfo,  // Original OAuth request from KV
  userId: user.id,
  metadata: { label: user.name || user.email },
  scope: oauthReqInfo.scope,
  props: { userId, userEmail, userName },  // Passed to McpAgent
});
return c.redirect(redirectTo);
```

#### 3. Required Secrets

Set these via `wrangler secret put`:
- `GOOGLE_CLIENT_ID` - From Google Cloud Console
- `GOOGLE_CLIENT_SECRET` - From Google Cloud Console
- `COOKIE_ENCRYPTION_KEY` - Generate with `openssl rand -hex 32`

#### 4. Google OAuth Setup

In Google Cloud Console, add this callback URL:
```
https://chinese-learning-mcp.jeromeswannack.workers.dev/callback
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_decks` | List all decks with stats (note count, cards due, mastered) |
| `get_deck` | Get a deck with all its notes |
| `get_deck_progress` | Get detailed study progress for a deck |
| `create_deck` | Create a new deck (`POST /api/decks`; shared defaults: 3 new + 6 secondary cards a day) |
| `update_deck` | Update deck name/description and SRS parameters (interval_modifier, request_retention, easy_interval, maximum_interval) |
| `delete_deck` | Delete a deck and all its notes |
| `add_note` | Add a vocabulary note incl. example sentence (`POST /api/decks/:id/notes`; TTS in the background) |
| `batch_add_notes` | Add up to 500 notes in one `POST /api/decks/:id/notes/batch`; duplicates skipped, per-row failures listed |
| `search_notes` | Search notes by hanzi/pinyin/english across all decks (or one deck) — check before adding to avoid duplicates |
| `batch_search_notes` | Dedup-check many candidate words in one call — use instead of looping `search_notes` when clearing a whole homework list against existing notes |
| `move_notes` | Move notes to a different deck, keeping SRS state and history (`POST /api/notes/move`) |
| `update_note` | Update an existing note |
| `delete_note` | Delete a note |
| `get_note_cards` | Get all cards for a note with their SRS state |
| `set_card_familiarity` | Set familiarity level (new/seen/familiar/well_known/mastered) |
| `update_card_settings` | Fine-grained control over card scheduling |
| `batch_set_familiarity` | Set familiarity for multiple notes at once |
| `get_note_history` | Get review history and Q&A for a note |
| `check_deck_for_errors` | Word check of a whole deck (yours, or a student's copy with `relationship_id` + `shared_deck_id`): waits for the run, returns proposals (current → proposed + reason) and the cost; changes nothing |
| `apply_note_fixes` | Apply ONLY the fixes the user approved: `job_id` + `proposal_ids` (+ `also_source`), or `fixes: [{ note_id, issue_id }]` from a create tool's `check_warnings` |
| `create_custom_lesson` | Author a custom mini lesson (sections of exercises) for the user's next study session |
| `list_custom_lessons` | List custom mini lessons (pending and completed) |
| `get_custom_lesson` | Get one lesson with its full spec (fetch before editing) |
| `update_custom_lesson` | Replace a lesson's content in place (same id — completion history + revisit schedule kept) |
| `delete_custom_lesson` | Delete a custom mini lesson |
| `get_due_cards` | Get cards due for review |
| `get_overall_stats` | Get overall study statistics |
| `study` | **MCP App** - Opens an interactive flashcard study session in the UI |
| `create_audio_lesson` / `get_audio_lesson` / `list_audio_lessons` | Audio lessons (`tools/audio-lessons.ts`): start one — the description says when to use which: dialogue (practise a situation: `description` / `dialogue`), sleep (learn a text's new words: `text`), story (listen & repeat a whole pasted story / conversation: `text`, ≤ 6,000 characters, ≤ 60 min, `notice` when cut, no `target_minutes`); a tutor's `for_relationship_id` is only a label / status, chapters, transcript, usage / the list |
| `get_audio_lesson_feed` | The signed-in user's private podcast feed URL of their audio lessons (`GET /api/me/podcast-feed`; made on first use) + podcast:// link; private — give it to the user only |
| `get_idiom` / `list_idioms` | 成语 Idioms (`tools/idioms.ts`): one idiom's entry — meaning, 典故, usage, examples, quiz; generated when missing (waits up to 90 s), `caution` when not high confidence, `app_path` to point a learner at it / the starter list + looked-up idioms. Read / generate only, sends nothing |
| `list_picture_hunts` / `create_picture_hunt` | The user's picture hunts (status, objects, best score) / start one from a scene description (`tools/picture-hunts.ts`) |
| `list_folders` / `create_folder` / `rename_folder` / `delete_folder` / `move_to_folder` | Folders for decks, library lessons and readers (`tools/folders.ts`): list with paths + item counts, create (one level inside a top-level folder), rename / re-parent, delete (items → Unfiled, nothing deleted), file items by `folder_id` or by folder name (found or made). `list_decks`, `list_lesson_library`, `list_readers` show each item's folder and take a `folder_id` filter (`'unfiled'`); `create_deck`, `create_library_lesson`, `create_reader`, `generate_reader` take `folder_id` / `folder` |
| `bump_cards` / `list_bumped_cards` / `clear_bumped_card` / `bump_student_cards` | "⚡ Study it today" (`tools/bumps.ts`): put words the user ALREADY has first in today's study (note_ids or hanzi; new cards even past the daily limit) instead of adding duplicates / the pocket / take one out / the tutor bumps a student's cards (the student sees "⚡ from <tutor>"). `search_notes` / `batch_search_notes` point at it |
| `list_materials` / `read_material` | Lesson materials the user owns or has been shared (PDFs, slides, pictures: title, pages, has text) / one material's text page by page with speaker notes (`tools/materials.ts`) |

#### Create, then send (every tutor tool)

Minghui (Oct 2026): an agent sent a 319-word deck she never meant to send. The rule, in the server
`instructions` (`CREATE_THEN_SEND`) and every description: **create content in the tutor's own account;
never send anything to a student unless the tutor explicitly asks to send that item to that named student
in this conversation; when in doubt, create it and ask.**
- **Create tools** (`create_homework_deck`, `create_deck`, `batch_add_notes`, `add_words_to_student_deck`,
  `create_reader`, `generate_reader`, `create_library_lesson`, `duplicate_library_lesson`,
  `submit_session_notes`, `add_student_lesson_notes`) never reach a student; replies carry `sent: false` and
  "Saved in your account (not sent). Say "send it to <student>" to share."
- **Send tools** (`share_deck_with_student`, `update_student_deck_copy`, `assign_lesson_to_students`,
  `push_lesson_update`, `share_reader_with_student`, `assign_homework`, `assign_homework_draft`,
  `send_session_notes_items`) start their description with `SEND_RULE`, require `relationship_id`(s) and
  `confirm: true` (`CONFIRM_SEND`, a zod literal; the handler also refuses without it, `NEEDS_CONFIRM`),
  take an optional `student_name` checked against the relationship (`resolveStudent` / `nameMatches`), and
  reply `sent: true`, `sent_to` and "SENT to <student>: …". All in `mcp-server/src/tools/homework-send.ts`;
  `tools/create-then-send.test.ts` proves no create tool calls a sending endpoint and every send tool needs
  the student + confirm. The MCP Apps' Send buttons (an explicit click) are unchanged.
- Deprecated: `create_deck_for_student` = `create_homework_deck` (its `relationship_id` is only a label now;
  sends only with `send_now` + `confirm`).

#### Tutor tools — students (`mcp-server/src/tools/students.ts`)

All of these go through the main API as the signed-in user (`ApiClient`), so "is this user the
tutor of this relationship?" is decided by the API, never re-implemented in the MCP server.
`relationship_id` comes from `list_students`. Responses are trimmed to what a chat needs
(recording keys become playable `audio_url`s, ratings become again/hard/good/easy); the pure
shaping helpers are in `tools/students/shape.ts` and unit-tested in `tools/students.test.ts`.

| Tool | What it does |
|------|--------------|
| `list_students` | Every student card from `/api/tutor/dashboard` (status, streak, pills, needs-attention words, the one-off homework headline, setup checklist for new students, `last_conversation_id`) + pending invite links + the tutor's homework decks, plus `my_tutors` / pending requests from `/api/relationships` |
| `get_student_overview` | One student's full card (`/relationships/:relId/overview`): all needs-attention words, homework decks and lessons with progress, setup/install state, recent days, `study_budget` (new words + extra cards a day, who set it) and `student_profile` (the tutor's private note) |
| `set_student_study_budget` | Set the student's ONE daily new-card budget (`new_cards_per_day` / `secondary_cards_per_day`, null = default 3 + 6; `PUT …/student-study-budget`) — the student gets a chat message and sees "Set by <tutor>" in Settings; `list_students` rows carry `study_budget` too |
| `get_student_profile` / `update_student_profile` | The tutor's private profile of the student (`GET|PUT …/student-profile`): what kind of learner, what homework suits them; update changes only the fields passed. The server `instructions` tell Claude to read it before making anything for a student and never quote it to them |
| `get_student_insights` | Pre-lesson briefing over a range (`/insights`): totals, ranked `struggling` with the wrong answers typed, `going_well`, activity, recordings with marks; `top_n` trims the lists; default range = since last logged lesson, else 14 days |
| `get_student_history` | Individual review events newest first with filters (deck, card type, rating, text) and keyset paging (`next_cursor`) |
| `get_student_daily_progress` | Last 30 days day-by-day + headline stats and per-deck counts (`/student-progress/daily` + `/student-progress`) |
| `get_student_day` | Everything reviewed on one date (`/student-progress/day/:date`) |
| `write_student_summary` / `list_student_summaries` | Claude-written narrative (EN + 中文) for a range, persisted; 503 message surfaced when no API key |
| `list_student_recordings` | Pronunciation recordings in a range with `audio_url` and tutor marks; `queue: true` = the "Needs your ear" queue with `why` labels, `heard`, `pronunciation_score`, `sounded_off`; `only_unmarked` = everything not yet heard |
| `mark_recording` / `clear_recording_mark` | `listened` or `needs_work` + comment (shown to the student once on the back of that card) / remove the mark |
| `log_lesson` / `list_lesson_log` / `delete_lesson_log_entry` | Lesson log; the newest entry anchors "since last lesson"; notes are copied into the student's lesson notes |
| `send_message_to_student` | Posts a chat message as the tutor into THE chat with the student (one per pair, created on first use) |
| `list_conversations` / `get_conversation_messages` | Read the chat — `get_conversation_messages` takes the `relationship_id` (or a conversation id; old merged ids work); last N messages, `from: "me"` for the caller |
| `send_install_howto` | Posts the install instructions (Obtainium / Add to Home screen) into the chat |
| `list_student_homework` | Shared decks with completion + activity, and the student's mini lessons with completions |
| `get_shared_deck_progress` | Per-word mastery and recent ratings for one shared deck |
| `share_deck_with_student` / `update_student_deck_copy` | **Send tools** (`confirm: true`, optional `student_name`). Send a tutor deck to the student as a homework assignment (`POST …/homework`; `mode` default `both` = one-off pass by `due_date` — default the next logged lesson, else in two days — then long-term; `priority: core` = top of their study queue, `non_urgent` = bottom; `skip_known`) / add the tutor's newer words to an existing copy (progress kept) |
| `remove_student_deck` / `remove_student_lesson` / `remove_student_reader` | Take homework back (sent by mistake): delete the STUDENT's copy of a deck the tutor shared (`shared_deck_id` or the copy's `deck_id`; `delete_source` also deletes her deck when no one else has a copy), a lesson she assigned, a reader she shared — never the student's own; `dry_run: true` first reports what would be lost. Named in `list_student_homework`'s description, which now also lists shared `readers` |
| `move_student_deck` | Move a packet within the student's study queue (`to: top | up | down | bottom`); returns `queue_position` of `queue_total` |
| `list_card_flags` / `reply_to_card_flag` | Cards the student flagged with their note (open by default) / answer one — resolves it, posts the reply into the chat, shown to the student once on that card |
| `list_student_claude_chats` | What the student has asked Claude about their cards, grouped into per-card conversations (answers trimmed to `answer_chars`) |
| `submit_session_notes` / `get_session_notes_job` / `list_session_notes_jobs` | Hand the tutor's raw lesson notes to the session-notes agent (`POST …/session-notes`, or `call_id` for a recorded video lesson → `POST /api/calls/:id/homework`; deck + conditional mini lesson / reader, all kept in the tutor's account — `auto_share: true` needs `confirm: true`) / poll one job's progress, steps, result and `not_sent` keys / list a student's jobs |
| `send_session_notes_items` | **Send tool**: a finished job's unsent deck / lessons / reader (`items` keys from `not_sent`, none = all) → `POST …/session-notes/:id/send` |
| `list_student_lesson_notes` / `add_student_lesson_notes` / `get_homework_draft` / `update_homework_draft_plan` / `revise_homework_draft` / `assign_homework_draft` (`tools/homework.ts`) | Lesson-notes entries and their homework state / add notes (+ draft by default, nothing sent) / the draft with skipped words, plan and load now → after / change modes, dates, split / ask the assistant to change it (same job) / assign it (send tool, `confirm: true`) |
| `create_link_homework` / `assign_link_homework` / `list_link_homework` / `update_link_homework` (`tools/homework-hub.ts`) | Link homework (docs/HOMEWORK.md §8): save a video / song / article link with instructions in the tutor's OWN account (`POST /api/homework-links`, checked with `pickLinkHomework`; sends nothing) / send it (send tool, `confirm: true`) to one or more students as one-off homework (`POST …/homework`, `kind: 'link'`, optional due date) / list saved links / edit one (`PUT /api/homework-links/:id`, `update_student_copies` only when the tutor asked) |
| `get_homework_library` (`tools/homework-hub.ts`) | Everything sent, one row per deck copy / lesson / reader / link (§9): student, sent, due, status completed / in_progress / overdue / not_started, %, progress, the student's note, `due_assignment_id`; one student (`…/homework-library`) or all (`/api/tutor/homework-library`); status / kind / text filters (`filterLibrary`) |
| `get_student_homework` / `assign_homework` / `update_homework_assignment` (`tools/homework.ts`) | The load gauge + assignments with due labels and progress / assign (send tool, `confirm: true`) decks, library lessons and readers as `one_off` (due date, `split_days`, known words left out) / `fsrs` / `both` / move a due date or cancel |
| `create_student_invite` / `list_invites` / `revoke_invite` | Invite links (`inviter_role: tutor`, decks to copy, welcome message); status, `link_opened_at`, redemptions; revoke |
#### Tutor tools — content (`mcp-server/src/tools/content.ts`)

Registered by `registerContentTools(ctx)` from `mcp-server/src/tools/content/{readers,lessons,decks}.ts`.
Every tool calls the main API as the signed-in user through `ctx.api` (`ApiClient`), so the API's
ownership checks, validators and queues (TTS, illustrations, story generation) apply unchanged;
reader and lesson specs are pre-validated with the shared `validateReaderSpec` / `validateLessonSpec`
so Claude gets the problem list without a round trip. `content/specs.ts` holds the spec documentation
pasted into the descriptions plus the pure helpers (trimming, note normalisation), unit-tested in
`content.test.ts` together with a fake-context test that records the API paths each tool hits.

| Tool | Description |
|------|-------------|
| `list_readers` | The user's graded readers, trimmed (id, titles, difficulty, topic, status, page_count, creator_role); `status` filter |
| `get_reader` | One reader as a full `ReaderSpec` (page ids + image urls); poll while `generating` |
| `create_reader` | New reader from a hand-written `ReaderSpec` (`POST /api/readers/import`) |
| `update_reader` | Whole-reader replace (`PUT /api/readers/:id/spec`); keeping page `id`s keeps illustrations whose prompt is unchanged |
| `generate_reader` | Queue a Claude-written story from learned vocabulary of given decks (`POST /api/readers/generate`); returns id + `generating` |
| `retry_reader` / `delete_reader` | Re-queue a failed reader / delete one (images kept if a shared copy uses them) |
| `share_reader_with_student` | **Send tool** (`confirm: true`). Send one of the tutor's readers to the student as homework (`POST …/homework`, kind reader; `mode` default `both`, `due_date` default next logged lesson else +2 days) |
| `list_student_readers` | Shares in a relationship with the student's read status (`GET …/shared-readers`) |
| `export_reader` | Markdown / re-importable JSON / Quizlet CSV as text |
| `list_lesson_library` / `get_library_lesson` | The tutor's library items / one with its full spec |
| `create_library_lesson` | From a `spec` or a `generate_prompt` (Claude drafts it server-side), optional `tags` |
| `update_library_lesson` | Full-spec replace (+ tags); version bumps; reminds to push when copies exist |
| `duplicate_library_lesson` / `archive_library_lesson` | Copy as "Copy of …" / archive |
| `assign_lesson_to_students` | **Send tool** (`confirm: true`). A library lesson as homework per relationship (`POST …/homework`, `mode` default `both`, `due_date` default each student's next logged lesson else +2 days); `assigned` / `already_had` (left as is) / `errors` |
| `get_lesson_assignments` | Per student: completions, last rating/score, `up_to_date` |
| `push_lesson_update` | **Send tool** (`confirm: true`, `relationship_ids` required). Overwrite those students' copies in place (history + revisit schedule kept) |
| `export_library_lesson` | Markdown with answer key / JSON / CSV |
| `list_student_lessons` | Tutor's view of a student's lessons (`GET /api/relationships/:relId/student-lessons`) |
| `create_homework_deck` | Create deck + notes in the TUTOR's account via the API (one batch); nothing is sent (`for_relationship_id` only labels who it is for). Only `send_now: true` + `relationship_id` + `confirm: true` sends it at once as homework (`POST …/homework`: `mode` default `both`, `due_date` default next logged lesson else +2 days, `priority`, `skip_known`); a failed send keeps the deck. Never waits for TTS: the worker copies each clip onto the student's copy when it is generated (`propagateNoteAudioToSharedCopies`); per-note failures are reported, not fatal |
| `create_deck_for_student` | **Deprecated** alias of `create_homework_deck`; its `relationship_id` is only a label |
| `add_words_to_student_deck` | Add notes to the tutor's source deck of a shared deck; the student's copy is untouched unless `update_student_copy: true` + `confirm: true` (then `POST …/shared-decks/:id/update`) |
| `get_starter_deck` | `POST /api/decks/starter` — the idempotent built-in "Starter Chinese" deck |
#### Tutor apps (`mcp-server/src/tools/apps.ts`, UIs in `src/ui/apps/`)

Four interactive MCP Apps for tutors, each a model-facing tool that opens the UI plus
**app-only tools** (prefix `app_`, `_meta.ui.visibility: ['app']`, hidden from the model) the UI
calls back into. Server modules live in `src/tools/apps/` (one per app, `shared.ts` for the
`appTool` helper / students / `withProblems`, `types.ts` for the payload shapes the UIs import as
types); every call goes through `ctx.api` (the main API as the signed-in tutor).

| App / opening tool | What the tutor can do | App-only tools |
|---|---|---|
| `students_dashboard` — `open_students_dashboard(tz_offset_minutes?)` | One card per student from `GET /api/tutor/dashboard`: status, pills, needs-attention words with the wrong answers typed, setup checklist for new students; expand for recordings inbox + homework; log a lesson, message, mark recordings (comment shown to the student); "Ask Claude" chips send a prepared prompt into the chat | `app_refresh_dashboard`, `app_student_detail` (overview + insights recordings), `app_log_lesson`, `app_send_message`, `app_mark_recording` |
| `review_reader` — `review_reader(reader_id)` | Pages with Chinese / pinyin / English / illustration (`<api>/api/audio/<key>`); inline editing, add / delete / reorder pages, titles; Save (`PUT /api/readers/:id/spec`, page ids kept), Send to student (share-reader endpoint), "Ask Claude to revise" | `app_save_reader_spec`, `app_share_reader` |
| `review_lesson` — `review_lesson(library_item_id? \| lesson_id?)` | All 9 exercise types rendered and editable, add / remove / reorder; Save (library or a student's copy), Assign (multi-select), Push update, assignments with up-to-date / behind | `app_save_library_lesson`, `app_save_lesson`, `app_assign_lesson`, `app_push_lesson_update` |
| `review_deck` — `review_deck(deck_id)` | Word table with audio, inline row edit / add / delete saved per note; Send to student or Update their copy (from the dashboard's `homework.decks`); "Ask Claude to add 5 more words…" | `app_update_note`, `app_add_note`, `app_delete_note`, `app_share_deck`, `app_update_shared_deck` |

Saves validate with `shared/{reader,lesson}/validate` on both sides; a 400 with `problems` comes
back as `{ ok: false, problems }` and is shown inline. After every save / send the UI calls
`updateModelContext` with a text summary so Claude's next revision starts from the edited content;
"Ask Claude" buttons use `sendMessage` and are hidden when the host lacks that capability.

**UI mechanics**: vanilla TS, one folder per app (`index.html`, `main.ts`, `app.css`) sharing
`src/ui/apps/_shared/` (`host.ts` = the ext-apps `App` bridge with capability flags, `dom.ts` =
element builder / speech / toast / sheet, `picker.ts` = student picker, `base.css` = theme tokens
that follow the host variables and `data-theme`). `scripts/build-apps.mjs` builds `src/ui` (study)
and every `src/ui/apps/<name>/index.html` as its own single-file bundle and regenerates
`src/app-html.ts` (`APP_HTML[name]`, committed) — run `npm run build:ui` after touching a UI.
`registerApp(ctx, name)` serves the bundle as `ui://<name>/mcp-app.html` with a CSP allowing the
API origin. **Screenshots / dev preview**: set `window.__MCP_APP_PREVIEW__` to an object shaped
like the tool's `structuredContent` (and optionally `__MCP_APP_PREVIEW_TOOLS__ = { app_x: result }`
for canned app-only results) before the bundle runs and the app renders without a host — see
`docs/pr-screenshots/mcp-tutor-apps/`.

#### Admin tools (`mcp-server/src/tools/admin.ts`)

Admin only — every tool calls the API as the signed-in user and `adminMiddleware` answers 403 to anyone else. `user` is an
id or an email. Unit-tested in `tools/admin.test.ts`.

| Tool | What it does |
|------|--------------|
| `admin_list_users` | Every account with role, admin, can_invite, last login / opened, install kind, counts; `query` filters |
| `admin_get_user` | `GET /api/admin/users/:user/inspect` — profile, sync state, relationships, recent reports, decks |
| `admin_inspect_user_decks` | Live + deleted decks, shares either way, decks deleted before tombstones |
| `admin_set_role` | `student` / `tutor` (the tutor-first app) |
| `admin_set_can_invite` | Allow / stop invite links |
| `admin_set_user_voice_gender` | `male` / `female` / `other` / null — the voice that account's chat messages are read aloud in (`PUT /api/admin/users/:user/voice-gender`) |
| `admin_preview_delete_user` / `admin_delete_user` | What an account deletion removes / keeps; delete with `confirm_email` |
| `admin_list_access_requests` / `admin_handle_access_request` | Uninvited sign-in attempts; approve / dismiss |

Audio (same file, docs/AUDIO.md): `audio_settings_get` / `audio_settings_update` (provider order for stored / live, voices, enabled, max RPM, upgrade backup clips, `reset`; `GET|PUT /api/admin/audio/settings`), `audio_backfill_status` (now with `providers` + `stored_clips`) (read-only: backlog by kind × state, clips by provider / model / voice, limiter, measured clips/min, ETA), `audio_backfill_run` (`limit?`: start the pump, queue that many clips now), `audio_retry_failed` (`error_code?`: failed clips due now — account errors by default, one code, or "all" — and probe MiniMax at once), `audio_tts_compare` (old vs current model durations — perceived speed check). API: `GET /api/admin/audio/backfill` (with `account_problem` first), `POST /api/admin/audio/backfill/run`, `POST /api/admin/audio/retry-failed`, `POST /api/admin/audio/compare` (`routes/audio-backfill.ts`).

#### Debug tools (`mcp-server/src/tools/debug.ts`)

The signed-in user's own study-state reports (see "Debug reports" above); nothing returns a whole report.

| Tool | What it does |
|------|--------------|
| `list_debug_reports` | Reports newest first (`client` lab / web), each with its summary (home total + counts, queue size, cards, events, unsynced) |
| `get_debug_report` | One report by id (or `latest_lab` / `latest_web`), a `section` at a time: overview (default), decks, cards (paged, filter by deck / queue / in_due_queue / card), events (paged hashes) |
| `compare_debug_reports` | Server-side diff, default newest lab (a) vs newest web (b): hints, context, headline numbers, per-deck differences, differing cards with the server's event count, one-sided cards and events |

#### Usage tools (`mcp-server/src/tools/usage.ts`)

Admin only (the API answers 403 otherwise); `user` = id or e-mail; docs/ANALYTICS.md.

| Tool | What it does |
|------|--------------|
| `usage_summary` | Active days, sessions, time in app per platform, top screens / events, last seen per platform + app version |
| `feature_adoption` | Per catalogue event: first / last used + count (one user or everyone); never used, stale, old paths still in use |
| `user_timeline` | One person's events in order for a day (`tz_offset_minutes`) or a range |
| `event_counts` | An event or prefix (`chat.*`) by day / user / platform / event |
| `recent_errors` | Errors shown to users + Lab crash reports |
| `ai_usage` | Model calls, tokens, estimated cost by model / day / user / route / provider |

### Study Tool (MCP App)

The `study` tool is special - it renders an interactive flashcard UI directly in Claude.ai or other MCP hosts that support MCP Apps. Usage:

1. Call `list_decks` to get available deck IDs
2. Call `study(deck_id: "...")` to open the study interface
3. The UI displays cards, handles flipping, and rating
4. Audio is played via browser speech synthesis (Chinese TTS)
5. Reviews are submitted automatically via the `submit_review` tool (hidden from model)

The UI bundle is built with Vite and embedded in the worker. To rebuild:
```bash
cd mcp-server && npm run build:ui
```

### Notes on MCP Usage
- **`update_student_copies`** (boolean, default false — a send: set it only when the tutor asked to update the students' copies; `tools/student-copies.ts`) on `update_note`, `add_note`, `batch_add_notes` (kind deck, the note's deck), `update_library_lesson` (kind lesson; replaces a separate `push_lesson_update`, which is kept), `update_reader` and `update_link_homework`: after the edit it calls `POST /api/student-copies/update` and lists per-student results ("Also updated Anna's copy"). A failed copy update never fails the edit.
- The deck / note tools (`create_deck`, `update_deck`, `delete_deck`, `add_note`, `batch_add_notes`, `update_note`, `delete_note`, `move_notes`) call the main API, so the worker's content service makes the cards, generates TTS in the background (word + example sentence), queues the sentence set and writes deletion tombstones. The MCP server only reads D1 directly (lists, searches, duplicate pre-checks).
- A deck created through MCP gets the shared new-deck defaults (3 new + 6 secondary cards a day)
- Notes created via MCP have audio shortly after the call returns; the tool never waits for it
- Use `get_note_history` to see a user's study progress and questions asked about a note

### Connecting to Claude.ai

Add the MCP server URL in Claude.ai settings:
```
https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp
```

Claude.ai will handle the OAuth flow automatically.

### Connecting to Claude Desktop

Use `mcp-remote` to connect Claude Desktop to the MCP server:
```bash
npx mcp-remote https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp
```

### Development

```bash
# Run MCP server locally
npm run dev:mcp

# Deploy MCP server
npm run deploy:mcp
```

### Debugging

To view live logs while testing:
```bash
cd mcp-server && npx wrangler tail --format pretty
```

Common issues:
- **"Could not find McpAgent binding for MCP_OBJECT"** - Missing Durable Object config in wrangler.toml
- **"This Durable Object is not backed by SQLite storage"** - Used `new_classes` instead of `new_sqlite_classes`
- **OAuth errors after deploy** - GitHub Actions may overwrite secrets; ensure `MCP_COOKIE_ENCRYPTION_KEY` is set in GitHub secrets

## Deployment

### How Deployment Works

**Deployment is automatic via GitHub Actions.** When you push to `main`, the CI pipeline (`.github/workflows/deploy.yml`) automatically:

1. Runs TypeScript type checking
2. Builds the frontend
3. **Applies D1 database migrations to production** (automatically)
4. Deploys the Worker API
5. Sets worker secrets
6. Deploys the frontend to Cloudflare Pages
7. Deploys the MCP server

### Pre-Merge Checklist (REQUIRED)

Before merging to main or marking work as complete, **every agent must verify**:

```bash
# 1. TypeScript compiles clean across ALL packages
npx tsc --noEmit --project frontend/tsconfig.json
npx tsc --noEmit --project worker/tsconfig.json

# 2. All tests pass
npm test

# 3. Frontend builds
cd frontend && npx vite build

# 4. If worker/mcp-server code was touched, verify those build too
cd worker && npx wrangler deploy --dry-run --outdir=.wrangler/tmp
cd mcp-server && npx wrangler deploy --dry-run --outdir=.wrangler/tmp
```

Do NOT skip these steps. CI failures on main break production deploys for everyone.

### PR Merge Policy (Jerome's standing preference)

**Every session Jerome starts ends in a merged PR.** If he asked for a change,
he wants it opened as a PR and landed — don't stop at a pushed branch and don't
ask "shall I open a PR?" or "shall I merge?". That is a standing, blanket
pre-approval: it covers every session, not just the one where he said it.

Once the pre-merge checklist passes locally, open the PR and **merge it
without asking** (squash) as soon as CI is green — enable GitHub auto-merge
right after opening when possible, otherwise merge when checks pass. If CI
fails, fix it and land it; don't hand a red PR back to him. Only pause for
genuinely destructive or ambiguous changes.

Jerome does not want to be looped in for any of this. Tell him what landed
when it's done, not what you're about to do.

### PR Requirements: Screenshots for Frontend Changes (REQUIRED)

**Every PR that touches `frontend/` UI must include screenshots in the PR
body** — Jerome has no local environment, so the PR is the only place he can
see what changed before it is live. Describing the screenshots in words is
not enough; attach the images.

- Capture at the phone viewport (412×915, 2× — the app is used folded on a
  Pixel Fold) for every new or changed screen and state (empty, loaded,
  error, modal/sheet open). Add a wider shot (≥1024px) only for screens with
  a desktop layout (editors, admin).
- Show before/after when changing an existing screen.
- How: run the app locally (`E2E_TEST_MODE=true`, `/api/test/auth` for a
  session, `?session_token=` to log in), seed realistic data (real hanzi,
  not lorem ipsum), screenshot with Playwright
  (`chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })`
  in the remote container). Scripts go in `e2e/.scratch/` and are deleted
  before committing.
- Attach by committing the PNGs under `docs/pr-screenshots/<branch-or-pr>/`
  on the PR branch **together with a `README.md` in that folder that embeds
  them with relative paths** (`![Edit tab](02-editor-edit.png)` + a one-line
  caption each). GitHub renders that README with the images when the file is
  opened on the branch, and the PNGs also appear in the PR's "Files changed".
  In the PR body, add a "## Screenshots" section that names the folder path
  (`docs/pr-screenshots/<dir>/README.md`) and lists each shot with its
  caption. Do **not** rely on `<img src="https://…">` or `![](https://…)`
  in the PR body: the GitHub MCP tool used from remote sessions wraps every
  URL in the body in backticks, which breaks image rendering. Keep each image
  under ~500 KB. Once the PR is merged the folder may be deleted in a later
  PR if it is not referenced from docs.
- Docs-only or worker-only PRs are exempt; a PR that changes both must
  include screenshots for the frontend part.

### To Deploy

Simply push to main:
```bash
git push origin main
```

After pushing, verify CI passes: `gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') --exit-status`

**You do NOT need to manually run migrations for production** - the CI handles this automatically before deploying the worker.

### Manual Deployment (if needed)

If you need to deploy manually without CI:
```bash
# Apply migrations to production
cd worker && npx wrangler d1 migrations apply chinese-learning-db --remote

# Deploy everything
npm run deploy
```

### Monitoring Deployments

Check GitHub Actions for deployment status. If a deployment fails:
1. Check the Actions tab on GitHub for error logs
2. Common issues: TypeScript errors, migration failures, missing secrets

## Tutor-Student Feature

The app supports many-to-many tutor-student relationships where users can be tutors to some people and students to others.

### Key Tables
- `tutor_relationships` - Pairing between users with role and status
- `conversations` - Chat threads within a relationship
- `messages` - Individual messages in conversations
- `shared_decks` - Record of decks shared from tutor to student

### Features
- **Pairing**: Either party invites by email, specifying their role (tutor/student)
- **Chat**: Polling-based messaging (3-second intervals). Per-message tools: Reply and Play inline
  (44px), everything else (React, Check my Chinese, Translate / Make a card, Word by word, Discuss
  with Claude, Copy) under ⋯ / long-press — a bottom sheet on phones, a popover ≥640px. The set is
  role-aware (`toolsForMessage` in `frontend/src/components/chat/messageTools.ts`, unit-tested):
  Check my Chinese only on the learner's own messages, Translate only on the other party's. Failures
  show as Coach-style inline notices (`InlineNotice`), never `alert()`.
- **One chat per pair** (docs/CHAT.md "One chat per pair", migration 0102, `routes/one-chat.ts`): a tutor and a
  student have exactly ONE conversation — `openRelationshipConversation` (`services/conversations.ts`) is the
  get-or-create every path posts through (`POST /api/relationships/:relId/conversations/open`; creating another
  returns it). Older extras were merged into the most recently active one (messages moved, read markers max'd,
  rows kept with `merged_into`); any `/api/conversations/<old id>/…` is served as the one chat, and
  `GET /api/conversations/:id` says `merged_from`. No new conversation / titles / rename for people (PATCH → 410);
  `/connections/:relId/chat` opens the chat; the inbox has one row per person. Claude practice chats stay many.
- **Live delivery & notifications** (docs/CHAT.md — the contract): a per-user **ChatHub** Durable Object
  (`worker/src/durable/chat-hub.ts`, binding `CHAT_HUB`; `POST /api/live/ticket` → `GET /api/live/ws?ticket=`) pushes
  `message` / `read` / `typing` events to every open client; `services/chat/notify.ts` sends each new message to the
  recipient's ChatHub, **FCM** (`services/push/fcm.ts`, HTTP v1, secret `FCM_SERVICE_ACCOUNT_JSON` — optional, skipped when
  unset; tokens in `device_push_tokens`, `POST|DELETE /api/push/devices`) and Web Push (`chat_message`, tag `chat-<convId>`,
  skipped by `push-sw.js` when that chat is in front). Read markers per person in `conversation_reads`
  (`POST /api/conversations/:id/read`, `read_state` on GET messages, `GET /api/me/chat-inbox?since=` for background checks);
  sends are idempotent by `client_id` (`messages.client_id`). Lab: `data/chat/` — `ChatNotifier` (Messages channel,
  MessagingStyle per conversation, Reply via the Outbox, Mark as read, tap → the chat even from a cold start), FCM gated on
  `app/google-services.json` (CI secret `GOOGLE_SERVICES_JSON`, setup in `android-lab/PUSH.md`), the live socket while in
  front, `ChatCheckWorker` every 15 min as the fallback.
- **Live chat & rich messages** (docs/CHAT.md "PR 2", migration 0090): typing indicator + "Seen" receipts over the
  ChatHub socket (polling only while it is down), optimistic sends through an outbox (web `services/chatOutbox.ts`, own
  Dexie db `chat-outbox`; Lab Outbox) replaced by `client_id`, photos + voice messages (`POST /api/conversations/:id/media`,
  R2 `chat-media/<conv>/<msg>.<ext>` — person-made, never collected; served only to the two participants by
  `GET /api/chat-media/:messageId`; voice transcribed with `transcribeTake` + translated in the background), edit / delete
  (soft) / pin (`PATCH|DELETE /api/messages/:id`, `POST …/pin`), `?since=` also returns changed messages
  (`updated_at`) and every change is a `message_updated` event, search in the chat (`shared/chats/search.ts`
  `searchMessages`, Lab `ChatSearch.kt` parity-tested), "New messages" divider + "↓ N new" pill, unread badges on the
  conversation lists. Web: `services/chatLive.ts`, `hooks/useChatThread.ts`, `components/chat/*Bubble.tsx`; Lab: `ui/chat/ChatRich.kt`, `data/chat/ChatMedia.kt`.
- **Learning tools in the chat** (docs/CHAT.md "PR 3", migration 0091): every Chinese message (and voice transcript)
  gets reader-style word chips in the background (`messages.words`, `segmentReaderText`; lazily
  `POST /api/messages/:id/words`) → the reader word sheet (+ Add as card); per-message 拼 / EN toggles (remembered per
  conversation); **Make flashcards** (select messages / Today / Last 50 → `POST /api/conversations/:id/flashcards/propose`,
  structuredCall + CARD_STANDARD + FLASHCARD_ITEM_SCHEMA, `already_have` per card → review sheet → one
  `POST /api/decks/:id/notes/batch`) replaces the old single "+ Card"; **Correct this** (the relationship's tutor,
  `PUT|DELETE /api/messages/:id/correction`, shown as a `diffHanzi` red-pen diff, push `chat_correction`, the student's
  "Make a card from this" = propose with `focus: 'correction'`); **Check my Chinese** on the compose box (`/api/sentence/coach`).
  Which ⋯ tools show is `learningToolsForMessage` in `shared/chats/messageTools.ts` (Lab `MessageTools.kt`, parity-tested).
  Web: `components/chat/ChatWords.tsx`, `MakeFlashcardsSheet.tsx`, `ChatCorrection.tsx`, `CheckDraftPanel.tsx`,
  `services/chatLearning.ts`; Lab: `ui/chat/ChatLearningViews.kt`, `ChatCardsSheet.kt`, core `ChatLearning.kt`.
- **Chat round 2 — a normal chat app** (docs/CHAT.md "Round 2"): Signal-like bubbles with NO buttons on them —
  groups by sender within 3 min, time + ✓ / ✓✓ ticks inside the last bubble of a group, day pills, reactions pill, reply
  quote inside the bubble (`layoutBubbles` / `tickFor` / `firstLink` in `shared/chats/bubbles.ts`, Lab `ChatBubbles.kt`
  parity-tested). Every tool is in the **message menu** — long-press (touch), right-click or the hover 😊 / ⋯ (desktop):
  a reaction bar + Reply · Copy · Translate · Pinyin · Explain · Save as flashcard · Make flashcards from selection ·
  Check my Chinese · Correct · Read aloud · Discuss with Claude · Pin · Edit · Delete · Select (`messageMenu` in
  `shared/chats/messageMenu.ts`, Lab `MessageMenu.kt` parity-tested; web `components/chat/MessageMenu.tsx`).
  Explain / Save as flashcard = `components/chat/ExplainSheet.tsx` (`/api/sentences/explain-text` cached by text,
  `SentenceWordBreakdown`, the whole message as one card via `breakdownSentenceCard` → `AddChunkModal`). Swipe right on
  a bubble = reply. Composer: `[+] [😊 field ✓] [🎤|➤]`, hold the mic to record (slide left 100 px cancels, up 80 px
  locks; `VoiceComposer` `mode` held / locked). Voice bubbles: real waveform (`services/voiceWaveform.ts`) + 1× / 1.5× / 2×.
  Link previews: `GET /api/link-preview?url=` (`services/link-preview.ts`: public http(s) only, ≤ 512 KB, cached a day;
  client `services/linkPreview.ts`). Styles: `components/chat/chat-signal.css`.
- **Chat round 2 PR 3** (docs/CHAT.md "Round 2 — PR 3", migration 0095 `messages.forwarded_from`): files / PDFs
  (`kind=file&name=`, ≤ 20 MB, extension whitelist `FILE_TYPES`, served with Content-Disposition + `sandbox` CSP) and video
  clips (`kind=video`, ≤ 25 MB) on `POST /api/conversations/:id/media`; several photos at once (one message each); **Forward**
  (`POST /api/messages/:id/forward { conversation_id, client_id }`, media copied to its own key, "↪ Forwarded"); **Info**
  sheet; drafts per conversation (`services/chatDrafts.ts`, Lab `core/…/ChatDrafts.kt` parity-tested) and the header's
  "🕓 N waiting for a connection" (`queueLabel`). Web: `FileBubble`, `VideoBubble`, `ForwardSheet`, `MessageInfoSheet`;
  Lab: `ui/chat/ChatForward.kt`, `ChatRound3Views.kt`, `core/…/ChatFiles.kt`.
- **Chat read-aloud voice** (`shared/chats/voice.ts`, Lab `core/…/ChatVoice.kt`, parity-tested): Read aloud goes
  through the exercises' TTS path (`POST /api/practice/tts`, device cache by text + voice + speed, plays offline once
  heard) in a voice from the LISTENER's conversation voices that matches the SENDER's `users.voice_gender` (male → first
  enabled male voice, female → first enabled female, other / not set → the app voice Radio Host); Claude's lines in a
  role-play keep that chat's persona voice. `conversations.voice_id` (column DEFAULT 'female-yujie') is ignored for human
  chats — it was why every chat read in a sultry role-play voice. `voice_gender` rides on `/api/auth/me`, `/api/profile`
  and the relationship's requester / recipient. Offline and never fetched → a zh-CN device voice of the sender's gender
  (`pickChineseVoiceFrom`). `/api/practice/tts` and `/api/conversations/:id/tts` (`{ message_id }` → resolved server-side)
  keep MiniMax clips in R2 `tts-cache/` (`services/tts-cache.ts`).
- **Listening mode** (docs/CHAT.md "Listening mode", `shared/chats/listening.ts`, Lab `ChatListening.kt` parity-tested): chat ⋯ → 🎧 Listening mode (+ 🙈 Hide all), Settings → Chat default; the other person's new Chinese text messages show as a hidden bubble — **tap plays** (0.75× chip), **long-press reveals** (no menu until revealed; 👁 too; revealed ids per device). Inbox / push / e-mail say "🎧 New message" (`notificationPreviewFor`). The tap plays the Read-aloud clip (one TTS path, `shared/chats/voice.ts` + R2 `tts-cache/`), pre-generated for the listener on send / edit (`services/chat/message-audio.ts`, waitUntil) and prefetched on chat open, live updates and sync (`GET /api/me/chat-clips`); web `services/chatListening.ts`, `components/chat/ListeningBubble.tsx`.
- **Flashcard Generation**: AI generates flashcards from chat context
- **Deck Sharing**: Tutors can copy decks to students (auto-added)
- **Student Progress**: Tutors can view student study statistics

### Frontend Routes
- Navigation: a bottom **tab bar** (`components/nav/TabBar`, rendered by `Header`) — tutor account (users.role): Students · Chats · Library · More; student: Study · Chats · Tutor · Progress · More; account with students: Students · Chats · Study · More (+ Progress if they also study). The Chats tab carries an unread badge (conversations with unread messages); Decks is the first row of More (a `/decks` page lights More up). Hidden on immersive routes (`/study`, quest play, readers, editors, chat — `isImmersiveRoute`). `html.has-tab-bar` pads the document so nothing sits under it.
- `/` - Study home (a tutor account gets the teaching home, `TutorHome`). On the app's initial entry it applies `users.landing_page` (Settings → "Start on"; `PUT /api/profile/landing-page`, exposed on `/api/auth/me`), else the automatic rule: Students when the account has an active student and nothing due today, otherwise Study (`components/nav/landing.ts`).
- `/chats` - Chats tab: every conversation (tutors + students, Claude role-play in its own section), Signal-style rows with avatar / last message / time / unread, search, ✏️ new chat; cached offline, live while open (`pages/ChatsPage.tsx`, `hooks/useChatList.ts`)
- `/decks` - Deck list (grouped in folders when there are any) + card search (`?q=`; `/search` redirects here) — More → Decks, Home "All decks →"
- `/more` - Grouped More page (Decks first, then Practice / From your tutor / Teaching / Account / Advanced) — replaces the avatar dropdown
- `/profile` - Profile (`pages/ProfilePage.tsx`, `components/profile/`): display name, photo (crop sheet → 512px JPEG → R2 `avatars/<user>/<id>.jpg`, served by the public `GET /api/audio/<key>`), About me (public: `PersonAbout` on the tutor / student page, the /join page), time zone (the other side sees your local time), and the learner's private bio. **`users.name` / `picture_url` stay the effective values every query reads** (migration 0076 adds `google_name`, `google_picture_url`, `name_custom`, `picture_source`, `picture_key`, `about`, `time_zone`); the Google sign-in (`touchExistingUser` → `googleProfileRefresh`, and the MCP server's OAuth callback) always refreshes the `google_*` columns but only overwrites name / picture while the user follows Google. Reached from More (user card + Account → Profile), Settings, and the tutor's Students dashboard header chip / "Introduce yourself" nudge
- `/settings` - Profile link · Offline audio (one line; audio downloads itself after every sync) · Backup · Start on · Sign out · Advanced (audio quality, playback quality, conversation voices (`/settings/voices`), sentence coverage, feature requests, duplicate finder, full sync, update app, debug)
- `/connections` - Students dashboard for tutors with students (cards, pending invites, homework decks); otherwise connections + pending requests
- `/connections/:relId` - Student page (tutor: status, Message / Send homework, needs attention, homework, conversations, activity; new student: setup checklist) / tutor page (student)
- `/connections/:relId/chat/:convId` - Chat interface (a merged-away id swaps to the pair's one chat); `/connections/:relId/chat` opens THE chat with that person
- `/connections/:relId/progress` - Student progress view (tutor only)
- `/library`, `/library/:id`, `/library/:id/edit`, `/library/:id/print` - Tutor lesson library, item (assignments + push update), editor, print view
- `/lessons/:id/edit`, `/lessons/:id/print` - Lesson editor / print view for a student's own lesson or one the tutor assigned
- `/library/catalogue`, `/library/catalogue/:sampleId` - Exercise catalogue / a sample lesson as a trial (immersive, nothing recorded)
- `/connections/:relId/lesson-attempts[/:attemptId]`, `/lesson-attempts[/:attemptId]` - Lesson attempt review (tutor / learner)
- `/readers/:id/edit`, `/readers/:id/print` - Reader editor (form + preview + Claude co-editor + exports) / print view
- `/connections/:relId/insights` - Student Insights: range, needs attention / going well, summary, lesson log (tutor only)
- `/connections/:relId/history` - Full review history explorer with filters (tutor only)
- `/connections/:relId/recordings` - Recordings inbox with listened / needs-work marks (tutor only)
- `/connections/:relId/cards/:noteId`, `/connections/:relId/claude-chats` - Tutor's view of one of the student's cards (hub) / all their Ask-Claude conversations
- `/cards/:noteId`, `/claude-chats` - The student's own card hub / Claude conversations (More → Claude conversations)
- `/connections/:relId/homework/:jobId` - Review a homework draft made from lesson notes (tutor): load gauge, words / skipped, modes, split, Claude chat, Assign
- `/homework`, `/homework/:id` - The student's one-off homework (to do / done) and the pass (immersive)
- `/tutor-notes`, `/tutor-notes/practice?cards=&notes=` - Notes from your tutor (More → From your tutor, Home row) / practising those cards in the study card (immersive; a rating counts only when due)
- `/audio-lessons`, `/audio-lessons/:id` - Audio lessons: list + New audio lesson (Dialogue / Sleep / Story; More → Practice), the player (immersive; offline once opened)
- `/idioms`, `/idioms/:hanzi` - 成语 Idioms (beta): look one up / browse the starter list, and one idiom's page (More → Practice; tutors More → Tools; the explorer's "📜 Story & usage")
- `/picture-hunt`, `/picture-hunt/:id` - Picture hunt: list + make / upload, and the game (immersive; More → Practice)
- `/practice/strokes?text=` - Handwriting with stroke-order feedback (preview; More → Practice, and study card ⋯ → Write it). Stroke data = hanzi-writer-data (Arphic PL) copied to `/strokes/<hex>.json` at build by `strokeDataPlugin` (vite.config.ts), cached per character in its own IndexedDB (`services/strokeData.ts`); `components/strokes/WritingExercise.tsx` is the drop-in exercise. See docs/STROKE_ORDER.md
- `/materials`, `/materials/:id` - Lesson materials (More → 📑 Lesson materials): upload / share / rename / delete, and the page viewer (cache-first, offline)
- `/calls`, `/calls/:id`, `/calls/:id/review` - Video calls (beta): list + start (More → Video calls, or 📹 on a student / tutor page), the live call (immersive), transcript + lesson report + flashcards
- `/admin/audio` - Admin: TTS providers (status per provider, enable, max RPM, voices with ▶ samples, stored / live order, upgrade backup clips, backlog + Retry / Run backfill; docs/AUDIO.md "Providers")
- `/connections/:relId/board` - The Lesson board: every page of the video-call board with that person, read-only, offline ("📝 Lesson board · N pages" on the student / tutor page)
