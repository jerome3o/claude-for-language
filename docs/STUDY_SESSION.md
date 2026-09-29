# Study Session Behavior

This document describes how study sessions work, including card selection priority, learning card handling, and session completion logic.

## Overview

Study sessions are **offline-first** - all card selection and review logic runs locally using IndexedDB. Reviews sync to the server in the background when online.

## Card Queues

Cards exist in one of four queues:

| Queue | Description | Typical Intervals |
|-------|-------------|-------------------|
| **NEW** | Never seen before | N/A (shown based on daily limit) |
| **LEARNING** | Recently introduced, being drilled | Minutes (1m, 5m, 10m) |
| **REVIEW** | Graduated, spaced repetition | Days to months |
| **RELEARNING** | Forgotten during review, re-drilling | Minutes |

## Card Selection Priority

During a study session, cards are selected in this order:

1. **Learning/Relearning cards due NOW** - These have active timers and take priority. Selected using weighted randomization (more overdue = higher weight).

2. **Mix of New + Review cards** - While learning cards are on cooldown, new and review cards are shown. Selection is proportional to queue sizes (e.g., if 3 new and 7 review cards, ~30% chance of new).

3. **Learning cards on cooldown (due today)** - When no other cards are available AND learning cards exist with cooldowns that haven't expired BUT are due today, show them immediately. This allows completing all study in one sitting.

## Today is the session

