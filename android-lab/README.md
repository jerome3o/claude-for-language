# 学 Lab — the experimental pure-native Android app

A pure-native Android app (Kotlin + Jetpack Compose) that lives **next to** the solid
hybrid app in `native/`, never instead of it. Same account, same API, same review
events: a review made in either app reaches the other on its next sync, exactly like
two phones. The goal is full feature parity with the web app, with a slicker, more
satisfying feel: springy card flips, rich haptics (composed primitives on the Pixel),
instant synthesized sound effects, confetti, streaks.

Status: **v1 = the study loop** — sign in, sync, study all decks or one deck with all
three card types, example sentences, undo, "Study 10 more", offline study with
background upload, prefetched audio — inside the **same tab bar as the web app** (Study ·
Chats · Tutor · Progress · More for a student; Students · Chats · Library · More for a tutor
account). Every other web screen already has a route: it opens natively once built, and
until then a placeholder that opens the main app at the same screen. The checklist and the
work packages are [PARITY.md](PARITY.md); how to add a feature is
[`.claude/skills/native-parity/SKILL.md`](../.claude/skills/native-parity/SKILL.md); the
shared Compose pieces are [docs/UI_KIT.md](docs/UI_KIT.md).

## Installing it (Obtainium)

The Lab app has its own id, `dev.jeromeswannack.chineselearning.lab`, so it installs
beside the main app. CI (`.github/workflows/android-lab-build.yml`) publishes each
build on `main` as a GitHub **pre-release** named `Lab v0.N` (tag `lab-v0.N`, asset
`chinese-learning-lab.apk`), signed with the same key as the main app.

In Obtainium: **Add App** → `https://github.com/jerome3o/claude-for-language`, then in
the app's additional options:

- **Include prereleases**: on
- **Filter release titles by regular expression**: `^Lab`
- **Fallback to older releases**: on (so it walks past newer main-app releases)

The existing main-app entry needs no change: Obtainium skips pre-releases unless an
entry opts in, so it keeps installing `Android v1.N` releases only. (For belt and
braces you can give it the title filter `^Android`.)

**Google Play (internal testing)**: the same builds also go to Play's internal testing track
as `chinese-learning-lab-v0.N.aab` (attached to each pre-release too). Setup, the one manual
first upload, and why a Play install can't update an Obtainium install (Google re-signs it):
[PLAY.md](PLAY.md). `versionCode` is the workflow run number for both channels.

**Chat notifications** (instant pings + Reply from the notification) need a one-time Firebase
setup — two GitHub secrets: [PUSH.md](PUSH.md). Without it the app still notifies while open
(live socket) and every ~15 minutes in the background.

PR builds upload a debug APK as the `chinese-learning-lab-debug-apk` workflow
artifact (debug-signed: uninstall before switching between debug and release). Pushes build
only on `main`; a branch builds through its PR, or with Actions → Android Lab Build → "Run
workflow" when it has none. Core parity tests, app unit tests, the debug APK and the release
build are parallel jobs; on `main` the publish job waits for all of them.

Sign-in opens Google in a Chrome Custom Tab. The worker's `/api/auth/login?client=lab&nonce=…`
carries the app in the OAuth state and the callback redirects to
`chineselearning-lab://auth?session_token=…&nonce=…` (`NATIVE_AUTH_CLIENTS` in
`worker/src/services/auth.ts`); the app only accepts the nonce it generated.

## Layout

```
android-lab/
├── core/     Pure Kotlin/JVM — the logic that must match the web app exactly
│   ├── Fsrs.kt         line-by-line port of ts-fsrs 5.2.3 (BasicScheduler, Alea fuzz)
│   ├── CardState.kt    port of shared/scheduler/compute-state.ts (replay, previews, formatInterval)
│   ├── Budget.kt       port of shared/decks/budget.ts (global budget, deck queue)
│   ├── StudyQueue.kt   getStudyQueue / selectNextItem from the web study session
│   ├── Revisit.kt      port of shared/study/revisit.ts — when finished lessons / readers come back ("revisit later", Done for good)
│   ├── AnswerKey.kt    typed-answer checking (utils/numberHanzi.ts + AnswerDiff)
│   ├── Pinyin.kt       port of pinyin-pro 3.28.0 `pinyin()` (editors' offline 拼音 fill); dict in resources/pinyin, regenerate: node parity/extract-pinyin-dict.mjs
│   ├── spec/           shared/lesson + shared/reader as JSON trees: validate, diff, export, the exercise catalogue (JsJson = JS semantics)
│   └── JsCompat.kt     JS number/date semantics (toFixed, Math.round, Number→String)
├── parity/   generate-fixtures.ts + fixtures/<feature>.ts: run the web's TypeScript for golden vectors
├── docs/     UI_KIT.md — the shared Compose pieces and how to screenshot them
└── app/src/main/java/…/lab/
    ├── LabApp.kt, MainActivity.kt   singletons (repo, cache, outbox, fx) · sign-in gate + deep links
    ├── data/
    │   ├── Api.kt, Repository.kt, Db.kt, SyncWorker.kt   the core mirror + sync (web: services/sync.ts)
    │   ├── Migrations.kt            Room migrations — never destructive (unsynced events live here)
    │   ├── api/Http.kt              generic authed get/post/put/patch/delete/upload + error sentences
    │   ├── api/<Feature>Api.kt      each feature's endpoints + DTOs (extension functions on Api)
    │   └── platform/                JsonCache (offline feature data), Outbox (offline writes),
    │                                CachedResource, LabPlatform, FeatureSyncs (the sync registry)
    ├── fx/       Sounds (synthesized, SoundPool), Haptics (composed primitives), WordAudio
    └── ui/
        ├── nav/          LabShell (NavHost + tab bar), LabNav (open by web path), NavRules (port of
        │                 tabs.ts / navRole.ts / landing.ts), Routes, WebDestinations, FeatureGraphs (registry)
        ├── kit/          shared Compose pieces (docs/UI_KIT.md)
        ├── placeholder/  "not in the Lab app yet" → open the main app at the same route
        ├── home/ study/  Study tab (+ the tutor-account home) and the session
        ├── more/         More tab (+ the MoreExtraRows.kt slot)
        └── decks/ progress/ connections/ library/   tab-root stubs owned by packages C / D / E / G
```

