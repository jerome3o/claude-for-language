---
name: native-parity
description: How to implement a web-app feature in the pure-native Android Lab app (android-lab/, Kotlin + Compose) to the same standard, keeping FSRS / queue / answer logic provably identical. Use whenever a user-facing feature changes in frontend/ or shared/, when asked to port features to the native app, or when fanning out subagents over android-lab/PARITY.md.
---

# Implementing a feature in the native Lab app

`android-lab/` is a pure-native Android app (Kotlin, Jetpack Compose, Room) that talks
to the same API as the web app and shares the account's review events. It must reach
**full feature parity with the web app, at the same quality bar** — not a lesser port.
`android-lab/PARITY.md` is the checklist; `android-lab/README.md` explains the layout.

## The rule

When you implement or change a user-facing feature in the web app (`frontend/`,
`shared/`), the same change goes into the Lab app **in the same PR**: spawn a subagent
with the brief below (in a worktree if you're also editing the web side), then review
its diff like your own. If the native half genuinely can't be done in that PR, add or
update the PARITY.md row (⬜/🟡 with what's missing) — never leave it silent.

## Brief for the subagent (fill in the angle brackets)

> Implement <feature> in the native Lab app (android-lab/) to full parity with the web
> app. Web implementation: <files / PR>. Read .claude/skills/native-parity/SKILL.md and
> android-lab/README.md first and follow them exactly. Match the web behaviour
> precisely (same rules, same edge cases, same copy where it makes sense); make the UI
> feel native and satisfying (springs, haptics, sounds via fx/). Add tests
> (core unit tests / parity fixtures / Roborazzi screenshots / SyncContractTest) and
> run the verification commands. Update android-lab/PARITY.md. Report what you built,
> what you verified, and any deliberate deviation.

## How to build it

1. **Read the web side first** — the component, hook, service, API route and any
   `shared/` module. Write down the rules (order, limits, fallbacks, empty/offline
   states) before writing Kotlin. The PARITY.md row names the web files.
2. **Put logic where it can be tested**:
   - Pure rules → `android-lab/core` (plain Kotlin/JVM, no Android). Mirror the web
     function name in a KDoc line (`/** Port of foo() in bar.ts */`).
   - If the rule lives in `shared/` (TypeScript), **extend the parity fixtures**:
     add cases to `android-lab/parity/generate-fixtures.ts` and assertions to
     `core/src/test/…/ParityTest.kt`. Gradle regenerates the fixtures from the TS on
     every test run, so the two stay provably identical. Compare doubles exactly.
   - If the rule only lives in `frontend/` and is non-trivial, prefer moving its pure
     part into `shared/` first (with its vitest tests) so both apps test the same thing.
   - JavaScript semantics matter: use `Js.*` (toFixed, Math.round, Number→String, dates)
     and `StrictMath`; JS regex `\b`/`\d`/`\w` are ASCII while Android's ICU regex is
     Unicode — spell classes out (see `AnswerKey.kt`).
3. **Data**: call the same endpoints the web client calls, via `data/Api.kt`
   (`ignoreUnknownKeys`; decode only the fields you use). Study-path data must work
   offline: store it in Room (`data/Db.kt`) and sync it in `data/Repository.kt`.
   **Schema changes need a real Room `Migration`** and a version bump — never
   `fallbackToDestructiveMigration`: the database holds unsynced review events.
   Writes the web app makes through the content service go through the same API
   routes; never add server behaviour that only the Lab app uses without also
   documenting it in the worker (and CLAUDE.md).
   Review events stay the source of truth: card state is always
   `CardScheduler.computeCardState(events)`.
4. **UI**: Compose; a stateless `FooScreen(ui, actions)` plus a ViewModel, so screens
   render in screenshot tests. Use `LabTheme` / `Lab.colors` / `Palette` (rating and
   queue colours match the web). Design for the Pixel Fold: phone 412dp wide and an
   unfolded two-pane layout ≥ 640dp. 44dp+ touch targets. Feedback matters here —
   springs for motion, `Haptics` and `Sounds` for moments that should feel good.
5. **Things the Lab app doesn't have yet** open the main app at the matching route
   (`MainActivity.openInMainApp("/route")`), never a dead end.

## Verify before reporting done

```bash
cd android-lab
./gradlew :core:test                      # parity + engine tests (regenerates fixtures from the TS)
./gradlew :app:testDebugUnitTest          # Robolectric (+ screenshot rendering)
./gradlew :app:assembleDebug              # it builds
./gradlew :app:recordRoborazziDebug       # PNGs in app/screenshots/ — look at them
# Sync against a real local worker (worker/.dev.vars: E2E_TEST_MODE=true):
#   (cd ../worker && npx wrangler d1 migrations apply chinese-learning-db --local && npx wrangler dev)
#   LAB_E2E_API=http://localhost:8787 ./gradlew :app:testDebugUnitTest --tests '*SyncContractTest*'
```

In this container Maven Central rate-limits: if Gradle gets HTTP 429, add
`~/.gradle/init.d/mirror.gradle` pointing `repo.maven.apache.org` at
`https://maven-central.storage-download.googleapis.com/maven2/` (container-only, never
commit it). The Android SDK is not preinstalled: download the command-line tools from
dl.google.com into `/opt/android-sdk` and install `platform-tools`, `platforms;android-35`,
`build-tools;35.0.0`; `android-lab/local.properties` → `sdk.dir=/opt/android-sdk`.

Frontend-style PR screenshots apply: copy the relevant PNGs from `app/screenshots/`
into `docs/pr-screenshots/<branch>/` with a README (see CLAUDE.md).

## Fanning out over the backlog

When asked to bring the Lab app to parity in bulk, split PARITY.md's ⬜ rows into
independent chunks by the files they own, one subagent (own worktree) per chunk.
Serialise anything touching `data/Db.kt` (schema version + migrations) or the
`Repository` sync loop — give those to one agent, or land them first. Each agent follows
this skill in full; review and merge them one at a time, re-running the verification.