There are no study "sessions" any more — **today is the session**. The queue is always today's
(rebuilt from today's review events, see *What "due today" means* below), so leaving Study never
needs to end anything and there is no "End session?" confirm or recap:

- **✕ (and back) just leaves.** Nothing is lost: the card on screen — even revealed but not yet
  rated, with its typed answer, multiple-choice result or pronunciation recording — the undo, and
  the queue are all kept. Opening Study again (from Home, the widget, anywhere) **shows that same
  card first**, exactly as it was, while it is still due today (`resumeCardId` in
  `shared/study/resume.ts`: same local date, same deck scope, the card still in today's queue — a
  sync may have brought in its review from another device, or the day may have rolled over). The
  review's `time_spent_ms` carries on from the time already spent on the card; time away doesn't
  count.
- **Study ⇄ Sentence coach.** Card back → **⋯ → Sentence coach** opens the coach with the card's
  sentence (else its hanzi) in the box, not sent, cursor in it (`/coach?draft=…&focus=1`). The
  coach's back (web: **← Back to your card**) returns to the card as it was.
- Web: `services/studyResume.ts` keeps the resume point in localStorage (so a reload keeps the card,
  revealed state and answer) and the recording / multiple-choice grid / undo in memory (they survive
  in-app navigation, not a reload); `StudyCard` saves the point as it changes and when it unmounts;
  `useStudySession` shows the point's card first on its first load (`resume`). Lab: the study view
  model belongs to the activity (not the screen), so in-process everything survives — the take
  file, the undo, the queue — and `onReturn` rebuilds today's queue while keeping the card on
  screen; the point is also saved in SharedPreferences (`data/study/StudyDayStore.kt`) so a process
  death keeps the card, revealed state and answer.
- The server's session endpoints (`POST /api/study/sessions`…) are unchanged; the web still creates
  one best-effort so older app versions keep working, but nothing reads them for time.

### Today's queue runs dry

The "All done" screen appears when every queue is empty (the same rule as before):

- **All learning cards have graduated** - Their next review is tomorrow or later (moved to REVIEW queue with 1+ day interval)
- **AND no new/review cards remain** - Daily new card limit reached, all review cards done

It does NOT appear while learning cards are on cooldown but due today (they are shown at once),
while new cards remain within the daily limit, or while review cards are due today.

Where the session recap used to be, it shows **today's** numbers: *Today: 23 min · 142 reviews*
(active time over every device, `todayStudyLine`) and how many of today's reviews were Good/Easy.
**Study more** (+10 new cards) works as before.

**Celebration once a day.** Emptying today's queue is still celebrated — confetti, a fanfare,
haptics in the Lab app — but once per day: going back to Study later with nothing due shows a
quiet "All done for now". If more cards become due later that day (learning steps, homework, Study
more) and those are cleared too, that is a new finish and it is celebrated again. The rule is
`shouldCelebrate` in `shared/study/celebration.ts`: celebrate when the queue is empty, something was
reviewed today, and today's review count has grown since the last celebration (so Undo + the same
rating doesn't count twice). The mark lives in localStorage / SharedPreferences.

### Time: active study time, per day

Study time is how long you were actually studying — not how long a "session" was open.
`shared/study/activeTime.ts` (the Lab port `core/StudyDay.kt` is parity-tested):

- every interaction on the study screen — a tap, a key, a scroll, typing an answer, the screen
  coming back to the front — credits the time since the previous one, **but never more than 75 s**
  of it (`ACTIVE_IDLE_MS`): leave the phone on a card and the clock stops after 75 s;
- the study screen going to the background, the screen turning off, or leaving Study pauses it at
  once (web: `visibilitychange` / `pagehide` / blur and unmount in `hooks/useActiveStudyTime.ts`;
  Lab: `ON_PAUSE` and leaving the screen, touches observed on the whole screen);
- totals are kept per **local date** on each device (the interval after an interaction counts on
  the day it started) — web localStorage (`services/studyTime.ts`), Lab SharedPreferences;
- each device reports its own running per-day totals with `PUT /api/me/study-time`
  `{ device_id, days: [{ date, active_ms }] }` (migration 0083 `study_time_days`, one row per user,
  day and device, only ever raised — `MAX` — so re-sends are harmless), during sync (throttled to
  10 min) and when leaving Study; the answer is every device's total per day plus this device's
  share, so "Today: N min" = the other devices' time + this device's own, fresher, local number.

The tutor's "studied today" / streak, Insights and progress pages still read the review events
(`review_events.reviewed_at` / `time_spent_ms`), which are unchanged — the new daily totals are
additive, nothing that fed those was removed.

## Rating Effects

Each rating affects the card differently:

| Rating | Effect on NEW card | Effect on LEARNING card | Effect on REVIEW card |
|--------|-------------------|------------------------|----------------------|
| **Again** | → LEARNING (short interval) | Reset to step 1 | → RELEARNING (+1 lapse) |
| **Hard** | → LEARNING (short interval) | Repeat current step | Stay in REVIEW (shorter interval) |
| **Good** | → LEARNING (advances steps) | Advance step (may graduate) | Stay in REVIEW (normal interval) |
| **Easy** | → REVIEW (skips learning) | Graduate immediately | Stay in REVIEW (longer interval) |

## Learning Card Graduation

A learning card **graduates** to the REVIEW queue when:
- Rated **Easy** (immediate graduation)
- Rated **Good** enough times to complete all learning steps

Once graduated, the card's next review is typically 1+ days away, which ends its participation in the current session.

## Daily Limits

New cards come out of **one global daily budget** for the whole account (Settings → "New cards
a day"; `users.new_cards_per_day` / `secondary_cards_per_day`, default 3 + 6 from
`DEFAULT_STUDY_BUDGET` in `shared/decks/budget.ts`), filled from a **priority-ordered deck
queue** (`decks.study_priority`, highest first; ties by newest deck). A tutor's homework packet
lands at the top of the queue (core) or the bottom (non-urgent) depending on what she chose
when sending it; the student can move any deck (Decks tab → press and hold a deck and drag it, or tap the
#N badge → Move to top / up / down / bottom; Home → "↑ Top"), and the tutor can move a packet she sent from the same
badge on the student page (it moves the student's copy in the student's queue). The home page's *Next up* line says which deck is being
introduced, how many words are left in it and roughly how many days that takes at the current
rate.

- **New words per day** (blue, primary): cards of unseen notes, preferring the hanzi_to_meaning
  card so a brand-new word is introduced by its characters first. The budget is walked deck by
  deck in queue order: the first deck takes as many as it can, the next deck gets the rest.
- **Extra cards per day** (purple, secondary): additive to the primary budget. NEW cards whose
  note already has at least one reviewed card (e.g. meaning_to_hanzi after hanzi_to_meaning is in
  circulation), so the other card types of started words keep flowing even when brand-new words
  would fill the primary limit. Walked in the same queue order.
- **Per-deck limits are caps, not budgets**: a deck's own `new_cards_per_day` /
  `secondary_cards_per_day` (Deck → Settings) only limit how much of the global budget that deck
  may take in a day. A deck with the default 3 + 6 can never introduce more than 3 new words a
  day even if the global budget is 10; the remainder flows to the next deck in the queue.
- **Review cards**: No limit - all due reviews are shown
- **Learning cards**: No limit - always shown when due

The pure allocator is `allocateNewCards` in `shared/decks/budget.ts` (unit-tested): global
primary first, then global secondary, each walked in queue order and capped per deck; leftover
primary budget can admit secondary cards when no unseen notes remain. Studying one deck on its
own still charges what was already studied today in other decks against the global budget.

When the daily new card limit is reached, the "All Done!" screen offers a **"Study More"** button to add 10 bonus new cards.

### What "due today" means — one definition for both apps

`shared/decks/study-queue.ts` is the ONE definition of the study queue; the web app
(`getStudyQueue`, Home, the deck rows) and the Lab app (`core/StudyQueue.kt`, parity-tested
against it through `android-lab/parity/fixtures/study-queue.ts`) both use it:

- learning / relearning cards due by the cutoff (the later of local 23:59:59.999 and now + 1 h),
- review cards due by the cutoff,
- the new cards the budget allocates (above).

Home's numbers are the counts of exactly that queue — a learning card due tomorrow is not
"due today" on any screen. **Introduced today** (what the budget has already spent) is derived
from review events: a card counts on the day of its first-ever review (local midnight, not the
UTC date), secondary when a sibling of the same note was reviewed before it. There is no
counter any more — the old `dailyStats` counter drifted.

**Card state is the replay of the card's events, always.** A rating stores the event and the
card row becomes `computeCardState(all its events)` (`recomputeCardFromEvents`); cards a sync
inserts as NEW are replayed when their events are already on the device
(`recomputeCardsWithEvents`); and after a background sync `repairCardStatesIfDue` re-derives
every row once per repair version and then daily (`repairCardStatesFromEvents`, one transaction).
The 27 Sep 2026 debug report found the web holding 49 cards with events at NEW and ~765 review
cards whose due date had drifted whole days later than the replay (the old incremental
`scheduleCard` update) — the web showed 0 due while the Lab app showed 37.

## Graded readers: one a day

Graded readers close out an all-decks session (after the cards and any mini lessons), and
there is **one reader a day** (`READERS_PER_DAY` in `frontend/src/services/reader-study.ts`):

- `pickTodaysReader` chooses the day's story: a learning repeat due by the study cutoff first,
  then the most overdue review, then the newest unread story. Only that one enters the
  session; other due readers wait for later days, so a missed week never piles stories up.
- Once a reader has been read today (a `readerReviewEvents` row on today's local date) nothing
  else is offered until tomorrow. The only exception is that same story coming back as an
  Again repeat inside the session.
- `ensureDailyReader` (study start + background sync) generates a new story **only when
  nothing is due today** — no unread story, no review or learning repeat due, none read yet.
  A due review *is* the day's reader, so no new story is written that day.

The reader's blue **page-progress bar** is held at the top, right under the study top bar
(web `.study-reader-progress` in `StudyReader.tsx`, Lab `PinnedReaderProgress` in
`ui/readers/ReaderScreens.kt`): it sits outside the scrolling page, so the illustration, Chinese,
audio, pinyin and translation scroll beneath it and never under it; a hairline appears once the
page has scrolled. The standalone reading view (`/readers/:id`) already kept it above its scroll area.

### Page audio: phrase blocks and a restart point that follows the audio

Each reader page's narration is a waveform scrubber (web `components/ReaderAudioScrubber.tsx`,
Lab `ui/readers/ReaderScrubber.kt`) split into **phrase blocks at the pauses**:

- **Finding blocks** (`shared/reader/audioBlocks.ts`, Lab `core/AudioBlocks.kt`, parity-tested):
  the clip is decoded on the device (WebAudio / MediaCodec) into a 10 ms RMS envelope; the quiet
  threshold adapts to the clip (noise floor + 10% of the way to the speech level, kept 15–45 dB
  under speech); an interior quiet run of ≥ 350 ms is a pause (leading / trailing silence never
  splits; blips of ≤ 2 loud frames are bridged); the boundary sits 150 ms before the next phrase
  (never before the pause's middle); blocks under 0.8 s merge into the shorter neighbour, blocks
  over 7 s split at their longest ≥ 150 ms dip. Tuned on real MiniMax clips (pauses at commas /
  full stops 0.6–1.6 s, gaps between words 0.1–0.3 s; envelopes in
  `shared/reader/__fixtures__/tts-envelopes.json`). Peaks + blocks are cached per clip
  (IndexedDB `readerAudioBlocks`, Dexie v23; Lab JsonCache `readers/audio-blocks/…`), so they
  show instantly and offline; a regenerated clip (different size) or a new `AUDIO_BLOCKS_VERSION`
  re-analyses.
- **The restart point** (`shared/reader/blockPlayback.ts`, Lab `core/BlockPlayback.kt`,
  parity-tested): play starts from the anchor; when a block finishes the anchor advances to the
  start of the block now playing; stop → play again restarts **the block he was in** — unless he
  stopped within **1 s** of crossing into a new block, then the **previous** block (he missed it).
  A drag places a free anchor, which wins until playback moves past its block (and the 1 s grace
  returns to it). When the clip ends the anchor is the last block.
- **UI**: boundaries as small ticks on the waveform, the current block highlighted; **tap** a
  block = jump there (it becomes the restart point); **⏮ / ⏭** (under the play button, the thumb
  side) step blocks — ⏮ restarts the current block when more than 1 s into it, else goes back one.
- **Fallback**: undecodable clip or no pause found → one block, exactly the old scrubber (tap or
  drag places the anchor, stop returns to it, no ⏮ / ⏭ row). Sentence highlighting in the text
  is not done (the reader shows the Chinese hidden until tapped).

## Example Session Flow

```
Start session with:
- 5 new cards (within daily limit)
- 3 review cards due
- 0 learning cards

1. Show mix of new/review cards
   User rates a new card "Good" → goes to LEARNING (due in 10 min)

2. Continue showing new/review cards
   Learning card's 10 min cooldown expires → show it (priority)

3. User rates learning card "Good" → due in 1 day (graduates to REVIEW)

4. Continue until all new/review done, learning cards graduated

5. "All done" screen appears (celebrated the first time today's queue is emptied)
```

## Edge Cases

### All cards are learning cards on cooldown
If the only remaining cards are learning cards with cooldowns (e.g., all due in 5 minutes), they are shown immediately rather than making the user wait. The user can keep drilling until they graduate.

### Single learning card remaining
The same card is shown immediately and repeatedly, even if just rated, until it graduates. No cooldown wait screen — the user prefers to drill continuously in one sitting. Each rating updates the card's state, causing the UI to reset for a fresh review.

### Offline behavior
All session logic works offline. Reviews are stored locally and synced when connectivity returns. The "Ask Claude" feature gracefully fails when offline.

## Card back layout

The back of a card is: hanzi · pinyin · (tutor note) · meaning · **Play** · **Record
again** · the **example sentences**, always visible (the card's own sentence first, then
the generated set — `components/SentenceSet.tsx` in `compact` mode). The list scrolls
inside the card; the footer stays put: one action row **Ask Claude · Edit card · ⋯**
(`components/study/StudyActionRow.tsx`) above the four ratings (64px tall). Everything
else is under **⋯** (a bottom sheet, `components/study/StudyMoreMenu.tsx`): generate fun
fact, regenerate audio, new voice, roleplay, **flag for tutor** (below), play my recording,
debug info (only with the Debug Console flag on) and the "Added <date>" line.

Sentence rows start blank (listen first): **▶** on the right plays the clip, each tap on
the row uncovers one more line — hanzi, pinyin, English — and a tap on a fully open row
hides it again. **EN** on the left flips the row to English-first (the translation is the
prompt; the taps then uncover hanzi and pinyin). A fully open row carries the tools line:
the word-by-word breakdown and *+ Add as card*. **Show all** in the list header opens
every row for the current card only; the next card starts blank again.

On the unfolded Fold (≥ 700px) the whole card column is capped at 640px and centred.

**Peek at the question.** On a revealed card, a tap on the card's empty space turns it back
to the question side (with a quiet "Tap to see the answer"), and a tap on the question turns
it to the answer again. It is view only: nothing is re-checked, re-played, re-transcribed or
recorded, the typed / multiple-choice answer and the recording are kept, the timer keeps
running, and the action row and ratings stay up (you can rate from either side). Anything
with its own tap never peeks — buttons, links, tappable characters, the answer diff, the
explanation, tutor notes, sentence rows, popups — and neither does a drag / scroll, a long
press or finishing a text selection. The answer side keeps its scroll position and opened
sentence rows through the round trip. An unrevealed card's front is unchanged (the web card
has no front tap; the Lab app's read card reveals on a front tap as before). Web:
`components/study/peekFlip.ts` (`isPeekTap`, unit-tested) + `peeking` in `StudyPage.tsx`;
Lab: `peek` / `keepTaps` in `ui/study/CardStage.kt` (`PeekFlipTest`).

## Offline mode

Study is offline whenever **NetworkContext** says the browser is offline (automatic) or the
learner has **forced** it from the top-bar pill (for a train connection that is nominally
"online" but stalls). `resolveOfflineMode` in `services/offlineMode.ts` combines the two;
the pill shows the resolved state ("Auto · online" / "Auto · offline" / "Forced offline",
shortened on phones) and a tap cycles auto → forced → auto. When offline:

- audio plays from the IndexedDB cache or the device voice, and the card says so in one line
  when this word's clip was never downloaded;
- every AI button (Ask Claude, generate sentences/fun fact/audio, new voice, roleplay,
  multiple choice) is disabled with a "Needs internet" title. Cached sentences and cached
  multiple-choice options still work.

## Multiple choice

Options come from the note's cached `multiple_choice_options`; otherwise a generation request
that times out after 8 seconds (`services/multipleChoice.ts`). On timeout, error or offline
the card falls back to typing with a one-line note. The mode is per card — it never sticks to
the next one — and nothing is pre-loaded while offline.

**One tap, partial answers allowed.** The grid's button flips the card straight to the answer
side — there is no separate check / continue step — and it never waits for every row. With
nothing picked it reads **Show answer** (give up and move on: the review has no `user_answer`,
exactly like an empty typed card); once anything is picked it reads **Submit** and the review's
`user_answer` is the picks in row order, unselected rows skipped (`mcSubmittedAnswer`).
Pre-selected rows (punctuation, English text) are not a pick on their own. A fully right answer
shows as one green row like a typed one; anything else is shown row by row (`mcAnswerSlots`):
each pick green or red, a skipped row as a "?", "N of M left blank", and the answer below
with the missed rows marked. The Lab app follows the same rule (`MultipleChoice.kt`, `McGrid.kt`).

**Long answers always fit.** A whole sentence can be a dozen rows (one per character). The
prompt (English / ▶) stays on screen, the rows scroll in the space left, and the **Submit / Show
answer** row (with Type instead / Regenerate) is pinned under them, so a card can always be
finished whatever its length (web: `.study-card-content--mc` / `.mc-rows` / `.mc-footer` in
`StudyPage.css`; Lab: `CardStage` keeps ~26% of the height for the question — a compact,
scrollable front — and `McGrid` scrolls its rows above the pinned button). A pick scrolls the
next unanswered row into view (`nextUnansweredRow`). Past `MC_COMPACT_AFTER_ROWS` (6) rows to
pick the grid goes compact — smaller tiles and gaps, still ≥ 44 px / 48 dp touch targets — and
punctuation rows are a slim given line. **When MC is offered doesn't depend on length**: the
rules stay "listen cards and pinyin-only meaning cards auto, any typing card on request",
because a pinyin-only note has no other way to be answered; long answers are made usable
instead of taken away.

**Options are characters only.** `shared/cards/multipleChoice.ts` (`isHanziOption`,
`sanitizeMcRow`): a distractor is Chinese characters only, as many as the answer character —
never a pinyin syllable ("xi" for 习, which the model once offered as a "sound-alike"), a latin
letter, digit or punctuation. The worker filters what it stores (and its prompt says so), and
both apps clean every row when they read cached options (`parseMcOptions`, Lab
`MultipleChoice.parse` → `core/McOptions.kt`, parity-tested by `parity/fixtures/multiple-choice.ts`),
so notes generated before the fix are clean on the device too.

**Marks that read without colour.** On the answer side of a typed or multiple-choice answer,
every wrong character (or extra one past the end) is red AND has a solid underline; a character
not typed / a row left blank is a muted "?" with a dashed underline; correct characters stay green
with no underline (`utils/answerDiff.ts` `typedAnswerDiff`, `DiffCellView` in StudyPage; Lab:
`ui/study/AnswerMarks.kt`). The underline sits in the character's own bottom padding, so it never
touches the glyph or the pinyin line below.

## Tutor notes on recordings

When a tutor marks one of the student's recordings *needs work* with a comment, the student
sees "From <tutor>: <comment>" under the pinyin the next time that card comes up, once. The
unseen notes are pulled into IndexedDB (`recordingNotes`) during sync
(`services/recording-notes.ts`, `GET /api/me/recording-notes`); rating the card marks the note
seen locally first and `POST /api/me/recording-notes/:eventId/seen` follows, immediately or on
the next sync.

**Notes from your tutor** (`/tutor-notes`, web `pages/TutorNotesPage.tsx`, Lab
`ui/study/TutorNotesScreen.kt`; Home shows "🗒 3 new notes from <tutor>" while any is unseen, and
More → From your tutor → Tutor notes): every note — recording comments and flag replies — new
first, then earlier ones, each with the card (hanzi, pinyin, meaning), the comment, the date,
▶ the student's recording and "You asked: …" for a flag. Offline from the device: the unseen feed
decides what is NEW and `GET /api/me/tutor-notes?include_seen=1` (cached by each sync, IndexedDB
`tutorNotes` / the Lab JSON cache) supplies the earlier ones (`mergeTutorNotes`,
`shared/tutor-notes/notes.ts`). Opening the page marks the new ones seen with the same `/seen`
endpoint, so the card back won't repeat them (they stay under "New" while the page is open).
**Practice this card / Practice all** opens `/tutor-notes/practice?cards=…&notes=…`: those cards in
the normal study card UI as a focused mini session, the tutor's note pinned on the back. The FSRS
rule (`practiceRatingCounts`, `shared/tutor-notes/practice.ts`, the Lab's `TutorNotesRules`,
parity-tested): **a rating is a real review only when the card is due today** (the session's own
`isDueByCutoff`); a card not due, or still NEW, is **practice only — no review event is written**
and its schedule and the new-card budget are untouched (same principle as the homework pass,
docs/HOMEWORK.md decision 1). A quiet line under the top bar says which. Again sends the card round
again; the end screen counts "N counted as reviews · M practice only". **Open card ›** goes to the
card hub.

## Flag a card for the tutor

**⋯ → Flag for tutor** (`components/study/FlagCardSheet.tsx`; the item only appears when the
account has a human tutor) opens a sheet: one short note ("is 行 here háng or xíng?"), a
tutor picker when there is more than one, Send. It works offline: the flag is written to
IndexedDB first (`pendingCardFlags`, `services/cardFlags.ts` `queueCardFlag`), posted at once
when online, otherwise by the next sync (`uploadPendingCardFlags`); the id is client-generated
so a re-post is a no-op. The tutor list is mirrored to localStorage so the item is still there
without a connection. On the server (`POST /api/card-flags`, `card_flags` table) the flag is
also mirrored into the relationship's chat ("🚩 Flagged 银行 (yínháng · bank): …") so the tutor's
unread badge fires, and it appears under **Flagged cards** on the tutor's student page with a
link to the card's hub page (`/connections/:relId/cards/:noteId`).

The tutor's **reply** resolves the flag, goes into the chat ("🚩 About 银行: …") and rides the
same `GET /api/me/recording-notes` feed as recording marks with `kind: 'flag'`, so the student
sees "<tutor> replied to your flag: …" under the pinyin the next time ANY card of that word
comes up (matched on note_id, not card_id), once; rating the card marks it seen through the
same `/seen` endpoint. The student's own flags (status, reply) are under **Cards you flagged**
on their tutor page and on the card's hub page (`/cards/:noteId`), which can also send a flag.