**Adding a screen**: `ui/<feature>/<Feature>Nav.kt` with
`fun NavGraphBuilder.<feature>Graph(nav: LabNav)` registering web-shaped routes
(`composable(Routes.route("/readers/{id}")) { … }`), one line in `ui/nav/FeatureGraphs.kt`,
and navigate with `nav.open(Routes.reader(id))`. Offline data: a `FeatureSync` registered in
`data/platform/FeatureSyncs.kt` that fills the `JsonCache`; offline writes:
`app.outbox.enqueue…` (idempotent endpoints with a client id). Neither needs a schema change.

**Deep links**: `chineselearning-lab:///<web route>` (e.g. `chineselearning-lab:///decks/abc`)
opens that screen, or its placeholder; `chineselearning-lab://auth?…` is the sign-in callback.

**Data model**: a local Room mirror of decks, notes, cards, sentence sets and review
events. Review events are the source of truth: a card's scheduling columns are a cache
of `CardScheduler.computeCardState(events)`, recomputed whenever its events change.
Sync mirrors `frontend/src/services/sync.ts`: full sync (`/api/decks` + each deck),
incremental (`/api/sync/changes`, tombstones first), events (`POST /api/reviews`
upload, `GET /api/reviews` cursor download, `DELETE` for undone reviews), sentence sets
(`/api/sentences/changes`), then every referenced audio clip is downloaded for the train.

**Sync speed** (a first sync of 24 decks / 3,000 notes / 9,000 cards / 45k events): deck
downloads run 4 at a time, review pages hold 5,000 events and the next page is fetched
while the current one is written, and card states are replayed ONCE per sync, after the
events are in, in batched transactions (500 cards each, only changed rows written) — never
one transaction per card. Audio downloads run after the sync in their own background job,
outside the sync lock, so the review upload after each rating never waits for them. Every
sync records per-step timings (`SyncStatus.lastRun`: Lab settings → Last sync, and the debug
report's `sync.last_run`); `SyncBenchmarkTest` (opt-in, against a seeded local worker) and
`core/…/ReplayBenchmarkTest` measure it.

## Outside the app: widget, shortcuts, notifications (`app/…/shell/`)

The hybrid app's native shell (`native/README.md`), rebuilt local-first. Ids, channels,
shortcut ids and labels are the Lab's own, so both apps install side by side.

- **Widget** (*Lab · due today*): the Study button's count from Room (`TodayCounts.allDecksQueue`
  — the same queue as Home and the session, so it works offline), "about N min", the one-off
  homework due now, and 学 Study / ✏️ Coach. Redrawn after every sync (`dataVersion`), after a
  rating from a notification, by the hourly check and by an inexact alarm just after midnight.
  More → Lab app → *Add the home-screen widget* pins it. **Resizable** from 2×1 up; it lands as
  a compact 3×1 row. One layout per size (`ShellRules.WidgetSize`, anchors in `WIDGET_ANCHORS`):
  2×1 学 (the count as a badge on it) + ✏️, 3×1 count + caption + 学 + ✏️, 4×1 the 学 Study
  pill + ✏️, 2×2 count + homework + 学 Study + ✏️, 3×2 and up 学 Study + the labelled ✏️ Coach.
  **The coach is at every size**: ✏️ opens `/coach?focus=1` (`ShellLinks.COACH_TYPE`) — the
  coach's sentence box focused with the keyboard up. Every widget button is a 48dp tap target
  (drawn as a 42dp circle / pill, `shell_icon_*`, `shell_pill_*_tall`). Android 12+ gets a size map
  (`RemoteViews(Map<SizeF, RemoteViews>)`); older launchers get the layout for the size in the
  widget's options, redrawn on resize. A widget placed before this change keeps its old size —
  remove it and add it again to get the compact default.
