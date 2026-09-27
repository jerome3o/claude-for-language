# Lab app ↔ web app feature parity

The Lab app (`android-lab/`) aims for **full feature parity** with the web app, to the
same standard. This file is the checklist: every user-facing web feature has a row.
When a feature lands on either side, update its row in the same PR.
(How to implement one: `.claude/skills/native-parity/SKILL.md`.)

Status: ✅ done · 🟡 partial (say what's missing) · ⬜ not yet (the Lab app opens the
main app / website at that screen instead) · ➖ not applicable natively

## Study session (web: `useStudySession.ts`, `StudyPage.tsx`, `components/study/`)

| Feature | Status | Web source | Lab source |
|---|---|---|---|
| FSRS scheduling (event replay, live review, interval previews) | ✅ parity-tested | `shared/scheduler/compute-state.ts` | `core/…/Fsrs.kt`, `CardState.kt` |
| Global new-card budget, deck queue, per-deck caps | ✅ parity-tested | `shared/decks/budget.ts` | `core/…/Budget.kt` |
| Queue building (cutoff, due cards, tiers) & next-card pick | ✅ unit-tested | `db/database.ts` `getStudyQueue`, `useStudySession.ts` `selectNextItem` | `core/…/StudyQueue.kt` |
| Three card types (read / write / listen), flip, rating bar | ✅ | `StudyPage.tsx` | `ui/study/CardStage.kt` |
| Typed-answer check (punctuation, numbers, 两/二, alternatives) + diff | ✅ parity-tested | `utils/numberHanzi.ts`, `AnswerDiff` | `core/…/AnswerKey.kt` |
| Example sentences (clue row + set, tap-to-reveal, EN mode, show all) | ✅ | `components/SentenceSet.tsx` | `ui/study/Sentences.kt` |
| "Use in sentence" hint on the front | 🟡 shows/plays the stored clue; no on-demand generation | `StudyPage.tsx` | `CardStage.kt` |
| Undo last review (incl. server DELETE) | ✅ | `useStudySession.ts` undo | `StudyViewModel.undoLast` |
| Study 10 more | ✅ | `utils/bonusNewCards.ts` | `Prefs.bonus` |
| Exit confirm with recap, All Done + confetti | ✅ (+ sound, haptics) | `ExitSessionModal`, `SessionRecap`, `Confetti` | `StudyScreen.kt` |
| Audio: cached clip → stream → device voice | ✅ | `useAudio.ts`, `audioPlayback.ts` | `fx/WordAudio.kt` |
| Offline study + background upload | ✅ | `services/sync.ts` | `data/Repository.kt`, `SyncWorker.kt` |
| Voice recording on read cards + transcription + upload | ⬜ | `useTranscription.ts`, `pendingRecordings` | |
| Multiple-choice fallback (8 s) / auto-MC for listen cards | ⬜ | `services/multipleChoice.ts` | |
| Ask Claude (card chat with tools) | ⬜ (opens main app card hub) | `components/study/` Ask Claude | |
| Edit card | ⬜ | `CardEditModal.tsx` | |
| ⋯ menu: fun fact, regenerate audio, new voice, roleplay, flag for tutor | ⬜ | `components/study/`, `FlagCardSheet.tsx` | |
| Tutor notes on the card back (recording marks, flag replies) | ⬜ | `services/recording-notes.ts` | |
| Sentence tools: "What's going on here?", + Add as card, regenerate set | ⬜ | `SentenceSet.tsx` | |
| Tap a character → definition popup; pinyin under typed answer | ⬜ | `WordDefinitionPopup`, `pinyin-pro` | |
| Sentence set generated when rating Again | ⬜ | `ensureSentenceSetForNote` | |
| Custom mini lessons mixed into the session | ⬜ | `shared/lesson`, `lesson-exercises.tsx` | |
| Graded readers (one a day) | ⬜ | `services/reader-study.ts` | |
| First-card explainer | ⬜ | `FirstCardExplainer.tsx` | |

## Home, decks, progress

| Feature | Status | Web source |
|---|---|---|
| Study button with due counts and time estimate | ✅ | `pages/HomePage.tsx` |
| Deck queue list with per-deck due counts, study one deck | ✅ | `DecksPage.tsx` |
| Reorder deck queue (drag / move to top) | ⬜ | `services/dragReorder.ts` |
| Deck page: notes list, note history, play audio | ⬜ | `DeckDetailPage.tsx` |
| Card search | ⬜ | `services/noteSearch.ts` |
| Add / edit / delete notes; Paste a list; Generate with Claude | ⬜ | `components/import/`, `services/content` (API) |
| Deck settings, delete deck, starter deck | ⬜ | |
| Homework from tutor card, Next up line | ⬜ | `components/home/` |
| Homework due list on Home (one-off items with due labels: overdue / due today / due in N days) | ⬜ | `components/homework/HomeworkDueCard.tsx`, `services/homework.ts`, `shared/homework/due.ts` |
| One-off homework pass: word list (each word once, "Not yet" words again until right), lesson / reader once; events offline + uploaded (`/api/me/homework/events`); one-off lessons / readers kept out of the FSRS rotation; one-off decks capped out of the budget + "Add to my daily review" | ⬜ | `pages/HomeworkPassPage.tsx`, `pages/HomeworkPage.tsx`, `shared/homework/pass.ts`, docs/HOMEWORK.md |
| Progress (mastered, % per deck, daily counts) | ⬜ | Progress tab |
| Settings: study budget, start on, offline mode, audio quality | 🟡 sound/haptics toggles, resync, sign out only | `SettingsPage` |

## Everything else (opens the main app for now)

| Area | Status |
|---|---|
| Tutor tab: chat, flagged cards, Claude conversations, card hub | ⬜ |
| Students dashboard / tutor tools / session notes / library & editors | ⬜ |
| Tutor homework: Send homework as one-off / long-term / both with due date + split over days + leave out known words; load gauge; assigned-homework list (move date / cancel); lesson notes → draft → review with Claude → assign | ⬜ |
| Sentence Coach | ⬜ |
| Quests | ⬜ |
| Readers list & reader editor | ⬜ |
| Mini lessons list & editor | ⬜ |
| Video calls | ⬜ |
| Invites / onboarding / sign-up | ➖ (sign-in only; accounts are made on the web) |

## Native-shell features of the hybrid app

| Feature | Status | Hybrid source |
|---|---|---|
| Home-screen widget, launcher shortcuts | ⬜ | `native/android/…/ShortcutsWidgetProvider.java`, `shortcuts.xml` |
| Select text anywhere → Sentence Coach (`PROCESS_TEXT`) | ⬜ | `ProcessTextActivity.java` |
| Homework notifications with in-notification rating | ⬜ | `HomeworkWorker.java` … |

## Deliberate differences

- **"Introduced today" is derived from review events** (first-ever review of a card at or
  after local midnight; secondary if a sibling was reviewed first). The web keeps a live
  counter seeded the same way, but its seed compares a local date with UTC timestamps.
  Deriving it keeps devices consistent.
- **"Study 10 more" is keyed by the local date** (the web uses the UTC date).
- `YYYY-MM-DD HH:MM:SS` timestamps are parsed as UTC (V8 would read them as local time).
  No review event carries that shape; every client writes ISO strings.
