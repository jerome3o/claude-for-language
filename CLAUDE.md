# CLAUDE.md - AI Agent Guide

This is a Chinese language learning app with spaced repetition (web PWA + a native Android "Lab" app +
an MCP server). This file is loaded into every agent session, so it holds only **how to work here**, the
**rules you must not break**, and **where to look**. Feature detail lives in `docs/` — see
[Where to find things](#where-to-find-things). When you change a feature, update its doc; add a line here
only for a new cross-cutting rule or a new entry in the index.

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
  in `.github/workflows/deploy.yml`: an `env:` entry `NAME: ${{ secrets.NAME }}`
  plus `echo "$NAME" | npx wrangler secret put NAME` in the `run:` block (never
  `${{ secrets.… }}` inside `run:` — the value would be pasted into the script).
  Setting it in the GitHub UI alone is not enough — the workflow must push it to
  Cloudflare. Workflow actions are pinned to a full commit SHA with a `# vX.Y.Z`
  comment, and every workflow declares least-privilege `permissions:`.
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

In-app feedback items (kind `feedback` / `bug`) are rows of the same table — docs/FEEDBACK.md.

## User Preferences (Jerome)

These are Jerome's stated preferences — respect them in all implementations:

- **Study sessions**: Drill ALL cards due today in one sitting (the end of the STUDY day, not "right now"). Show the same card immediately after rating — no cooldown wait screen.
- **New day starts at 4 am** (like Anki's "Next day starts at"): he studies late, so the study day — queue, budget, daily reader, celebration, streak — turns over at a rollover hour, not midnight (`users.day_rollover_hour`, 0–6, NULL = 4; Settings → Study; `shared/study/studyDay.ts`).
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
npm install                                   # all workspaces
cd worker && npx wrangler d1 migrations apply chinese-learning-db --local && cd ..   # local D1
echo "ANTHROPIC_API_KEY=your-key-here" > worker/.dev.vars
npm run dev            # worker + frontend (npm run dev:worker / npm run dev:frontend for one)
npm run dev:mcp        # the MCP server
```

Setup details: [docs/SETUP.md](./docs/SETUP.md). Deploying is CI's job (see [Deployment](#deployment)).

## Project Structure

```
/
├── worker/            Cloudflare Worker (Hono API): src/index.ts (entry + many routes), src/routes/ (sub-routers),
│                      src/services/ (business logic; services/content = the write path, services/claude-agent =
│                      the Claude chat harness, services/tts = TTS), src/durable/ (Durable Objects: CallRoom,
│                      ChatHub, TtsLimiter, GroupRoom), src/db/ (queries + migrations/), src/middleware/,
│                      char-dict/ (static dictionary shards served as assets), wrangler.toml
├── shared/            Pure TypeScript used by worker + frontend (and ported to the Lab app, parity-tested):
│                      scheduler/ (FSRS), decks/ (budget, study queue, bumps, up next, holds, order),
│                      study/ (study day, sessions, Hard mode, sentence round…), cards/ (card standard, answer
│                      checks, word tags), lesson/ (mini-lesson spec), reader/, claude/, chats/, calls/,
│                      homework/, explorer/, chars/, chinese/ (segmenter), pinyin/, analytics/, auth/, …
├── frontend/          React + Vite PWA: src/pages/, src/components/, src/services/ (sync, offline stores),
│                      src/db/database.ts (IndexedDB via Dexie), src/hooks/, src/api/, public/_headers (CSP)
├── mcp-server/        MCP server (separate Worker, same D1): src/tools/, src/oauth/, src/ui/ (MCP Apps)
├── android-lab/       Pure-native Android app (Kotlin + Compose): core/ (pure ports, parity-tested), app/,
│                      parity/ (golden-vector generator), PARITY.md, README.md
├── native/            Capacitor Android wrapper of the PWA (native/README.md)
├── desktop/           Electron desktop app prototype (desktop/README.md)
├── e2e/               Playwright end-to-end tests (tests/*.spec.ts, tests/fixtures/)
├── scripts/           Data builders (char dict, word dict, word freq, word tags, audio loops)
├── docs/              Feature docs and references (index below)
└── .github/workflows/ deploy.yml (deploy on main), pr-checks.yml (typecheck + tests + build on PRs),
                       e2e-tests.yml (manual + nightly), android-build.yml, android-lab-build.yml, desktop-build.yml
```

The module-by-module tree (what every `shared/` folder and key file holds) is in
[docs/ARCHITECTURE.md "Code map"](./docs/ARCHITECTURE.md#code-map-moved-from-claudemd-nov-2026).

## Where to find things

Read the doc before changing a feature; it has the code map, the endpoints and the rules.

| Topic | Doc | Key code |
|---|---|---|
| Study session: queue, budget, card priority, "Order new cards by", lead cards, ⚡ Study it today, Up next, suspend & snooze, leeches / Forget, sentence sets & the Sentence round, Hard mode, pronunciation transcription & "Say the answer", Ask Claude sheet, tutor notes | [docs/STUDY_SESSION.md](./docs/STUDY_SESSION.md) | `shared/decks/`, `shared/study/`, `frontend/src/pages/StudyPage.tsx`, `frontend/src/hooks/useStudySession.ts` |
| Offline-first, sync, event sourcing (full), content service, data model, FSRS, code map | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | `frontend/src/services/sync.ts`, `shared/scheduler/` |
| Database tables & columns (by migration) | [docs/DATABASE.md](./docs/DATABASE.md) | `worker/src/db/migrations/` |
| Endpoints for decks, folders, notes, cards, stats, AI deck tools, quests, picture hunt, debug reports, admin | [docs/API.md](./docs/API.md) | `worker/src/index.ts`, `worker/src/routes/` |
| Frontend routes, tab bar, navigation | [docs/ROUTES.md](./docs/ROUTES.md) | `frontend/src/App.tsx`, `frontend/src/components/nav/` |
| Model calls (Claude / Gemini), the Claude agent harness in full, Ask Claude, pinyin check, word checks, AI word tags | [docs/AI.md](./docs/AI.md) | `worker/src/services/claude-agent/`, `worker/src/services/structured-call.ts` |
| TTS providers, limiter, stored clips, private media, conversation voices | [docs/AUDIO.md](./docs/AUDIO.md) | `worker/src/services/audio.ts`, `worker/src/services/tts/` |
| Chat (people + Claude threads), Chats tab, Coach, live delivery, push, listening mode, read-aloud voice | [docs/CHAT.md](./docs/CHAT.md) | `worker/src/services/chat/`, `worker/src/durable/chat-hub.ts`, `shared/chats/`, `shared/claude/` |
| ＋ Add tab | [docs/ADD_TAB.md](./docs/ADD_TAB.md) | `frontend/src/pages/AddPage.tsx`, `shared/add/` |
| Language explorer, character sheet, word chips without an LLM | [docs/LANGUAGE_EXPLORER.md](./docs/LANGUAGE_EXPLORER.md) | `shared/explorer/`, `shared/chars/`, `shared/chinese/segment.ts` |
| Mini lessons, exercise types, lesson library & editor, Anki export | [docs/LESSONS.md](./docs/LESSONS.md) | `shared/lesson/`, `worker/src/routes/lesson-editor.ts` |
| Graded readers, reader editor, reader word chips, reader queue | [docs/READERS.md](./docs/READERS.md) | `shared/reader/`, `worker/src/routes/reader-editor.ts` |
| Homework (assignments, one-off pass, library, link homework, drafts, e-mails) | [docs/HOMEWORK.md](./docs/HOMEWORK.md) | `shared/homework/`, `worker/src/routes/homework.ts` |
| Tutor dashboard, student page, insights, card flags & card hub, student profile, session-notes agent, tutor accounts | [docs/TUTORING.md](./docs/TUTORING.md) | `worker/src/routes/tutor-dashboard.ts`, `worker/src/services/tutor-notes-agent.ts` |
| Recording review ("Needs your ear") | [docs/RECORDING_REVIEW.md](./docs/RECORDING_REVIEW.md) | `shared/recordings/` |
| Sign-in, sessions, invites, access requests, onboarding (full) | [docs/AUTH.md](./docs/AUTH.md) | `worker/src/services/auth.ts`, `worker/src/services/signup.ts` |
| MCP server: architecture, OAuth, every tool, tutor MCP Apps, debugging | [docs/MCP.md](./docs/MCP.md) | `mcp-server/src/` |
| Video calls, board, materials, in-call activities, lessons | [docs/VIDEO_CALLS.md](./docs/VIDEO_CALLS.md) | `worker/src/durable/call-room.ts`, `shared/calls/` |
| Group classes (experimental) | [docs/GROUP_CLASSES.md](./docs/GROUP_CLASSES.md) | `shared/group/` |
| Audio lessons (incl. composed lessons / video-lesson recaps from MCP blocks) + private podcast feed | [docs/AUDIO_LESSONS.md](./docs/AUDIO_LESSONS.md) | `worker/src/services/audio-lessons/`, `shared/audio-lesson/` |
| Podcasts (Lab only) | [docs/PODCASTS.md](./docs/PODCASTS.md) | `worker/src/services/podcasts/` |
| Clips · Idioms · Phone practice · Meme review · VR | [docs/CLIPS.md](./docs/CLIPS.md) · [docs/IDIOMS.md](./docs/IDIOMS.md) · [docs/PHONE_PRACTICE.md](./docs/PHONE_PRACTICE.md) · [docs/MEME_REVIEW.md](./docs/MEME_REVIEW.md) · [docs/VR.md](./docs/VR.md) | `shared/clips/`, `shared/idioms/`, `shared/phone/`, `shared/meme-review/`, `shared/vr/` |
| Handwriting / stroke order | [docs/STROKE_ORDER.md](./docs/STROKE_ORDER.md) | `shared/strokes/` |
| In-app feedback | [docs/FEEDBACK.md](./docs/FEEDBACK.md) | `worker/src/routes/feedback.ts`, `shared/feedback/` |
| Usage analytics, cost guard, AI cost | [docs/ANALYTICS.md](./docs/ANALYTICS.md) | `shared/analytics/`, `worker/src/middleware/cost-guard.ts` |
| Import / export formats (JSON, Anki .apkg) | [docs/IMPORT_EXPORT_FORMAT.md](./docs/IMPORT_EXPORT_FORMAT.md) | `frontend/src/services/anki/` |
| Product spec, end-user guide for tutors | [docs/SPEC.md](./docs/SPEC.md), [docs/TUTOR_GUIDE.md](./docs/TUTOR_GUIDE.md) | |
| Lab app: parity checklist, UI kit, Play | [android-lab/PARITY.md](./android-lab/PARITY.md), [android-lab/README.md](./android-lab/README.md), [android-lab/PLAY.md](./android-lab/PLAY.md) | `android-lab/core/` |

## Native Lab app (android-lab/) — keep it at parity

`android-lab/` is a pure-native Android app (its own id `dev.jeromeswannack.chineselearning.lab`,
installed beside the hybrid app, published as `Lab v0.N` GitHub **pre-releases** by
`.github/workflows/android-lab-build.yml`). It uses the same API and review events as the web app.
Jerome wants it at **full feature parity with the web app, to the same standard**:

- **When you implement or change a user-facing feature in the web app, implement it in the Lab app
  too, in the same PR** — spawn a subagent following `.claude/skills/native-parity/SKILL.md` (it has
  the brief to give it) and review its work like your own. If the native half truly can't land in
  that PR, update its row in `android-lab/PARITY.md` (⬜/🟡 + what's missing).
- Logic that must match (FSRS, budget, queue, answer checking, and most `shared/` rules) lives in
  `android-lab/core` and is **parity-tested against the TypeScript**: `./gradlew :core:test` regenerates
  golden vectors by running the TS (`android-lab/parity/`). Changing a parity-tested TS file without the
  matching Kotlin change turns the Lab build red.
- **Crashes are reported** (`data/CrashLog.kt`, in the next debug report). Non-critical start-up work must
  go through `app.safely` / `app.scope` so a failure is reported, never a crash.
- Native sign-in uses the same code exchange as the web (`data/AuthExchange.kt`; see "Sign-in & sessions").
- **Google Play internal testing**: each `main` build also uploads an AAB to the internal track when
  `PLAY_SERVICE_ACCOUNT_JSON` is set; `targetSdk` must meet Play's target-API rule. Details:
  [android-lab/PLAY.md](android-lab/PLAY.md). The privacy policy Play links to is `/privacy`.

## Architecture rules (do not break these)

### Offline-first study

**Study mode MUST work fully offline** (subway, planes, the train). All study uses IndexedDB
(`frontend/src/db/database.ts`, Dexie): no network request during card reviews, instant transitions. Decks,
notes, cards, sentences, audio are cached locally and synced in the background
(`frontend/src/services/sync.ts`). Other features (AI, TTS generation, Ask Claude) need the internet and
must **fail gracefully** — clear message, never crash, hang or block navigation. A new study-related
feature uses the offline hooks (`frontend/src/hooks/useOfflineData.ts`) and stores its data on the device.

### Event-Sourcing Architecture

**Review events are the SINGLE SOURCE OF TRUTH for card scheduling state.**

- Events are **append-only**, deduplicated by id; syncing the same event twice is safe.
- Card state (`queue`, `stability`, `difficulty`, `lapses`, `next_review_at` …) is **derived** from the
  events by FSRS (`shared/scheduler/compute-state.ts`); the stored values and `card_checkpoints` are only a
  re-derivable cache. Client and server compute it independently and must agree.
- **Sync exchanges events, not state.** Never trust scheduling fields from a sync; never write card state
  directly — store the event, then recompute the card from all its events (`recomputeCardFromEvents`).
  If computed and stored state differ, the computed state is right.
- **Forget** ("reset to New") is a separate event (`card_forgets`), merged only into the replay — never a
  review, so no count / streak / stat sees it. Suspend / snooze are holds the queue reads, never events.
- **Deletions travel as tombstones** (`deleted_items` → `/api/sync/changes` `deleted`); devices drop the rows.
- Events the server refuses come back as `orphan_event_ids` and are marked rejected, never "synced".
- An unusable stored state (NaN / negative stability …) never breaks study: it is clamped when scheduling.

Full rules and history: docs/ARCHITECTURE.md "Offline-first & event sourcing (full)".

### Data model & FSRS

- **Note** = the source of truth (hanzi, pinyin, english, audio, fun facts, sentence clue). Each note has
  **3 cards**: `hanzi_to_meaning`, `meaning_to_hanzi`, `audio_to_hanzi`. **Deck** = a collection of notes.
  **ReviewEvent** = one review (rating, time, answer, recording).
- Scheduling is **FSRS** via `ts-fsrs` (`shared/scheduler/`; wrappers `frontend/src/services/anki-scheduler.ts`,
  `worker/src/services/anki-scheduler.ts`). Ratings again 0 / hard 1 / good 2 / easy 3; queues NEW 0,
  LEARNING 1, REVIEW 2, RELEARNING 3. Short-term steps: Again ~1 min, Hard ~6 min, Good ~10 min, Easy ~2 days.
  `ease_factor` / `interval` / `repetitions` are legacy display fields.

### Content service — the one write path

```
route / Claude tool / queue job / MCP (via HTTP)  →  worker/src/services/content  →  db/queries  →  D1
```

Nothing outside `worker/src/services/content/` INSERTs / UPDATEs / DELETEs decks, notes or cards
(exceptions: card *scheduling* writes from reviews, `routes/test-auth.ts` cleanup). It creates the 3 cards,
queues TTS / sentence sets / word checks, writes tombstones, propagates audio to student copies, and fills a
new deck from `DEFAULT_DECK_SETTINGS` (`shared/decks/defaults.ts` — change new-deck defaults there only).
The MCP server never writes content to D1; its tools call the API. Detail: docs/ARCHITECTURE.md.

### Study queue, budget, study day — one definition each

- "Due today" = `selectStudyQueue` in `shared/decks/study-queue.ts`; the budget allocator = `allocateNewCards`
  in `shared/decks/budget.ts`; the study day = `shared/study/studyDay.ts` (rollover hour, default 4 am).
  Home's counts, the session, the server's per-user day and the Lab app all use these (Lab ports
  parity-tested). Never re-implement a count — call the shared function.
- Card priority: learning cards due now → ⚡ bumped cards mixed with reviews → new + review mix → learning
  cards on cooldown due today. Full queue rules (order, lead cards, Up next, holds, review-load cap):
  docs/STUDY_SESSION.md and its "Code map & API" section.

### Card standard

`shared/cards/standard.ts` holds `CARD_STANDARD`, the one text every Claude that makes cards reads (Generate,
Ask Claude, coach, chat, MCP `instructions`). Its HARD rules are enforced by `cardTextProblems` in the content
service — a card that breaks them is refused with a message saying where the content belongs:
- **hanzi is ONE clean form** — no slashes, parentheses, brackets, pipes, ellipses, blanks or placeholders.
  Alternatives / variants go in `fun_facts` (accepted typed answers in `alternatives`). TTS reads every symbol.
- **pinyin** with tone marks (nǐ hǎo, never ni3 hao3; proper Unicode ā á ǎ à …), spaces between words.
  **english**: one clear meaning; other senses in fun_facts.
- **fun_facts is the explanation**: each word / character, then structure / usage, then the common mistake.
- **sentence_clue**: one short real sentence containing the word exactly; no brackets, slashes, ellipses, blanks.
- **一 / 不 tone changes** are written (yí gè, bú shì); no other tone sandhi. ONE function applies it:
  `applyYiBuToneChanges` (`shared/pinyin/toneChange.ts`, Lab `ToneChange.kt`, parity-tested) — every automatic
  pinyin (device or Claude) goes through it.

Change the rules in `shared/cards/standard.ts` only. Reader pages follow `READER_STANDARD`
(`shared/reader/standard.ts`, docs/READERS.md).

### Pinyin check on lessons and readers

Deterministic (no model): `worker/src/services/pinyin-check.ts` lines up every hanzi + pinyin pair a lesson,
reader or audio-lesson plan carries and **corrects only the impossible** (a syllable its character never has)
on write; anything ambiguous becomes a warning, never a rewrite. Runs on every lesson / reader write path;
copies inherit the checked spec. Details + the stored-content scan: docs/AI.md.

### Calling Claude reliably

Read docs/AI.md before adding a model call. The rules:
- **Thinking counts against `max_tokens`** and the Sonnet / Opus models think by default. With forced
  `tool_choice`, set `thinking: { type: 'disabled' }`. Model constants live in `worker/src/services/models.ts`
  (`SONNET_MODEL`, `OPUS_MODEL`, `HAIKU_MODEL`) — never hard-code an id elsewhere.
- **Opus (`OPUS_MODEL`) always thinks**: `{ type: 'disabled' }`, forced `tool_choice` and `temperature` are
  400s — wrap params in `withEffort(params, …)` and use `tool_choice: auto` + an instruction naming the tool.
- **Short structured replies** use `structuredCall` (`worker/src/services/structured-call.ts`): forced tool,
  thinking off, `stop_reason` checked, validated, retried (last attempt on Haiku); throws
  `StructuredCallError` → routes answer 503 (retryable) or 502 (declined) with a human reason.
- **Every E2E path has a stand-in** checked FIRST when `E2E_TEST_MODE === 'true'` (see "E2E is hermetic").

### Claude agent harness

`worker/src/services/claude-agent/` is THE one place every Claude **chat** turn goes through —
`runClaudeTurn(env, ctx, input)` (`index.ts`): Ask Claude on a card, Coach follow-ups, plain Claude chats,
Discuss with Claude, reader / exercise questions, Practice role-plays. Threads are stored in
`coach_conversations` / `coach_messages` (all SQL in `claude-agent/store.ts`), streamed, with memory.
- A new context = one provider file in `contexts/` + a line in `contexts/index.ts` + its tools' `contexts`
  in `tools/registry.ts` (each tool declared ONCE there) + a kind in `types.ts`.
- `MODEL_POLICY` in `claude-agent/model.ts` is the only place a chat's model / thinking is chosen.
- **Prompt caching: ≤ 4 breakpoints** (last tool, static rules, per-user block, the conversation tail) —
  nothing per-card or per-request may go in the tools or the static system block; per-card facts ride in
  the first user message.
- **Privacy**: no context or tool reads `student_profiles` (the tutor's private note); the learner's agent
  sees only the learner's own rows (tested in `__tests__/privacy.test.ts`).

Full description (contexts, threads, streaming, memory, practice): docs/AI.md and docs/CHAT.md.

### Calling Gemini

Every Gemini call goes through `geminiGenerateContent` (`worker/src/services/gemini.ts`) with a model LIST
(`GEMINI_FLASH_MODELS` / `GEMINI_IMAGE_MODELS`): a retired model's 404 falls through to the next. The key goes
in the `x-goog-api-key` header, never the URL. `leastThinking(model)` picks the thinking setting per family.

### TTS & media

Read docs/AUDIO.md before touching TTS.
- **Every provider call goes through `callProviderTTS`** (`worker/src/services/audio.ts`), which takes a slot
  from that provider's `TtsLimiter` Durable Object (learned rate, interactive before batch). A new TTS path
  must use it. A refused clip books its slot and is requeued — no refuse-and-requeue churn.
- Provider order / voices are an admin setting (`shared/tts/config.ts`, `/admin/audio`). Stored clips are
  made by `ensureClip` (`worker/src/services/tts/clips.ts`) and background clips go through `tts-queue`.
- **Every response that streams an R2 object goes through `applyStoredFileHeaders`**
  (`worker/src/services/stored-file-headers.ts`); uploads store a type sniffed from the bytes.
- **`GET /api/audio/<key>` is an allowlist** (`shared/media/access.ts`): person-made media needs a credential
  (signed link, media token or Bearer) and the right person. **A new R2 key prefix goes in BOTH registries**:
  `STORAGE_PREFIXES` (`worker/src/services/admin/storage-cleanup.ts`, test-enforced) and `shared/media/access.ts`.

### Cost guard & analytics

- **A new costly endpoint (model / TTS / job-creating) must be added to its cost-guard group** (`costGroupFor`
  in `worker/src/middleware/cost-guard.ts`, tested). docs/ANALYTICS.md "Cost guard".
- **Every new user-facing feature emits its catalogue event(s)**: one line in `shared/analytics/events.ts`
  (+ the Kotlin mirror `AnalyticsEvents.kt`, parity-tested) and one call — web `track(…)`, Lab
  `app.analytics.track(…)`, worker `trackServer(…)`.
- **Privacy rule: ids, enums, counts, durations, booleans only** — never message text, card content, answers,
  recordings, tokens, URLs or e-mails (`sanitizeProps` in `shared/analytics/privacy.ts` enforces it).

### Create, then send (tutor content)

An agent sent a 319-word deck a tutor never meant to send. Rule (MCP server `instructions` and every tutor
tool): **create content in the tutor's own account; never send anything to a student unless the tutor
explicitly asks to send that item to that named student; when in doubt, create it and ask.** Send tools
require `relationship_id` + `confirm: true`; `auto_share` defaults to false everywhere
(`mcp-server/src/tools/homework-send.ts`, `tools/create-then-send.test.ts`). docs/MCP.md.

### Sign-in & sessions

Full reference: docs/AUTH.md. The rules:
- **The session token never travels in a URL.** Every app uses a PKCE-style code exchange:
  `/api/auth/login?challenge=` → one-time `?code=` → `POST /api/auth/exchange { code, verifier }`
  (`worker/src/services/auth.ts`, `worker/src/routes/auth-session.ts`). Only the Vite dev server still
  reads `?session_token=` (E2E / screenshots).
- **Sliding 30-day sessions** (`renewSessionIfDue`). A 401 from our API sets a persistent **signed-out state**
  with a banner on every screen (`shared/auth/session.ts`, Lab `SessionRules.kt`, parity-tested) — local
  data and outboxes are kept.
- **Signing in again never wipes data**: the same account resumes with everything kept; a different account
  clears the previous one's data, asking first when something hasn't uploaded. Sign out with unsent work asks
  first. **Sign out of all devices** also revokes the MCP grants.

### Invite-only sign-up

A Google sign-in for an unknown e-mail creates a user **only if an invite admits it** (the gate is the
`/api/auth/callback` handler in `worker/src/index.ts` + `worker/src/services/signup.ts`): an invite token, an
e-mail-bound invite, a pending invitation, or `ADMIN_EMAIL` (always admitted). Otherwise an `access_requests`
row and `/?signup=invite_only`. Only verified Google e-mails ever match. Invite uses are claimed atomically
(`claimInviteUse`); an existing account is never connected by a link alone. Invite tokens are bearer
secrets — never log them. Details: docs/AUTH.md.

### Content-Security-Policy

`frontend/public/_headers` ENFORCES the CSP (plus `frame-ancestors 'none'`, nosniff, Referrer-Policy,
Permissions-Policy). **A new external origin (API, socket, image / media host, script) must be added to that
header or the browser blocks it.** Violations are reported to `POST /api/csp-report`.

### Queues, migrations, Durable Objects

- **A new queue must be added to the "Ensure Queues Exist" step in `deploy.yml`** (and `wrangler.toml`).
  Long model jobs run on a queue, not `waitUntil` (the isolate dies mid-call); clients poll a `progress` column.
- **Migrations**: `worker/src/db/migrations/NNNN_name.sql`, run in filename order; CI applies them to
  production before deploying the worker. Apply locally with
  `cd worker && npx wrangler d1 migrations apply chinese-learning-db --local`. Never edit an applied migration;
  add a new one. Update the types in `worker/src/types.ts` / `frontend/src/types.ts` and docs/DATABASE.md.
- A new Durable Object class needs a `[[migrations]]` entry; the MCP agent's DO must be SQLite-backed
  (`new_sqlite_classes`, see docs/MCP.md).

## Development Guidelines

### Mobile-first design

**This app is primarily used on mobile devices** (a Pixel Fold, mostly folded).
- Mobile styles first, then `@media (min-width: 640px)` for larger screens (≥ 1024px rarely needed).
- Touch targets ≥ 44px high; body text ≥ 16px; inputs 16px+ (no iOS zoom); rem for font sizes; no
  horizontal overflow; modals usable on small screens; one-handed navigation.
- **Sheets and long forms — the primary action never scrolls away**: every modal / bottom sheet puts its
  Save / Send / Add row in **`.sheet-footer`** (`frontend/src/index.css`) as the LAST child of the sheet's
  scrolling body (sticks to the bottom, settles at the end; `--sheet-pad` / `--sheet-pad-bottom`). Sheets size
  with `dvh`. A long form on a normal page uses `.page-footer`. Lab: wrap the sheet in `SheetScaffold`
  (android-lab/docs/UI_KIT.md). E2E: `e2e/tests/sticky-save.spec.ts`.

### When adding a feature

1. Types in `worker/src/types.ts` and `frontend/src/types.ts`; a migration if the schema changes.
2. Routes in `worker/src/routes/` (registered in `worker/src/index.ts`); API client in `frontend/src/api/`.
3. Frontend pages / components; **test on a phone viewport**.
4. **Tests**: unit tests for pure logic and services, E2E for user-facing flows and critical paths.
5. The Lab app in the same PR (see above); the analytics event; the cost-guard group if it costs money.
6. Update the feature's doc in `docs/` (and docs/DATABASE.md / docs/ROUTES.md / docs/MCP.md as relevant);
   update this file only for a new cross-cutting rule or a new row in "Where to find things".

### Running tests

```bash
npm test               # unit tests: frontend, worker, mcp-server (incl. FSRS scheduler tests)
npm run typecheck      # worker + frontend + mcp-server
npm run test:e2e       # Playwright (starts worker + frontend); npm run test:e2e:ui to debug
```

**E2E Test Auth**: specs use `/api/test/auth` (and other `/api/test/*` seeders), which only work with
`E2E_TEST_MODE=true` in `worker/.dev.vars`; `?session_token=` logs the browser in on the dev server.

**E2E is hermetic**: the workflow (`e2e-tests.yml`: manual dispatch + nightly on main) passes no real API keys
(`e2e/setup-test-env.sh` writes `test-key`s). Every model / TTS / image path a spec reaches must take its
E2E stand-in whenever `E2E_TEST_MODE === 'true'` — checked FIRST, never only "when no key is set" — or the
spec mocks the route. **Ports**: `E2E_WEB_PORT=3010 E2E_API_PORT=8797 npx playwright test` (in `e2e/`) starts
both servers on those ports (another session on 3000 / 8787); the Vite proxy and the dev WebSockets follow
(`VITE_API_PROXY`). Never commit a `frontend/vite.config.js`: Vite prefers it over `vite.config.ts`. Specs that
study a card call `skipFirstCardExplainer` (`e2e/tests/fixtures/explainer.ts`).

CI: **PR Checks** (`pr-checks.yml`) runs typecheck, unit tests and the frontend build on every PR. E2E is
NOT run on PRs automatically — dispatch `e2e-tests.yml` on your branch for any change that is not docs-only.

### Environment variables / secrets

Worker secrets (pushed by `deploy.yml` from GitHub secrets): `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`MINIMAX_API_KEY`, `GOOGLE_TTS_API_KEY`, `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` (optional), `SONIOX_API_KEY`,
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `ADMIN_EMAIL`, `NTFY_TOPIC`, `SENDGRID_API_KEY`,
`TURN_KEY_ID` / `TURN_KEY_API_TOKEN`, `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, `FCM_SERVICE_ACCOUNT_JSON`,
`CCR_FEATURE_REQUEST_ROUTINE_URL` / `CCR_FEATURE_REQUEST_ROUTINE_KEY`; the MCP server's
`COOKIE_ENCRYPTION_KEY`. Wrangler vars in `worker/wrangler.toml`: `MINIMAX_RPM` (hard cap on the learned TTS
rate, 55) / `MINIMAX_RPM_MAX` (60), `AI_DAILY_COST_CAP_USD` (default "10", "off" = none). D1 / R2 / queue / DO
bindings are in `wrangler.toml`.

### Common tasks

- **New API endpoint**: handler in `worker/src/routes/`, register in `worker/src/index.ts`, client in
  `frontend/src/api/`, a line in the feature's doc (or docs/API.md).
- **Schema change**: new migration, types in worker + frontend, test locally with `wrangler d1 migrations apply`.
- **New card type**: `CardType` in the types, card generation in `worker/src/services/cards.ts` /
  `insertCardsForNote` (`worker/src/db/queries.ts`), the study flow in the frontend, the Lab app.

## MCP Server

`mcp-server/` is a separate Worker (same D1) at `https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp`
(Streamable HTTP, OAuth via Google, existing accounts only). Tools call the main API as the signed-in user
(`mcp-server/src/api.ts`), so access checks stay in the API. Its Durable Object must be SQLite-backed
(`new_sqlite_classes`). Tool catalogue, OAuth, MCP Apps, debugging: **docs/MCP.md**. After touching an MCP App
UI run `cd mcp-server && npm run build:ui` (regenerates `src/app-html.ts`).

## Deployment

### How deployment works

**Deployment is automatic via GitHub Actions.** On push to `main`, `.github/workflows/deploy.yml`: type checks,
builds the frontend, **applies D1 migrations to production**, deploys the Worker API, sets worker secrets,
deploys the frontend to Cloudflare Pages and deploys the MCP server. Watch it with
`gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') --exit-status`. If it fails, check
the Actions log (usually a type error, a migration failure or a missing secret). Manual fallback:
`cd worker && npx wrangler d1 migrations apply chinese-learning-db --remote` then `npm run deploy`.

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