- **Launcher shortcuts** Study / Coach / Analyze and **select text → Coach (Lab)**
  (`PROCESS_TEXT` → `/coach?text=…`). Everything from outside is a `chineselearning-lab:///<route>`
  link (or the hybrid's `route` extra), so a screen that isn't native yet opens its placeholder.
- **Due-card notifications** (`DueCheckWorker`, hourly): sync if online, then — unless it is
  22:00–08:00, notifications are off / not allowed, signed out, a tutor account, or nothing is
  due — the most overdue *seen* hanzi → meaning card due now (never a new card: the new-card
  budget is spent in sessions). *Show answer* reveals pinyin, meaning and the example sentence;
  **Again / Good / Easy** (with the session's intervals) call `Repository.recordReview` — a real
  local event, state recomputed from events, uploaded by sync or the upload worker, so it works
  offline too — then "✓ Good · back in 4d" with *Next card*. A card notification whose card was
  answered elsewhere is withdrawn after the next sync; one still due is never replaced (you may be
  on its answer). **Homework** due today / overdue gets one notification a day per assignment.
- Android 13+ asks for the notification permission once after sign-in; More → Lab app →
  *Due-card notifications* switches it all off or asks again. Rules: `ShellRules.kt` (pure,
  `ShellRulesTest`); data + rating: `ShellDataTest`; screenshots: `NativeShellScreenshots`.

## Video calls (`ui/calls/`, `data/calls/`, `core/…/calls/`)

`/calls`, the live call `/calls/:id` and `/calls/:id/review`, on the same API and room protocol
as the web (docs/VIDEO_CALLS.md). Media is Google's WebRTC (`io.getstream:stream-webrtc-android`,
`org.webrtc`): `rtc/WebRtcMedia` (camera 640×480@24, mic, MediaProjection screen share),
`rtc/PeerLink` (the web's one-offerer negotiation, so a phone and a browser connect),
`CallRoomSocket` (OkHttp WebSocket, join ticket, reconnect, server clock). `ui/calls/CallController`
is the port of `useCall.ts` behind interfaces, so it is unit-tested with a fake room / media /
recorder. The mic is recorded as Opus (MediaCodec) in Ogg pages written by `core/…/calls/OggOpus.kt`,
cut into 5-min pieces and 10 s chunks (`PieceRecorder`), uploaded through the Outbox
(`CallUploads`). `CallService` is the foreground service that keeps a call alive with the screen off.
The first time the call screen opens it asks for the microphone, camera, Bluetooth (sound routing)
and notifications (the call's ongoing notification).
The camera always starts on (only a muted mic is remembered, `core/…/calls/CallDevices.kt`). Round 5:
the relationship's tutor leads — "Show for student" puts her stage tile on the student's stage once per
new show (`core/…/calls/CallFollow.kt`, driven by `CallController` through `CallLayoutHolder`), and she
can stop the student's screen share (`ui/calls/CallLead.kt`).

## Usage analytics (`data/analytics/`)

Which screens and features are used — never messages, cards, answers or recordings — so the
admin can ask "has Minghui used feature X?" (docs/ANALYTICS.md). `app.analytics.track("chat.send",
mapOf("kind" to "text"))` (or `Analytics.track(…)` where there is no `app`); the event and its props
must be in the shared catalogue (`core/…/analytics/AnalyticsEvents.kt`, parity-tested against
`shared/analytics/events.ts` — a new event is one line in each) and go through `AnalyticsPrivacy`
before they are queued. Screen views come from the shell's back stack; events wait in their own
`analytics.db` and go up after every sync and every minute in front. Settings → Advanced has the
opt-out switch.

## Parity: proving the logic matches

`./gradlew :core:test` first runs `parity/generate.sh`, which bundles
`parity/generate-fixtures.ts` with esbuild and runs it on node. That script calls the
**web app's own** `computeCardState`, `applyReview`, `getIntervalPreviews`,
`getRetrievability`, `formatInterval`, `allocateNewCards`, `normalizeNumbersToHanzi`,
`hanziAnswerKey`… on thousands of seeded cases (400 cards × up to 24 reviews with
realistic timing, 300 budget scenarios, answer edge cases, JS number formatting). Then
`ParityTest` requires the Kotlin to produce **exactly** the same values (doubles compared
for equality). A change to the TypeScript that the Kotlin doesn't follow turns the Lab
build red. CI runs this on every change to `shared/scheduler`, `shared/decks` or
`numberHanzi.ts`.

## Running things

Needs JDK 17+, the Android SDK (`local.properties` → `sdk.dir=…`) and, for the parity
tests, `npm ci` at the repo root.

```bash
cd android-lab
./gradlew :core:test                 # parity + queue engine
./gradlew :app:testDebugUnitTest     # Robolectric tests (screenshot rendering)
./gradlew :app:recordRoborazziDebug  # writes PNGs to app/screenshots/
./gradlew :app:assembleDebug         # app/build/outputs/apk/debug/app-debug.apk

# Sync contract against a real local worker (E2E_TEST_MODE=true in worker/.dev.vars):
LAB_E2E_API=http://localhost:8787 ./gradlew :app:testDebugUnitTest --tests '*SyncContractTest*'
```
