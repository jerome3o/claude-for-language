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

0. **Bumped cards ("⚡ Study it today")** - cards from the bump pocket (below) come first, in pocket order. The recent-notes filter still applies, so a bumped word's sibling cards are spaced out by a few other notes.

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
  count. ✕ goes **back** to the screen Study was opened from (web: history back, or Home replacing
  Study when it was opened straight from a link). There is only ever **one Study**: opening it
  again (the widget, a reminder) brings the open one back instead of stacking another, and a
  study reminder / the widget leaves a homework pass, reader, lesson, picture hunt or quest in
  progress on screen (Lab `ui/nav/NavResume.kt`, web `components/nav/nativeRoute.ts`). The Lab
  app also reopens where you were after its process died (up to 6 h; then the normal landing).
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
when sending it; the student can move any deck (More → Decks → press and hold a deck and drag it, or tap the
#N badge → Move to top / up / down / bottom; Home → "↑ Top"), and the tutor can move a packet she sent from the same
badge on the student page (it moves the student's copy in the student's queue). The home page's *Next up* line says which deck is being
introduced, how many words are left in it and roughly how many days that takes at the current
rate.

- **New words per day** (blue, primary): cards of unseen notes, preferring the hanzi_to_meaning
  card so a brand-new word is introduced by its characters first. WHICH unseen words come is the
  account's **"Order new cards by"** (below); after its tiers the budget is walked deck by deck in
  queue order: the first deck takes as many as it can, the next deck gets the rest.

  **Order new cards by** (Settings → New cards, Oct 2026; `shared/decks/new-card-order.ts`, Lab
  `core/…/NewCardOrder.kt`, parity-tested by `parity/fixtures/new-card-order.ts` and the
  `ordered` study-queue vectors). Jerome: "I'm getting a bunch of sentences in my flashcards that
  are probably not the highest leverage thing to learn right now." Four switches, all on by
  default, one choice per account (`users.new_card_order`, `PUT /api/profile/new-card-order`,
  on `/api/auth/me` and `/api/sync/changes`, cached on the device so study follows it offline).
  Applied as tiers across ALL decks in scope (each deck still gives at most min(its unseen cards,
  what is left of its cap)), before the deck order decides:
  1. **New characters first** — unseen notes that bring at least one never-seen Han character.
     "Seen" = the Han characters in the hanzi of every note with a card past NEW (any deck; the
     example sentence doesn't count). With **Most common first** on (the default) the tier is
     ordered by how common the note's most common NEVER-SEEN character is in everyday Chinese
     (its character rank in the shipped list; a character missing from the list ranks last), so
     the most useful new characters come first — a common new character in a lower deck beats a
     rare one in the top deck. Ties: more never-seen characters first (counted up to 2), then the
     word's frequency, then the deck queue position, fewer characters, card id. Greedy: after each
     pick its characters count as seen, so the rest are re-ranked by the characters still new (two
     picks never introduce only the same character). Off (or no list): ranked by never-seen
     characters, counted up to 2 — a long sentence with five new characters doesn't beat a word
     with two.
  2. **New words first** — WORD notes (1–4 Han characters, no sentence punctuation: the Progress
     page's `noteKind`) whose text appears in no studied note's hanzi, sentences included: 银行 is
     new even when 银 and 行 are both known; a word already met inside a studied sentence (工作 in
     我在银行工作。) is not. The index is every 2–4 character piece inside a run of Han characters
     of every studied note (`StudiedIndex`), so a check is one Set lookup.
  3. **Most common first** — not a tier: inside each tier the most common word first (in tier 1,
     first the most common new character, above), and in the
     deck fallback inside each deck (deck order still first there). Frequency = rank in
     `shared/data/frequency/word-freq.txt` (wordfreq `large_zh`, data CC BY-SA 4.0 — the same
     source as the character sheet; 30,000 words + 8,000 characters, ~150 kB gzipped; rebuilt by
     `npm run build:word-freq`). A note whose Han text isn't a listed word (a rarer word, 不客气,
     any sentence) ranks after every listed word, by its rarest character. The web loads the list
     as a lazily imported chunk the service worker precaches; the Lab app reads the same file as a
     core resource — no network during study. Without the list the switch simply does nothing.
  4. **Sentences last** — inside tier 1 words before sentences, and after the tiers every word
     note (all decks, deck queue order, the most common first inside a deck) before any sentence.
  5. Then the deck order, deck by deck as before (`respreadPrimary` in `budget.ts` keeps the total
     of blue cards; `orderWithinDeck` puts words before sentences / the most common first inside a deck).

  Picks are greedy: each pick's characters and word pieces count as studied for the next one,
  across decks too, so two notes sharing one new character aren't both introduced the same day,
  and a picked sentence makes the words inside it "met". Ties: the deck's queue position, fewer Han
  characters, card id. Every switch off = the plain deck-by-deck order. Unchanged by the setting:
  ⚡ bumps (first, outside the budget), per-deck caps, one-off decks (0 + 0), opted-out words
  (`long_term = 0`), the purple pool and one-off homework passes (their own queue). Home's numbers,
  the per-deck rows (`countRawQueues` → `noveltyPicks` → `allocateQueueCounts`), *Next up* and the
  debug report (which also records the order, compared by `compareDebugReports`) all go through
  the same `selectStudyQueue` / picks; totals and Next up (deck queue + words to go) don't change,
  only which words. Cost: a heap with lazy re-checks (a candidate's place only ever gets worse), so
  ~10 ms on top of the queue for a 10k-note account in Node (~20 ms in the Lab's JVM test).
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

## "⚡ Study it today" — the bump pocket

Jerome often tries to add a card he already has (Coach → Explain → add → "already in this deck").
Every place that finds the word already exists now offers **⚡ Study it today** first (Add anyway
second): the note goes into a per-account pocket (`study_bumps`) and its cards come FIRST in
today's session. One rule, `shared/decks/bumps.ts` (Lab `Bumps.kt`, parity-tested):

- **Which cards** — of the note's cards not reviewed since the bump: every NEW card, every card
  already due by the cutoff, plus ONE early review: the most important card that isn't due yet
  (hanzi_to_meaning → meaning_to_hanzi → audio_to_hanzi), unless a due card is already in or a card
  that was in circulation before the bump has been reviewed since. At most 3 per note.
- **New cards over the budget** — bumped NEW cards are taken out of the deck pools, so they're
  introduced today even when the daily new-card budget is spent and never take a slot from the deck
  queue. Once reviewed they count toward introduced-today (derived from events, as always), which is
  what the budget already spent today reads.
- **Early reviews** — a review card not due yet is shown today; ts-fsrs computes the elapsed time
  from the last review, so the rating schedules it properly (a "Good" on an early card grows the
  interval less than an on-time one).
- **Done** — a bump is done once each bumped card has been reviewed since the bump (a reviewed NEW
  card becomes a learning card and stays in today's queue the normal way). Unfinished bumps carry over
  to the next day; ⚡ Today ✓ → tap to take it out (deck page, card hub).
- **Where it shows** — the card carries a small "⚡ Today" badge ("⚡ from Minghui" when the tutor
  bumped it), Home says "⚡ N bumped for today" under the Study button and in the ⓘ breakdown, and the
  counts include the pocket's cards.
- **Offline** — bumps are written to IndexedDB (`studyBumps`) / Room at once and uploaded with a client
  id (`POST /api/me/bumps`, idempotent); `/api/sync/changes` brings the whole pocket back. The server
  marks finished bumps `done_at` lazily with the same rule.
- **The Coach's chip** (`shared/decks/sentence-bumps.ts`) never bumps a pile of words in one tap:
  when the whole sentence (spaces / punctuation ignored) is one of his cards the chip is **⚡ Study this
  today** and bumps only that note; otherwise, when some of its words are cards, **⚡ Study words from
  this today…** opens "You already have these words" — one row per matched note (hanzi · pinyin ·
  meaning), longest first, single characters last (left out when they only appear inside a longer
  matched word), NOTHING ticked, rows already bumped shown with ⚡ and disabled, a pinned **⚡ Add N to
  today** + Cancel. No match → no chip. The bump is `study.bump_added` with `source: 'coach'` + `count`.
- **Claude** — Ask Claude, the coach chat and chat Discuss have a `bump_cards` tool and are told to
  bump instead of making a duplicate — always an explicit list of the words the learner named, never
  every word of a sentence; the MCP server has `bump_cards`, `list_bumped_cards`,
  `clear_bumped_card` and the tutor's `bump_student_cards`.

## Mini lessons: "revisit later", not FSRS

Mini lessons are big chunks, not flashcards: FSRS's short learning steps brought a Hard / Good
one back within minutes or a day. They follow one simple schedule (`shared/study/revisit.ts`;
Lab `core/…/Revisit.kt`, parity-tested). (Graded readers were on it too until Oct 2026 — now a
story is read once, see "Graded readers" below.)

| After finishing | Next visit |
|---|---|
| Again | 1 day (and the gap resets) |
| Hard | 2 days, then ×1.2 each later visit |
| Good | 14 days, then ×2 each later visit |
| Easy | 42 days (~6 weeks), then ×2 |

Next gap = max(the rating's base gap, previous gap × growth), capped at 180 days. Nothing comes
back the same day — even Again is tomorrow. **✓ Done for good** under the rating buttons records
the finish (as Good) and retires the lesson: never scheduled again, still listed on the Mini
Lessons page under "Done for good", where **↩ Bring back** puts it back in rotation
(due at once, the gap it had is kept).

- **Event-sourced**: the schedule is replayed from the history — the completion events (their
  ratings; a legacy completion with no rating = Good) plus `revisitEvents` (retire / restore; D1
  `revisit_events`, migration 0110, `POST /api/me/revisit-events` idempotent by id, the whole list on
  `/api/sync/changes` as `revisit_events`; old `reader` rows are ignored). The lesson row caches the
  result (`queue` NEW / REVIEW, `next_review_at`, `due_timestamp`, `interval` = gap, `retired`),
  recomputed after every finish, sync and settings change (`services/revisit.ts`).
- **New lessons are paced per local DAY**: at most **"New lessons a day"** (default **1**) NEW
  lessons join the study session per day, oldest first (`pickNewLessonsForToday`), counted from the
  completion events like cards' introduced-today — a lesson whose FIRST finish is at/after local
  midnight (`newLessonsIntroducedToday`). So a batch of 12 "China trip" lessons arrives one a day,
  whether in one session or across several. Revisits never count against it (they have their own
  pacing below).
- **Today's lessons are ONE rule** — `pickTodaysLessons` (`shared/study/revisit.ts`; Lab
  `LessonSchedule.todaysLessons`, parity-tested): the web session (`getDueCustomLessons`), and in the
  Lab the session, Home's "Today" row and `/today/lessons` all read it, so Study and Today can't
  disagree about what's left. Due revisits first (capped), then:
  - **homework comes on top of the daily place.** A lesson the tutor sent with a pass (`both`; a
    `one_off`-only one is never in the rotation) is offered while NEW without taking the place, and
    finishing it — in its pass or anywhere — doesn't use the place up (`homeworkPassTargets`,
    `shared/homework/items.ts`). Oct 2026: Jerome finished his tutor's lesson in its homework pass;
    that used up the one place, so Today said "All done" while Study (which still had China trip 1
    on screen) kept opening China trip 1;
  - **a lesson opened today keeps its place** until it's finished, whatever else is finished
    meanwhile (`startedToday`: web `services/lessonsStarted.ts` in localStorage, Lab
    `LessonProgressStore.markStarted` — set when a real run opens, previews never).
- **Closing never completes.** ✕ / back / leaving Study / leaving a homework pass record nothing —
  only the rating (or ✓ Done for good) writes the completion event, the attempt and the homework
  `done`. Checked against production on 8 Oct: every completion carries a rating and an attempt with
  a real duration. Coming back to a lesson continues it: the Lab restores a half-done run
  ("Continuing where you left off · 3 of 4"), and a lesson opened earlier today and left on its first
  exercise says "Back to today's lesson · 1 of 6" (`LessonResume.reopenedLine`). If the lesson on
  screen in Study was finished elsewhere meanwhile, Study moves on (`StudyExtras.stillToDo`).
- **▶ Do it again** (`/lessons/:id/play?from=`, web `pages/LessonReplayPage.tsx`, Lab
  `ui/lessons/LessonReplay.kt`; immersive): every lesson on the Mini Lessons page has **▶ Start**
  (new) / **▶ Do it again**, as do a finished homework lesson pass and (Lab) the "Done today" rows of
  `/today/lessons`. The real player; the rule is `/tutor-notes/practice`'s, for lessons
  (`replayIsPractice`): a lesson **due today** (new, or due by the cutoff) replays as a normal run —
  the rating records the completion (attempt for the tutor, "revisit later" pacing, homework done);
  a lesson **not due** (coming back later, or Done for good) gets the same ratings plus **Practice
  only** ("Nothing is recorded · it comes back when it was going to"). Rating it anyway is a normal
  completion, re-scheduled from now. Analytics `lesson.replay { from, practice }`,
  `lesson.replay_practice`, `lesson.complete { source: 'replay' }`.
- **Settings → "Lessons & readers"**: New lessons a day (0–20), the Hard / Good / Easy gaps (days),
  growth and longest gap, Reset to defaults — `users.revisit_settings` (JSON, NULL = defaults),
  `PUT /api/profile/revisit-settings` (validated by `pickRevisitSettingsUpdate`: days 1–365 whole,
  growth 1–5, cap 1–3650, `new_lessons_per_day` 0–20 whole, Hard ≤ Good ≤ Easy; 400 + `problems`),
  on `/api/auth/me` and `/api/sync/changes` as `revisit_settings`, mirrored in localStorage (Lab:
  JsonCache) for offline study. `settings.revisit_changed { fields, reset, new_lessons_per_day }`.
- **No flood**: an overdue backlog trickles back — revisits are capped at
  `MAX_LESSON_REVISITS_PER_DAY` (2, most overdue first; finished revisits today count).
- **The tutor** sees "next revisit 20 Oct" / "done for good" on the student's lessons and the
  library item's assignments (`next_revisit_at`, `retired` from the student's own gaps); a shared
  reader shows "not read yet" / "read 3 Oct".
- One-off homework passes are unchanged (not scheduled); a lesson finished in a pass records the
  same rated event, and "Done for good" is offered there too.

## Graded readers: read once, one a day, listen-first

Graded readers close out an all-decks session (after the cards and any mini lessons). A story is
**read ONCE and never repeated** (`shared/study/daily-reader.ts`; Lab `core/…/DailyReader.kt`,
parity-tested by `parity/fixtures/daily-reader.ts`):

- **Read** = the reader has a reader-review event. After the last page the rating row is gone:
  **Finish ✓** (or listening to the end, below) writes the event (stored with rating Good —
  `reader_review_events` keeps its column) and the story never comes back. Old reads stay on the
  Readers list ("✓ Read 3 Oct") and open by hand there. No reader scheduling, no Done for good /
  Bring back for readers, nothing about readers in Settings.
- **One a day** (`READERS_PER_DAY`): `pickTodaysReader` offers nothing once a story was read today
  (one-off homework readers don't count and are never offered — they're read in the homework pass),
  else the **newest unread** story (ties by id). So an unread daily reader is offered again, day
  after day, until it is read.
- **Generation** (`ensureDailyReader`, study start + background sync; `shouldGenerateDailyReader`):
  a new story is asked for only when **no unread story is waiting** (the previous daily reader was
  read, or none exists), nothing was read today, and at most once per local day (the
  `daily-reader-attempt` date in localStorage / Lab `readers/daily-attempt`). The server keeps one
  `daily_readers` row per local date as before.
- **Listen-first**: every page's narration of the next unread story is generated and cached on the
  device as soon as the story exists — `prefetchReaderMedia` → `cacheReaderNarration` after each
  sync (and when the daily reader lands), the reader view fetches any page still missing when it
  opens; TTS goes through `/api/practice/tts`'s stored provider order (MiniMax → Azure), cached by
  `readerTtsKey`, so the whole story plays offline. Lab: `ReaderStore.prefetchMedia` /
  `cacheNarration`.
- **▶ Play whole story** (a small round ▶ at the start of the "📖 Graded Reader" row, the label kept centred; named "Play the rest" after page 1, ■ "Stop the story" while playing): plays each page's
  narration, waits a beat (`storyPageGapMs` — 600 ms, longer at slower speeds), turns to the next
  page and plays it, at the speed chip's speed (1× / 0.75× / 0.5×, pitch kept). A manual page turn
  carries on from the new page; **■ Stop the story** (or the page's own stop) stops it; a page with no
  audio on the device stops it with a note. Reaching the end of the last page counts as finishing
  (`reader.finish { how: 'listened' }`). The phrase-block scrubber works as before on every page.
  Web: `StudyReader.tsx` + `ReaderAudioScrubber` (`autoPlay`, `onPlaybackEnded`, `onStopped`,
  `onUnavailable`); Lab: `StudyReaderView` + `ReaderScrubber(story = StoryPlayback(…))`. Analytics:
  `reader.story_play { from_page, pages, speed, offline }`, `reader.story_stop { page, pages }`.
- Readers a tutor sends as **one-off homework** are unchanged: read once in the homework pass, with
  the same Finish.

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
- **Speed** (`shared/reader/speed.ts`, Lab `core/ReaderSpeed.kt`, parity-tested): one chip —
  left of the ⏮ / ⏭ row, and under 🔊 on the reading page — cycles **1× → 0.75× → 0.5×**,
  remembered per device (web localStorage `reader-playback-speed`, Lab prefs `lab-reader`) and
  shared live by every reader view (page narration and a word's ▶ in the word sheet; card study
  audio is untouched). Applied at **playback only**, the clip is never regenerated, and the pitch
  is kept: web = `playbackRate` + `preservesPitch` (and the webkit / moz flags) on the element
  (`applyPlaybackRate` / `AudioPlayer.setRate` in `utils/audioPlayback.ts`); the Android hybrid
  app's bridge v3 `setRate(id, speed)` = MediaPlayer `PlaybackParams.setSpeed(x).setPitch(1)`
  (an older v2 app plays a slowed clip through the element instead); Lab = the same
  `PlaybackParams` (`data/readers/ReaderPlaybackSpeed.kt`). A change while playing applies live,
  no restart. Blocks and positions stay in **media time**; the 1 s grace (pause → previous block,
  ⏮ → restart this block) is a **wall-clock** reaction, so it is scaled to media time:
  `blockGraceMsAt(speed)` = 1000 × speed (500 ms of clip at 0.5×). `reader.speed_changed { speed }`.

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

**Only the buttons reveal.** On an unanswered card the face is inert: a tap on the word, the
English, the audio card or empty space, a swipe or a long press does nothing — the answer
comes up only through the controls at the bottom (Show answer / Record / Check answer on a read
card, Check / Show on a typing card, the multiple-choice button). The same holds for the
homework pass card: only **Show answer** turns it. Buttons on the face keep their own taps
(▶, Use in a sentence, Multiple choice). There is no "tap to reveal" hint on an unanswered
card; "Tap to see the answer" only appears on the question while peeking (below). Web: the
card click handler returns early while unrevealed (`handleCardClick` in `StudyPage.tsx`), the
pass card has no click handler (`HomeworkPassPage.tsx`); e2e `study-peek.spec.ts`,
`homework-pass-sentences.spec.ts`. Lab: `CardFront` in `ui/study/CardStage.kt` is clickable
only once revealed, `PassFront` in `ui/homework/HomeworkScreens.kt` has no tap
(`PeekFlipTest`, `PassSentencesTest`).

**Peek at the question.** On a revealed card, a tap on the card's empty space turns it back
to the question side (with a quiet "Tap to see the answer"), and a tap on the question turns
it to the answer again. It is view only: nothing is re-checked, re-played, re-transcribed or
recorded, the typed / multiple-choice answer and the recording are kept, the timer keeps
running, and the action row and ratings stay up (you can rate from either side). Anything
with its own tap never peeks — buttons, links, tappable characters, the answer diff, the
explanation, tutor notes, sentence rows, popups — and neither does a drag / scroll, a long
press or finishing a text selection. The answer side keeps its scroll position and opened
sentence rows through the round trip. An unrevealed card's front never peeks or reveals
(see above). Web:
`components/study/peekFlip.ts` (`isPeekTap`, unit-tested) + `peeking` in `StudyPage.tsx`;
Lab: `peek` / `keepTaps` in `ui/study/CardStage.kt` (`PeekFlipTest`).

**Record again reads from the question.** On the answer side of a read card, **🎤 Record again**
turns the card back to the question as the new take starts, so the word is said from the hanzi
alone, not read off the pinyin / English. The question shows a pulsing mic, the time so far, the
level, "Tap anywhere to stop" and **Stop** / **Cancel**; the ratings stay up. A tap anywhere on
the card (or Stop) saves the take and turns back to the answer, where it is transcribed as usual
("You said …", live Soniox or the upload) and **the card's own clip plays again** — the reveal's
auto-play (the note's recordings in turn, else its clip; a clip still being made is waited for), once,
with his own take's playback stopped — so the right pronunciation follows straight after his.
Cancelled, or a take that came out empty, plays nothing. Back (the Android back gesture / browser back), Esc or
Cancel throws the new take away and the answer comes back with the previous take and its result —
the previous take is replaced only when the new one is saved. Rating, FSRS and the upload are
unchanged; the first Record on the question works as before. Web: `reRecording` /
`renderReRecordPanel` in `StudyPage.tsx` (a history entry is pushed while recording so back
cancels), `useAudioRecorder` `keepPrevious` / `cancelRecording`; e2e `study-record-again.spec.ts`.
Lab: `RecordingAgainPanel` + `BackHandler` in `ui/study/CardStage.kt`, `cancelRecording` /
`keepNewTake` in `StudyViewModel.kt` (`RecordAgainFlipTest`). The replay: web
`replayAfterReRecordRef` in `StudyPage.tsx` (plays when the new take's blob lands); Lab
`recordingAgain` / `playWordAfterRecordAgain` in `StudyViewModel.kt` (`RecordAgainAutoplayTest`).

## Ask Claude — answers in Chinese, the chat's look and tools

**Ask Claude** (the action row on the card back) is an immersion chat about the card. Web
`components/askClaude/` (`AskClaudeSheet`, `useAskClaude`); Lab `ui/study/AskClaudeSheet.kt`;
worker `routes/ask-claude.ts`, `services/ask-claude.ts`, `services/ask-prompt.ts`; pure rules
`shared/study/askClaude.ts` + `askClaudeMenu` in `shared/chats/messageMenu.ts` (Lab core `AskClaude.kt`,
parity-tested by `android-lab/parity/fixtures/ask-claude.ts`).

- **Language.** "Ask Claude answers in: 中文 (default) / English" — Settings, and the 中文 | EN switch in the
  sheet header (`users.ask_claude_language`, NULL = Chinese; `PUT /api/profile/ask-claude-language`; on
  `/api/auth/me`, cached with the user / Lab prefs; every ask also sends the language on screen). In 中文 the
  prompt asks for simple graded Chinese (about HSK 3–4, short sentences, the learner's own words — a sample
  of ≤ 150 hanzi of started notes goes into the prompt — no pinyin / English, plain text: meaning, each
  character, usage, one or two examples). An explicit "in English please" / 用英文 (`asksForEnglish`) answers
  that turn in English. A Chinese answer is stored as plain text (`plainAnswerText` strips stray Markdown) with
  `note_questions.answer_lang = 'zh'`; English answers stay Markdown. The quick chips ask in Chinese in 中文
  mode (`askQuickActions`) and are not checked (`quick: true`). Tools (edit card, add cards, ⚡ bump, delete,
  mini lesson) work in both, still behind Approve / Reject.
- **Bubbles.** The tutor chat's bubbles (`chat-signal.css`): mine blue on the right, Claude's grey on the left.
  Every Chinese word is a chip (`ChatWordsText` / Lab `ChineseWords`), made on the device the moment the
  answer arrives by the deterministic segmenter (`shared/chinese/segment.ts`; web `services/chineseSegmenter.ts`,
  Lab `data/text/DeviceWords.kt`) — words, never single characters, offline too. (Until Oct 2026 Claude split the
  text after the answer, `POST /api/note-questions/:id/words`: 2–31 s, sometimes failing, with every character
  tappable meanwhile; the apps no longer call it.) A tap opens the **language explorer** (source `ask_claude`).
- **Long press** (right-click / the hover ⋯ on desktop) → the chat's message menu with only what fits
  (`askClaudeMenu`): Copy · Translate (`POST /api/note-questions/:id/translate`, cached on the row) · Pinyin ·
  Explain / Save as flashcard (sentence-sized text, ≤ 120 characters — the chat's Explain sheet) · Open in
  Coach (mine checked, Claude's explained) · Read aloud (Claude in the app voice, mine in my voice; cached per
  text). An English Markdown answer has Copy only. No reactions, reply, pin, edit or delete.
- **My own Chinese is checked** like a chat message: the question goes through the chat's auto-check
  (`checkAskQuestion` = `defaultAutoChecker` + `normalizeAutoCheck`, the `chat_auto_check` switch, the same skip
  rules) in parallel with the answer; done within 2.5 s of the answer it comes back with it, else it is stored
  in the background (`question_check_pending` → the app reads `GET /api/note-questions/:id` again). An
  improvable question gets the ✎ mark, "✨ How to say it better" first in its menu (the chat's sheet; "Ask
  Claude about this" fills the box with 为什么「…」更好？) and the **🎓 Open in Coach** chip under it.
- **🎧 Listen first** (Jerome: "Please also allow it to be toggled to audio first, in the same way the messages
  are, so I can listen to the answer."). The chat's Listening mode (docs/CHAT.md "Listening mode"), reused — not
  forked: the same hidden bubble (web `ListeningBubble` + `useListeningPlayer`, Lab `ListeningContent` +
  `ListeningPlayer`), the same 0.75× chip (remembered under the chat's key) and the same Read-aloud clip path.
  - **The switch**: 🎧 in the sheet header beside 中文 | EN, and Settings → "Ask Claude answers in" → 🎧 Listen first.
    Per account like the chat's setting: `users.ask_claude_listening` (migration 0117, NULL = off),
    `PUT /api/profile/ask-claude-listening { ask_claude_listening }`, on `/api/auth/me` (cached with the user / Lab
    prefs, so it is known offline); every ask also sends the switch on screen (`listening`). Switching it on keeps the
    answers already on screen visible (`revealedWhenListeningOn` — the chat's "history stays").
  - **What hides** (`askAnswerHidden`, shared/study/askClaude.ts): Claude's Chinese answers (`answer_lang` 'zh' with
    Han characters, ≤ 2,000 characters) not revealed on this device. My own questions never hide; English answers (EN
    mode, "in English please", older Markdown answers) never hide. Revealed ids are device-local (web localStorage
    `ask-claude-revealed-v1`, Lab JsonCache `study/ask/listening/revealed`; newest 500).
  - **Gestures**: tap plays (again, from the start); long press / right-click / 👁 reveals with the chat's un-blur —
    no menu until revealed; then the normal word chips and long-press menu. Claude's tool results (Approve / Reject)
    stay visible under a hidden answer.
  - **Auto-play** (Ask Claude's own — the chat has none): a new answer that arrives hidden while the sheet is open
    plays once by itself, unless audio is already playing or loading (Read aloud, another answer) — `askAutoPlayId`.
    Answers on screen when the sheet opened never auto-play. Closing the sheet stops the clip.
  - **Audio**: the Read-aloud clip — `POST /api/practice/tts` (MiniMax → the stored provider chain, the limiter, R2
    `tts-cache/` by text + voice + speed), device cache by the same triple. Claude's voice is fixed: `ASK_CLAUDE_VOICE`
    = the app voice (Radio Host, the one every card speaks in) at `ASK_CLAUDE_SPEED` = 0.6 (`CHAT_READ_ALOUD_SPEED`);
    Read aloud on Claude's answer uses it too. One clip per answer: the path has no length limit below MiniMax's
    10,000 characters and answers are a few hundred, so nothing is split. **Pre-generated**: with listening on, the
    ask route makes the clip (`pregenerateAskClip`, interactive priority) alongside the question's check, waiting at
    most `ASK_CLIP_GRACE_MS` (8 s — the bubble is hidden anyway) before answering (`answer_clip_ready`), else it
    finishes in waitUntil — so the auto-play and a tap are instant.
  - **Offline**: a cached clip plays; otherwise the line under the bubble says listening needs a connection the first
    time, and a long press still reveals the text.
  - Analytics: `study.ask_claude_listening { on, source: sheet | settings }`, `study.ask_claude_listen_play { auto, slow }`,
    `study.ask_claude_listen_reveal`.
- **Offline.** Ask Claude needs the network (the button is disabled offline, errors are inline). Translations
  and word chips are stored on the row, so a reopened conversation (card hub) has them.
- Analytics: `study.ask_claude { card_type, language, quick }`, `study.ask_claude_language { language, source }`,
  `study.ask_claude_tool { action, role }`.

## Character sheet

Tapping a character of the hanzi on the card back (or of the answer diff on a typing card)
opens the **character sheet**: dictionary data about that character that is the SAME on every
card — it never looks at the card on screen and needs no AI call. It replaced the old popup
that asked Claude to define the character in the context of the current card
(`WordDefinitionPopup` → `POST /api/vocabulary/define`; that endpoint, the D1
`character_definitions` table and the IndexedDB `characterDefinitions` cache are kept but the
card no longer uses them; chat role-play's word tap still does).

The sheet shows the big character, its readings (most used first), a one-line meaning, each
reading's gloss when there are several, chips for the radical, stroke count and frequency rank
(“#46 most common”, top 5,000 only), "Built from 彳 (…) + 亍 (…)", a one-line etymology hint,
**✍️ Write it** (the stroke-order sheet for that one character) and **✨ More about 行**.

**Words with 行**: the ~20 most frequent words containing it (hanzi · pinyin · gloss), with a
status from the learner's own notes and cards ON THE DEVICE (offline):
**✓ Known** = a note with that spelling has a mature card (Review, stability > 21 days — the
deck page's "mastered", the Progress page's "known"), **📚 In your decks** = they have the word
but nothing mature yet, nothing = they don't have it. The order is the dictionary's frequency
order with the card's own word(s) first and highlighted; known rows are dimmed, not moved.
Rules: `shared/chars/status.ts` (`charWordRows`, `charWordsSummary`; Lab `core/…/CharWords.kt`,
parity-tested by `android-lab/parity/fixtures/char-words.ts`). The sheet is now the
**Character view of the language explorer** (docs/LANGUAGE_EXPLORER.md): a row opens that word's
**Word view** — "You have this card in HSK 2" with **⚡ Study it today** (source `explorer`) and
**Open card →**, or **+ Add as card** (`AddChunkModal`, the top queue deck preselected) — and the
radical / components open their own Character views; ← and the breadcrumb go back.

**Data** (`shared/chars/`, `scripts/build-char-dict.ts`): built once from open data —
CC-CEDICT (CC BY-SA 4.0: readings, words, glosses; tone numbers → marks, one word's syllables
joined, `applyYiBuToneChanges`), Make Me a Hanzi `dictionary.txt` (LGPL-3.0: definition,
radical, decomposition, etymology, stroke count) and wordfreq `large_zh` (CC BY-SA 4.0 data:
word order; character rank = Σ word frequency × occurrences). ~10,200 characters (every
character Make Me a Hanzi knows + anything ranked in the top 8,000), ~51,700 word rows, 2.3 MB
gzipped, in 128 shards `worker/char-dict/NNN.dat` (gzipped JSON, shard = code point % 128)
served from the worker's static assets (`[assets]` binding `CHAR_DICT`, `run_worker_first`) and
kept in memory per isolate: no D1 rows, no R2 objects, a rebuild deploys with the worker.
`GET /api/chars/:char`, `GET /api/chars?c=` (≤ 100). Credits: Settings → About · Licences
(`/about/licences`).

**On the device**: IndexedDB `charDict` (Dexie v28; `services/charDict.ts`) — cache first,
a character the dictionary lacks is remembered for a week; every sync (hourly) prefetches the
characters of the next ~150 notes to study, in batches, so the sheet works offline. Offline and
never fetched → "You’re offline and this character isn’t on the device yet". Lab: JsonCache
`chars/<c>` + a FeatureSync.

**More about 行** asks Haiku (`POST /api/chars/:char/explain`) for 2–3 card-independent
lines (meaning, components, common use) from the dictionary record only — never the card —
stored once per character for everyone (D1 `char_explanations`, migration 0108) and on the
device (`charExplanations`). Offline: "Needs a connection — the dictionary above works offline."

Analytics: `study.char_sheet_open` (found, words), `study.char_word_tap` (status, current),
`study.char_word_added`, `study.char_explain`. e2e `character-sheet.spec.ts`.

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

## Say the answer (🎤 on the typing cards)

The typing cards (meaning → hanzi, audio → hanzi) have a **🎤** beside the answer box (web
`hooks/useSpokenAnswer.ts` + `services/spokenAnswer.ts`; Lab `StudyViewModel` "say the answer" +
`CardStage` `SpokenMicButton`). It is the read cards' pronunciation take, not a fork:

- **Tap 🎤** → the SAME recorder and live Soniox stream as a read card's take (web
  `useAudioRecorder` + `LiveTranscriber`, Lab `VoiceRecorder.startLive` + `SonioxStream`); the box
  turns into the live transcript — confirmed text in ink, the provisional tail grey (the
  transcriber's `onUpdate`). **✕ Cancel** throws the take away and fills nothing. A listen card's
  clip is stopped first so it doesn't play into the microphone.
- **Tap ⏹** → the final text is the answer. With **Settings → Study → "Submit spoken answers
  automatically"** on (the default; per device: web localStorage `spoken-answer-auto-submit-v1`,
  Lab `StudyPrefs.spokenAutoSubmit`) it is checked at once — the same path as Check; off, it only
  fills the box and Enter / Check submits it.
- **The take is kept**: it rides with the review like a read card's (`recording_url` via the
  offline recording queue — web `pendingRecordings`, Lab outbox `rec-<eventId>`), so the tutor can
  hear it; the review's `answer` is the transcript. No schema change.
- **Fallback, never silent**: live missing / failing / empty → the take is uploaded to
  `POST /api/transcribe` (`transcribeTakeOutcome`, Lab `TakeTranscription.outcome`). Both failing →
  "Couldn't transcribe — tap to retry" (the same take, upload only), the box stays editable, nothing
  is submitted. Nothing heard → "Didn't catch anything — tap 🎤 to try again, or type it".
- **Offline**: the 🎤 stays, dimmed; a tap says "Saying the answer needs a connection — type it
  instead." Typing is never blocked.
- **Homophones** (`shared/cards/answer.ts` `checkSpokenAnswer`, Lab `AnswerKey.checkSpoken`,
  parity-tested by `parity/fixtures/spoken-answer.ts`): speech can't tell 由 / 油 / 游 apart, so a
  spoken answer whose hanzi differ but whose pinyin WITH TONES matches the card's (the app's
  automatic pinyin over the answer key — numbers → hanzi, 两 → 二, punctuation dropped — then the
  一 / 不 tone changes; the note's own written pinyin and the alternatives count as targets too) is
  **right by sound**: the expected characters in green with "Sounded right ✓ — written 由" and "You
  said: 油". The same syllables with other tones is **close** — still wrong (the diff, plus "Close —
  the tones are off"). Exact hanzi = right, as typed. Edited after speaking = a typed answer again.
  The expected answer is never sent to Soniox (no context) — it would bias recognition.
- Analytics: `study.answer_spoken` (result submitted / filled / failed / empty / cancelled, via,
  live_error, speech_ms, ms, auto_submit) and `study.spoken_answer_checked` (verdict).

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
