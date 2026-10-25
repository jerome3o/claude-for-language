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

  **Words made of characters I know: start with English → Chinese** (Settings → New cards, the
  switch under "Order new cards by", ON by default; Oct 2026, `shared/decks/lead-card.ts`, Lab
  `core/…/LeadCard.kt`, parity-tested by the `leadCard` study-queue vectors). Jerome: "Notes with
  characters I should know should present, in the blue queue, English → Chinese first." An unseen
  note whose Han characters are ALL known leads with its **meaning_to_hanzi** card instead of
  hanzi_to_meaning (falls back to hanzi_to_meaning when it has none; a note with no Han characters is
  unchanged; sentences follow the same rule). Known = the Progress page's definition read from the
  cards' current state: a card in Review with stability > 21 days; a character is known when it is in
  the hanzi of a note with a known card (any deck — a one-deck session passes `knownNoteIds`).
  Only the card TYPE changes: the same notes come, in the same order and counts (the tiers rank
  notes; a note of known characters is never in the "new characters" tier anyway); the note's other
  cards follow through the purple pool. The session's own pick (`pickPrioritizedNewCard`, Lab
  `StudyQueue.selectNext`) treats that card as the note's first. Bumps and homework passes are
  unchanged. Stored in the same `users.new_card_order` JSON (`known_characters_english_first`).

  **Order new cards by** (Settings → New cards, Oct 2026; `shared/decks/new-card-order.ts`, Lab
  `core/…/NewCardOrder.kt`, parity-tested by `parity/fixtures/new-card-order.ts` and the
  `ordered` study-queue vectors). Jerome: "I'm getting a bunch of sentences in my flashcards that
  are probably not the highest leverage thing to learn right now." Five switches, all on by
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
  3. **Everyday words before formal ones** (Oct 2026; Jerome: "prefer non-formal words, and prefer
     that more than frequency"; `everyday_first` in the same JSON, ON by default; `shared/decks/formality.ts`,
     Lab `core/…/Formality.kt`, parity-tested) — not a tier: inside each tier (and inside a deck in the
     fallback) everyday words first, neutral ones next, formal ones last, BEFORE "Most common first"
     (in tier 1 before the most-common-new-character rank) — the frequency list counts mostly written
     text, so it ranks 告知 / 抵达 / 用餐 above 搞定 / 买单 / 结账. It never moves a word across tiers
     (a formal word bringing a new character still comes before an everyday word that doesn't) and
     never changes which or how many notes the budget takes from a deck. The class: the shipped word-tag
     lexicon's register first (Formal / Literary → formal; Colloquial / Informal / Slang → everyday;
     Rude / Derogatory → neutral, never pushed forward; other codes such as Polite say nothing), else
     the note's AI word tags when the lexicon has no register code at all and the verdict isn't low
     confidence (register formal / literary → formal, rude → neutral; then ✨ Everyday speech at high
     spoken confidence → everyday; then informal / slang → everyday) — the lexicon wins, as on the
     pills. Only WORD notes get a class: sentences and longer phrases are neutral (kept simple). The
     web loads the lexicon (`services/wordTags.ts`, a precached chunk) next to the frequency list when
     the queue is built and memoises each note's class (`services/noteFormality.ts`); the Lab reads
     `notes.wordTags` from Room (`LabDao.noteFormality`) and the lexicon as a core resource — never
     waiting for it: LabApp reads it at start, and a queue built before that treats every note as neutral. No lexicon
     → every note neutral (the plain order). Up next, ⚡ bumps and homework passes are untouched.
  4. **Most common first** — not a tier: inside each tier the most common word first (in tier 1,
     first the most common new character, above), and in the
     deck fallback inside each deck (deck order still first there). Frequency = rank in
     `shared/data/frequency/word-freq.txt` (wordfreq `large_zh`, data CC BY-SA 4.0 — the same
     source as the character sheet; 30,000 words + 8,000 characters, ~150 kB gzipped; rebuilt by
     `npm run build:word-freq`). A note whose Han text isn't a listed word (a rarer word, 不客气,
     any sentence) ranks after every listed word, by its rarest character. The web loads the list
     as a lazily imported chunk the service worker precaches; the Lab app reads the same file as a
     core resource — no network during study. Without the list the switch simply does nothing.
  5. **Sentences last** — inside tier 1 words before sentences, and after the tiers every word
     note (all decks, deck queue order, the most common first inside a deck) before any sentence.
  6. Then the deck order, deck by deck as before (`respreadPrimary` in `budget.ts` keeps the total
     of blue cards; `orderWithinDeck` puts words before sentences / everyday before formal / the most
     common first inside a deck).

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

### Pause new cards on heavy days (review-load cap)

Jerome (Oct 2026): "I know enough words now but not many sentence structures … I'm getting too
many cards a day. If I have over 100 cards to review today, give me no new cards, only the reviews;
the next day if it's ~90, give me up to the configured amount." One optional per-account limit on
the budget above — `users.pause_new_when_reviews_over` (migration 0131; NULL = off, 10–1000),
carried in `StudyBudgetInfo.pause_new_when_reviews_over` on `/api/auth/me` and `/api/sync/changes`
and cached on the device with the budget (web `services/studyBudget.ts` `readReviewLoadCap`, Lab
`Prefs.reviewLoadCap`), so it applies offline:

- **Rule** (`shared/decks/review-load.ts`, Lab `core/…/ReviewLoad.kt`, parity-tested by
  `android-lab/parity/fixtures/review-load.ts`): **today's review load** = cards past NEW due by the
  cutoff (the "due today" definition below) **+ cards already reviewed today**, never a card whose
  first-ever review is today (a new card's learning steps aren't reviews). So the number does not
  fall as he works through the day — a card that was due this morning and is now scheduled for next
  week still counts. An early review of a not-due card (a ⚡ bump's) counts from then on. The load is
  account-wide: a one-deck session counts every deck.
- **Over the limit** (`load > limit`, `reviewLoadState`) → today's budget is **0 new words + 0 extra
  cards** (`budgetForToday`); at or under it → the configured budget. No taper: it's a switch, as asked.
- **Unaffected**: ⚡ bumps (outside the budget), homework passes, lessons / readers, learning and
  review cards, and the new cards already introduced today (their learning steps go on). **Up next**
  draws from the budget, so it waits too (said in Settings and on Home). **Study 10 more** (bonus)
  still adds new cards — the manual override (deck caps still apply).
- **Where**: web `loadStudyInputs` (`db/database.ts`) computes the load from today's review events
  and gives every queue today's budget (`getRawQueueCounts` carries `budget` + `reviewLoad`, which
  `allocateQueueCounts` uses by default); Lab `data/TodaysBudget.kt` at every `StudyQueue.build`.
- **Settings → New cards a day** → "Pause new cards on heavy days" (switch + "when more than [100]
  reviews are due" + one line), saved with the budget (`PUT /api/profile/study-budget`
  `{ pause_new_when_reviews_over }`). The tutor's "Daily new cards" sheet has the same field
  (`PUT …/student-study-budget`; the pause alone posts no chat message); MCP `set_student_study_budget`
  takes it.
- **Home** says why: "⏸️ New cards paused — 124 reviews due today (limit 100)" + "Up next waits too.
  ⚡ bumps and homework still come; Study 10 more adds new cards anyway." (`pausedNewCardsLabel`,
  `PAUSED_NEW_CARDS_DETAIL`; analytics `study.new_cards_paused` once a local day). The tutor's student
  card and "Daily new cards" row say "⏸️ New cards paused today · 124 reviews due" from the overview's
  `review_load` (the same rule in SQL over the server's card rows, `worker/src/services/review-load.ts`,
  in the student's own time zone).
- **Debug report**: `review_load: { threshold, load, paused }` (`budget` stays the configured numbers);
  `compareDebugReports` diffs the limit, the load and which side is paused.

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
- **The Coach** has no ⚡ chip any more (Oct 2026): tap a word of its answer → the explorer's ⚡ Study it today.
- **Claude** — Ask Claude, the coach chat and chat Discuss have a `bump_cards` tool and are told to
  bump instead of making a duplicate — always an explicit list of the words the learner named, never
  every word of a sentence; the MCP server has `bump_cards`, `list_bumped_cards`,
  `clear_bumped_card` and the tutor's `bump_student_cards`.

### Other card types — "Practise this word other ways…" (a card-level bump)

Jerome: "I've got the hanzi → spoken card and think 'I'd love to remember this when I think of the
English too' — let me send the other version of this card into the current session. And the
listening version, if I struggle to hear it." On the answer side, **⋯ → 🔀 Practise this word other
ways…** (the flashcard session only, when the note has another card) opens a small sheet
(`components/study/OtherCardTypesSheet.tsx`, Lab `ui/study/OtherCardsSheet.kt`; rules
`shared/decks/other-card-types.ts`, Lab `OtherCardTypes.kt`, parity-tested):

- one row per card type of the note, card-type order — **Read → meaning** · **English → 汉字** ·
  **Listen → 汉字** — with its state: *this card*, *new*, *⚡ in today’s study*, *due today*,
  *in review, due in 12 days* / *learning, due tomorrow* (days = ceil((due − today's cutoff) / 24 h));
- a NEW sibling offers **⚡ Add to today** (the first one is ticked when the sheet opens); a started
  sibling not due yet offers **Review it early today** (one early review, like the bump's); a card
  already due today, or already in today's pocket, offers nothing; a word with a whole-note bump has
  nothing to add; multi-select, pinned **⚡ Add N to today** + Close; after adding: "⚡ English → 汉字
  comes up in a few cards", then the sheet closes.

Adding is a **card-level bump**: the same `study_bumps` row with `card_types` (migration 0134, JSON;
NULL = the whole note as before; Lab Room v10 `cardTypes`). The pocket then holds exactly those card
types of the note, each until it is reviewed since the bump, whatever its state (a NEW card over the
budget, a due card first, a started card its early review); done when every chosen card has been
reviewed since. A request meeting an active bump (`mergeBumpCardTypes`): a whole-note bump already
covers it; on a card-level bump the device sends its merged list — the types still open plus the new
ones, re-dated to now, so a finished type never comes back — and the server takes it as it is; a
whole-note bump of a word with a card-level one makes it whole-note. Offline-first like every bump
(IndexedDB / Room at once, a NEW client id each change, uploaded with `card_types`).

The cards join **the current session at once** (`useStudySession.addBumpedCards`, Lab
`StudyViewModel.addBumpedCards`) but never straight after their sibling: the recent-notes filter
(the last 5 rated notes) holds them while anything else is available, and a bumped card never jumps
the queue while its note is among the last 3 rated (`pickBumpedCard`, `BUMP_SIBLING_GAP`). From its
first review the card follows FSRS like any other — no events are invented. Analytics
`study.other_card_types_open { from_type }`, `study.other_card_types { types, from_type, count, early }`
(types joined with `/`); the bump itself is `study.bump_added` with `source: 'study_card'`.

## "Up next" — words chosen to come next

Jerome (Oct 2026): "Add a way for my tutor and me to manually add stuff to the learning queue … see
the specially-chosen queue, add stuff to it, remove stuff from it." **Up next** is a per-account
ORDERED list of notes he already has (`up_next`, migration 0121) that are introduced next, ahead of
the deck queue and "Order new cards by". It is persistent (not just today) — the ⚡ pocket above is
"today, over the budget"; Up next is "next, in this order, within the budget". One rule,
`shared/decks/up-next.ts` (Lab `core/…/UpNext.kt`, parity-tested by the `upNext` study-queue vectors):

- **Inside the daily budget, first** — before the deck allocation, the list takes what is left of the
  ONE budget (`newBudgetLeft`, `budget.ts`) in list order: a note with no card reviewed yet takes ONE
  blue card (its best NEW card: hanzi_to_meaning → meaning_to_hanzi → audio_to_hanzi — meaning_to_hanzi
  first for a word made only of known characters, "Words made of characters I know" above; its other cards
  wait and become purple once that one is reviewed); a started note offers each of its NEW cards to the
  PURPLE budget (never a spill of blue budget into them). "Study 10 more" (bonus) takes the next Up next
  words first. The budget is never raised — a list longer than today's budget waits for the next days.
- **Deck caps don't hold it back** — the person chose these words, so a deck's cap (and a one-off
  homework copy's 0 + 0) doesn't stop them; what the list takes still counts against its deck's cap for
  the rest of that deck's words (`withUpNextPicks`, the same numbers `introducedToday` gives once the
  card is reviewed — so Home and the session agree all day).
- **Exceptions** — a word left out of long-term review (`notes.long_term = 0`) and never started is
  skipped (that "no" is explicit too); a note in the ⚡ pocket belongs to the pocket. A note on the list
  never also feeds its deck's pool (no double introduction).
- **Leaving the list** — a note drops off by itself once EVERY card of it has a review
  (`upNextStatus` 'done'; the server writes `done_at` lazily, the device hides it from its own cards).
  Removing by hand only takes it off the list; nothing is deleted. Notes with no NEW card left can't be
  added (`no_new_cards` — ⚡ Study it today is the tool for those).
- **Who** — the learner, and the tutor of an active relationship on the student's list
  (`/api/relationships/:relId/student-up-next`, `added_by` → "added by Minghui"); no chat message.
- **Session order** — Up next decides WHICH new cards today brings; inside the session new cards are
  still mixed with reviews as before.
- **The page** (`/up-next`, More → Up next, Home's "↑ N up next: 银行、学生… ›" line; web
  `pages/UpNextPage.tsx` + `components/upNext/UpNextBoard.tsx`, Lab `ui/upnext/`): ⚡ Today (the pocket, each word
  with ✕ and "↑ Up next" = not today, next instead), a search over the cards on the device (the server's search when it
  finds nothing) whose results go on the list with ＋ Top / ＋ Bottom or by **press-and-hold and drag into place**
  (`services/upNextDrag.ts`, Lab `UpNextDrag.kt` — a dashed "Drop it here" row follows the finger while it is over the
  list), then the list: press-and-hold drag to reorder, ↑ to the top, ⚡ (study it today instead), ✕ off the list with
  **Undo**. Every change applies at once offline (IndexedDB `upNext` + `upNextOps`, Dexie v33; Lab Room `up_next` v8 +
  the Outbox) and uploads in order; a sync's list replaces the device's only when no change is waiting. "↑ Up next" /
  "↑ #3" also sits on deck page rows and the card hub (`components/upNext/UpNextButton.tsx`). The tutor: student page →
  Long-term learning → "↑ Up next · N words" → `/connections/:relId/up-next` (online, searches the student's cards).
  Home counts and the session agree (`allocateQueueCounts` gives the Up next slots the same budget first; tested over
  random lists, caps, budgets and bonuses in `services/upNext.test.ts`). E2E: `e2e/tests/up-next.spec.ts`.
- **API** — `GET|POST /api/me/up-next` (`position` 'top' | 'bottom' | 0-based index; a note already
  on the list moves there when a position is given; client ids for the offline outbox), `PUT
  /api/me/up-next/order { note_ids }`, `DELETE /api/me/up-next/:noteId`; `/api/sync/changes` carries the
  whole list as `up_next`. MCP: `get_up_next`, `add_to_up_next`, `move_in_up_next`, `remove_from_up_next`,
  and the tutor's `get_student_up_next`, `add_to_student_up_next`, `move_in_student_up_next`,
  `remove_from_student_up_next`.

## Suspend & snooze — Anki's card controls, with clearer words

Jerome (Oct 2026): Anki's card controls, "with no fake reviews and without bending FSRS" — and a
"not today" with wording that makes it obvious. One rule for both apps, `shared/decks/holds.ts`
(Lab `core/…/CardHolds.kt`, parity-tested by `android-lab/parity/fixtures/card-holds.ts`):

- **Suspend** (⋯ → *Suspend…* on the answer side, the card hub): the card leaves ALL study — the
  queue, the new-card pools (a held NEW card frees its budget slot, so the next new card takes its place
  today), the ⚡ pocket, Up next, Home and deck counts, "Pause new cards on heavy days"'s load, the
  server's due list (MCP / study app). Its review history and FSRS state are untouched — a hold is never
  a review event and never a state write. Unsuspended, it comes back exactly as it was: an overdue review
  is simply due, and ts-fsrs schedules it from the real elapsed time.
- **Snooze** (Anki's bury, named for what it does — ⋯ → *Snooze…* "Not today"): *Until tomorrow · For a
  week · For a month*. Hidden until the LOCAL date it ends (`snoozeUntil`: + 1 day, + 7 days, same day
  next month clamped to the month's end), the schedule unchanged, a snoozed new card frees its slot today.
  Each device decides with its own local date ("YYYY-MM-DD" in `card_holds.until`).
- **This card only / All card types of this word** — one toggle on both sheets (`holdTargets`).
- **"Don't show a word's other card types on the same day"** (Anki's sibling burying; Settings → Study,
  per account, **off** by default — `users.bury_siblings`): once a card of a word was reviewed today, the
  word's NEW and REVIEW cards wait until tomorrow (`siblingBuriedCardIds`, applied by `selectStudyQueue`
  and live in the session after a rating). Learning / relearning cards are never held back, and a word
  bumped to today (⚡) is exempt — that is an explicit "show me this now".
- **Homework one-off passes are NOT affected** — a pass is not FSRS: it is the tutor's checklist,
  answered with Not yet / Got it and no review event. Suspending a card in study doesn't take a word out
  of the tutor's homework; the pass still shows it (the long-term review of the same card stays held).
- **Where to manage them** — Jerome: "people hardly ever look into the decks". Settings → Study →
  *⏸️ Suspended & snoozed cards* (and More → Decks → the same row) opens `/cards/held`
  (`pages/HeldCardsPage.tsx`; Lab `ui/cardcontrols/HeldCardsScreen.kt`): a searchable list (hanzi, pinyin
  with or without tones, English — `filterHoldRows`) with All / ⏸️ Suspended / 💤 Snoozed chips, each row
  with its card type, deck and since / until, *Unsuspend* / *Wake now* per row and for the ticked ones,
  and **Undo**. The card hub shows each card type with its hold and the same actions
  (`components/cardControls/HubCardControls.tsx`); deck page rows carry a quiet tag — "⏸️ Suspended",
  "⏸️ 1 of 3 suspended", "💤 Snoozed · 29 Oct" (`noteHoldTag`) — always an icon and words, never colour alone.
- **Storage & sync** — `card_holds` (migration 0135): one row per hold (client id, card, kind, until,
  created_at, cleared_at). A new hold on a card clears its older ones; a clear covers holds made at or
  before it (a hold made later on another device survives). Offline-first: web IndexedDB `cardHolds`
  (Dexie v35, `services/cardHolds.ts`), Lab Room `card_holds` (v11, `data/holds/HoldStore.kt`) + the
  Outbox; `/api/sync/changes` carries the whole active list as `card_holds` (+ `bury_siblings`).
  API: `GET|POST /api/me/card-holds`, `POST /api/me/card-holds/clear`, `PUT /api/profile/bury-siblings`.
  MCP (the signed-in user's own cards only): `suspend_cards`, `unsuspend_cards`, `list_suspended_cards`.
- **Debug reports** carry `holds` ([card, kind, until] as the device applies them today) and
  `bury_siblings`; `compareDebugReports` says when the two apps hold different cards.
- **Analytics**: `card.suspend`, `card.unsuspend`, `card.snooze`, `card.wake`, `settings.bury_siblings`.
- **E2E**: `e2e/tests/card-holds.spec.ts` — suspend from the card, gone from study, unsuspend from Settings.

## Leeches — "⚠️ Missed 8×"

A **leech** is a card you keep forgetting after you had learned it. The count is Anki's **lapse**:
pressing *Again* on a card that was in **Review** (graduated). This is exactly what FSRS counts as `lapses`
(ts-fsrs adds one only for Again in the Review state), so the number already exists on every card.
*Again* on a NEW or learning card is not a lapse, because that card was never learned yet. We do **not**
count "missed 8 times in a row", for two reasons. Anki's own rule is total lapses, and one lucky Good
between misses shouldn't hide a card that keeps failing. Anki's default leech threshold is **8**, and
that is ours too (`LEECH_THRESHOLD`, `shared/cards/leech.ts`; Lab `core/…/Leech.kt`, parity-tested by
`android-lab/parity/fixtures/card-forget.ts`).

- **On the answer side**, a leech shows **"⚠️ Missed 8×"** as a pill under the meaning, next to the word
  tags. It always has an icon and words, never colour alone. It never shows on a homework pass.
- **Tapping it** opens the leech sheet (`components/cardControls/LeechPill.tsx`; Lab
  `ui/cardcontrols/ForgetLeechSheets.kt`). The sheet shows how many misses and when the last one was,
  plus the last 10 ratings (✗ Again — missed, ~ Hard, ✓ Good, ✓✓ Easy). These come from the card's own
  events on the device (`leechInfo`), so they work offline. It then offers **What helps**: ✏️ Edit card ·
  💡 Ask Claude for a memory hook (opens Ask Claude with a prepared question, `memoryHookQuestion`) ·
  💤 Snooze… · ⏸️ Suspend… · ↺ Forget this card….
- **Nothing happens automatically.** A leech is never suspended by itself. Anki's default auto-suspend
  is exactly what Jerome didn't want.
- The card hub shows the pill on the leech's card type too.
- Analytics: `card.leech_open { lapses, card_type }`.

## Forget — "reset to New", as an event

⋯ → **Forget this card…** (also from the leech sheet and the card hub) puts a card back to **New**:

- **The warning comes first**, before anything happens: "This card goes back to New: its schedule
  restarts from scratch and it re-enters your new-card queue. Its review history is kept but no longer
  counts toward scheduling. Can't be undone except by Undo right now." (`FORGET_WARNING`; a plural form
  is used for several cards). Then the same *This card only / All card types of this word* toggle as
  Suspend, and **↺ Forget card**.
- **It is an event, not a state write.** A forget is stored as `{ id, card_id, forgotten_at }` and the
  replay treats it as a reset. `computeCardState` (shared/scheduler) and Lab `CardScheduler.computeCardState`
  start again from a NEW card at a `kind: 'forget'` event and ignore everything before it.
  `computeCardTimeline` puts a NEW point there. Reviews made after the forget replay exactly as on a fresh
  card (lapses start again from 0). The two ports are parity-tested over random histories with forgets
  mixed in, including a forget at the same instant as a review: the forget sorts after the reviews
  (`withForgetEvents` / Lab `Forgets.merge`).
- **Stored apart from reviews**, in `card_forgets` (migration 0136; web IndexedDB `cardForgets` in
  Dexie v36; Lab Room `card_forgets` in v12). `review_events.rating` stays 0–3. Because forgets are a
  separate table, no review count, streak, daily stat, study time, insight, tutor dashboard or progress
  number ever sees one as a review: the history is kept and still counts as history. Forgets are merged
  into a card's events ONLY when its state is replayed. That happens on the server (`POST /api/reviews`,
  `DELETE /api/reviews/:id`, `/api/cards/recompute-states`, the forget endpoints), on the web
  (`getCardReplayEvents`, `recomputeCardFromEvents`, the bulk repair, the session's replay) and in the Lab
  (`Repository.recompute` / `replayEvents`).
- **What it changes:** the card becomes NEW. "Introduced today" and "first review" read only the reviews
  after the last forget (`reviewsSinceForget`: web `getFirstReviewedAtMap`, Lab `LabDao.firstReviews`).
  So when the card is studied again it is a new card introduced that day and counts against the budget.
  A forgotten card whose word still has a started card is a secondary (purple) new card. When every card
  of the word was forgotten, the word is unseen again and becomes a primary (blue) new card. Known
  characters / words (`shared/progress/known.ts`) treat the card as not seen from the forget on.
- **Undo** is the toast's button right after: "Card reset to New. · Undo". A forget not sent yet is
  dropped. A sent one is marked `undone_at` (`POST /api/me/card-forgets/undo`), stops counting
  everywhere, and the card is replayed back to exactly where it was. Due cards rejoin the session.
- **Shown in the history:** the card hub's Recent reviews (web `CardHubPage`, the tutor's view too,
  through `forgets` on the hub API; Lab card hub from Room) shows "↺ Forgotten — back to New · <card type>
  · <date>" as a marker line, never as a review.
- **Sync & older clients:** offline-first, like holds. A forget is applied locally at once and sent
  straight away when online (idempotent by client id), otherwise in the next sync.
  `/api/sync/changes` carries the whole live list as `card_forgets`, and each device replays the cards
  whose forgets changed. An older app that doesn't know forgets ignores the list. It keeps replaying from
  its own events (it simply doesn't see the reset) and nothing breaks.
- API: `GET|POST /api/me/card-forgets` (`items` with client ids, or `card_ids` / `note_ids` +
  `card_types`), `POST /api/me/card-forgets/undo { ids }`. Debug reports carry `forgets`
  ([card, forgotten_at]) and `compareDebugReports` says when the two apps replay different forgets.
- Analytics: `card.forget { scope, count, source, undone }`.
- Tests: shared scheduler + `leech.test.ts`, the Lab `CardForgetParityTest`, the worker
  `card-forgets.test.ts` (real SQLite), the web `cardForgets.test.ts`, Lab `ForgetLeechUiTest` +
  `MigrationTest` v11→v12, and E2E `e2e/tests/card-forget.spec.ts` (leech pill → sheet → Forget, warning
  first → New on the server → Undo).

## Mini lessons: never lost, a retry round, revise until right first time

Mini lessons are big chunks, not flashcards — and since Oct 2026 they are **not part of the study
session** (Jerome: "go all in on homework/assignments"). They are done from **Home's homework / to-do
card** and the **Mini Lessons page** (`/lessons`); `/lessons/:id/play?from=&mode=revision` plays one
(web `pages/LessonReplayPage.tsx`, Lab `ui/lessons/LessonReplay.kt`). The old lesson mix
(`LESSON_MIX_INTERVAL`, `pickTodaysLessons`), "New lessons a day" and the Settings → "Lessons &
readers" section are gone (the server still accepts their old settings / events from older apps).

### Judge each sentence / Choose the word (`shared/lesson/judgeGap.ts`; Lab `core/…/JudgeGap.kt`, parity-tested)

Jerome (Oct 2026): lessons kept asking "which sentence in this list is wrong?" — one pick from a list. Two
exercise types replace that, both checked on the device (offline, no model), one point per sentence:

- **`judge`** — 3–8 sentences; every one gets **✓ Correct** / **✗ Incorrect** (a segmented toggle, the chosen
  side FILLED — never colour alone). **Check** opens once every sentence is judged ("Check · 2 to go"), then each
  row says "✓ Right — this sentence is correct" / "✗ Not quite — this sentence has a mistake" (a missed row
  also gets a thick left bar), a wrong sentence shows its **Correct version** with pinyin + ▶ and the author's
  one-line why. ▶ plays a right sentence or a correction — the mistake is never read aloud.
- **`gap_choice`** — 2–8 sentences with one gap `___` and 2–4 words (shared by the exercise, or per sentence);
  a pick fills the gap in place; after Check the answer is in every gap, the buttons read "✓ 刚才" / "✗ 刚",
  "✗ You chose 刚 — it's 刚才", then the full sentence's pinyin, English, ▶ and the explanation. The gap
  marker is never shown or spoken: `fillGap(sentence, answer)` is what plays, exports and gets pinyin-checked.

The attempt keeps each sentence (`answer.items`: `judged` / `pick` + `correct`), the score counts sentences, and
any miss makes the exercise owed in the retry round (and part of the next revision). The tutor's / learner's
attempt review lists each sentence with what was said. Analytics `lesson.items_checked { exercise_type, items, right }`.

### A run is never lost (`shared/study/lessonRun.ts`; Lab `core/…/LessonRun.kt`, parity-tested)

Jerome (Oct 2026): "Make sure homework progress isn't lost over multiple days." He half-did a homework
lesson, opened it the next day, and it had reset. Root causes: the **web player kept the run in memory
only** (`useState(0)`), and **the Lab app dropped a saved run on another local day, after 18 h, or when
the spec's JSON changed at all** (a picture drawn later, a pinyin fix — `LessonResume`, deleted).

- A real run is **saved after every exercise** — where it stands (main pass / retry round), the
  score, every answer (the attempt rows with their answer checks), the time and the recordings
  already made — web IndexedDB `lessonRuns` (Dexie v34, `services/lessonRuns.ts`, recordings as
  blobs), Lab `LessonProgressStore` (SharedPreferences, recordings as files).
- It **continues until it is finished or "Start over"** — across days, app restarts, offline;
  never bounded by date. Opening the lesson from anywhere (Home, the homework pass, Mini Lessons)
  shows **"Continue where you left off (7 of 18)"** (or "(2 mistakes to put right)" in the retry
  round) with **Start over**. A run continued on another day reports the time spent on its
  exercises, not the days between.
- Keyed on the lesson's **shape** (`lessonShape`: the exercise types in order): content fixes and
  pictures keep it; an added / removed exercise starts fresh.
- Closing (✕) records nothing — the run waits. Previews ("Try it", the catalogue, the coach's
  mistake lesson before it is saved) never save one.

### The retry round

Every **scored** exercise answered wrong on the main pass — auto-checked wrong, self-assessed "Missed
it" / "Not quite", a conversation with any question missed (`verdictWrong`) — is **owed**. After the
last exercise the owed ones come back one by one ("🔁 Let's put this one right · 2 left") until each is
right; wrong again → to the back. Notes and other unscored exercises never are. The progress bar is the
homework pass's **retry bar** (`shared/homework/retry-bar.ts`, web `components/homework/RetryProgressBar.tsx`,
Lab `ui/kit/RetryProgressBar`; `runRetryBar`): one slot per showing — blue = answered, orange at the
RIGHT end = still owed ("↺ 2"); a mistake adds a slot so the blue never runs backwards, and once the main
pass is through the blue meets the orange and each fix eats one orange slot. Retry rows go into the
attempt with `retry: 1, 2…` (recordings `s0e1r1`), so the tutor sees them; only main-pass rows decide
"right first time". Analytics `lesson.retry { type, right, left }`.

### Revise until right first time (`shared/study/lessonRevision.ts`; Lab `core/…/LessonRevision.kt`, parity-tested)

No rating at the end any more (no Again / Hard / Good / Easy, no ✓ Done for good). Jerome: "100 % first
time → done forever. Otherwise it comes back 1 week later as a revision: all the questions you didn't get
first time last time, plus a very small subset of the ones you did get. Keep doing the weekly revision
cycle until you get all the questions right first time."

- Each finished run's **outcome** = its main-pass scored exercises and the ones missed first time
  (`runOutcome`), sent with the completion (`outcome` on `POST /api/custom-lessons/offline-complete`,
  D1 `custom_lesson_completions.outcome`, migration 0133) and listed back on `GET /api/custom-lessons`.
- The **latest run decides**: nothing missed → **done forever**; else a **revision** due
  `LESSON_REVISION_GAP_DAYS` (7) after it (`isRevisionDue` against the end of today).
- A revision (`revisionKeys`) = every exercise missed last time + `REVISION_EXTRA_SHARE` (20 %, at
  least 1, at most 3) of the ones got right — picked by an FNV-1a hash seeded with the lesson + last
  run id (every device picks the same), round-robin across exercise types — each with the note right
  before it in its section (context, unscored). It is a run like any other: the same retry round, the
  same rule. "Revision 1, 2…" counts the weeks in a row with mistakes.
- Applies to every lesson: tutor homework, his own / agent-made ones, unlocked podcast companions.
  The homework assignment's own `done` event is unchanged (finishing the lesson anywhere completes it).
- **Existing data** (no outcome stored): a run with an attempt gets its outcome derived from the
  attempt (`backfillCompletionOutcomes` on the server, `runOutcome` on the device); a finish without
  an attempt (Sep 2026) follows its rating — **Again / Hard → a revision of the whole lesson, Good /
  Easy / none → done** (he said then that he knew it); an old **"Done for good"** (a `revisit_events`
  retire, until a "Bring back") = done forever. Old apps' ratings / revisit events are still accepted
  and stored; a rating no longer decides anything when the run has answers.

**Where**: Home's card lists, after the homework rows, **revisions due** ("🔁 <title> · Revision 1 ·
5 questions · ~4 min · due today" → the revision run) and **new lessons a tutor sent for long-term review**
("🎓 … · new · 18 exercises · ~12 min"); locked ones wait; his own / agent-made / companion lessons never
started and lessons whose assignments were cancelled are NOT on Home — only on the Mini Lessons page
(`shared/homework/home.ts`). `/homework` lists the same lesson rows under **Mini lessons**, so Home's
"+N more" lands on them. The Mini Lessons page: **To do** (a run in
progress — ▶ Continue —, revisions due — ▶ Revision —, new — ▶ Start), **Revision coming** (▶ Revise now /
Whole lesson), **Done for good** (▶ Do it again), each with its size. The end of a run says "All right
first time — done for good! 🎉" or "Back in a week as a revision: the 3 you missed first time + a few
you got". **The tutor** sees "Revision 2 due 29 Oct · 3 to get right" / "all right first time" on the
student's lessons, the library item's assignments and the homework library (`revisionProgressLabel`,
`shared/homework/library.ts`; Completed = all right first time, a lesson being revised is In progress
and never Overdue) — computed server-side from the student's runs (`services/lesson-revision.ts`).

### Sizes (`shared/homework/size.ts`; Lab `core/…/HomeworkSize.kt`, parity-tested)

Every Home homework row says how big it is: a lesson "18 exercises · ~12 min" (`EXERCISE_SECONDS` per
type: a choice ~20 s, a translation ~50 s, a conversation ~2 min…), a revision "5 questions · ~4 min",
a deck pass "12 words", a reader "6 pages".

### Claude checks your answer (self-assessed exercises)

"Say it in Chinese" (`translate`) and "Listen and translate" answered in Chinese are self-assessed —
but a learner can't always tell whether their own wording is right. So the moment the answer is final
(✓ Check on a typed answer, the transcript's Submit on a spoken one, or Show answer with something
typed) the app asks Claude (`POST /api/lessons/answer-check`, Haiku via `structuredCall`, forced tool,
thinking off; `worker/src/services/answer-check.ts`) while the reveal is read:

- under "🎤 You said" a slim **Checking…** row (it never blocks the buttons), then the card: the verdict
  chip (**✓ Correct** · **✓ Also right** · **~ Almost** · **✗ Not quite**), a one-line headline, the
  learner's OWN sentence minimally fixed as a red-pen diff (+ the app's pinyin for it — pinyin-pro +
  the 一 / 不 tone changes, never the model's), ≤ 3 short tips quoting the Chinese at fault (tappable into
  the language explorer), and optionally one natural / idiomatic alternative with 🔊;
- the suggested button is ringed (correct / acceptable → Got it, almost / wrong → Missed it) — the
  learner still decides;
- **🔁 Try again** re-opens the answer box; the new answer is checked again and the attempt keeps every
  try (`ExerciseAnswer.tries`, each with its check; the final one in `ExerciseAnswer.check`) — the tutor's
  attempt review shows them;
- **💬 Ask about this** opens a short chat inside the lesson about this exercise, the answer and the
  check (`POST /api/lessons/answer-check/ask`), with one-tap questions (`askQuickQuestions`).

**The model answer itself is never sent to Claude.** When the answer matches the model answer by the
same rule as the "✓ Exact match" chip under "You said" (`isExactHanziMatch`, `shared/lesson/answer-check.ts`:
whitespace and sentence punctuation ignored), `exactAnswerCheck` (`shared/lesson/answerCheck.ts`, Lab
`LessonAnswerCheck.exact`, parity-tested) makes the check on the device — **✓ Correct · Exactly right —
nice!**, Got it ringed, nothing to fix — shown at once with no "Checking…" row, offline too; 🔁 Try again
and 💬 Ask about this stay. The worker answers such a request the same way without a model call (older
clients). Analytics: `lesson.answer_check` with `local: true`, `ms: 0`. A homophone ("✓ Sounds right") is
not exact and is still checked.

The prompt never marks different-but-valid wording wrong (optional 很 / 了 / 的, a dropped subject) and
reads a spoken answer as a speech-recognition transcript (homophones, punctuation). Checks are cached for
everyone (`lesson_answer_checks`, SHA-256 of `answerCheckCacheText`: version, type, spoken / typed,
prompt, model answer, the answer — punctuation-blind) and on the device (web localStorage
`lesson-answer-checks-v1`, Lab JsonCache `lessons/answer-check/<hash>`), so a check seen once shows
offline. Offline / failed / no key: no card — the self-assessment exactly as before. Rules:
`shared/lesson/answerCheck.ts` (Lab `core/…/LessonAnswerCheck.kt`, parity-tested). `sentence_making`
keeps its own check (`/api/lessons/sentence-feedback`). Analytics `lesson.answer_check` (verdict / error /
offline, ms, cached, try), `lesson.answer_retry`, `lesson.answer_ask`. E2E_TEST_MODE answers with
`services/answer-check-fake.ts`.

### Claude checks your speaking (free speaking: `oral_expression`, `speak`)

Jerome (Oct 2026): in "口语 · Speaking — recorded 🎙" he records a long answer to a task like "Annie
arrives at your office. Guess who she is (① 就是…吧), tell her where two places are (② 就在), what
today's meeting is about (③ 是关于…的), and how busy the team is (④ 形容词 + 到…)" — and got back only
his recording, the model answer and Not quite / I said it well. Now the take is transcribed and checked:

- **Transcribed like a study card's spoken answer**, but minutes long (`shared/lesson/speakingTake.ts`):
  the take streams to the live transcriber while he speaks (the words appear under the timer) and
  "🎤 You said" is ready a moment after ■; else the take is uploaded to `POST /api/transcribe`
  (`transcribeTakeOutcome` / Lab `TakeTranscription`). Both failing → **"Couldn't transcribe — tap to
  retry"** with the same take. Offline → "Recording saved — Claude will check it when you're online": the
  recording goes up with the attempt and the server transcribes it and runs the check then
  (`checkAttemptSpeaking`, `routes/lesson-attempts.ts`; skipped past the daily AI cap), writing it into
  the attempt. Long takes: the take stops itself at 5 minutes (`SPEAKING_MAX_SECONDS`), a cached live
  key is reused only with 6 minutes left (`SPEAKING_LIVE_KEY_MARGIN_MS`), Stop waits up to 8 s for the
  live stream's last words, the live session cap is 420 s and the upload / attempt-media limits 16 MB
  (the Lab streams 16 kHz WAV, ~1.9 MB a minute). Web `hooks/useSpeakingTake.ts`; Lab
  `LessonRecorder.startLive` + `SpeakingTakeState` (`ui/lessons/SpeakingCheckViews.kt`).
- **Done** starts Claude's check (the same `POST /api/lessons/answer-check`, `exercise_type`
  oral_expression / speak, the task, useful words, the question played, the model answer as "one way",
  the transcript ≤ 1,500 characters) — the larger model first (`runSpeakingCheck`, tool `check_speaking`,
  thinking off, the smaller model as the last attempt), cached like the translate check (cache text `s1|…`).
- **The prompt is gracious**: false starts, restarts, "sorry" / "wait" / 嗯 / 那个, English asides and
  repeats never count — it judges his final attempt at each bit; the transcript's PUNCTUATION is the
  recogniser's guess and is ignored completely (never a mistake, never mentioned, never changed); sound-
  alike characters (在/再, 他/她, 的/得/地) are read as intended; nothing that is fine in spoken Chinese is
  nitpicked. It returns `cleaned` (what he meant — his words and mistakes kept), `corrected` (a cleaner
  version: only the real mistakes fixed), `parts` (one per ①②③ — `speakingTaskParts` reads them from the
  task and the prompt lists them — used ✓ / used with a slip ~ / missing ✗, with a note), ≤ 4 tips each
  quoting his exact words with the better version (`fix`, + the app's pinyin) and the verdict / headline.
- **The card** (same `AnswerCheckCard` / Lab `AnswerCheckBody`): chip (**✓ Well said** · **✓ Good** · ~ Almost ·
  ✗ Not quite), the parts checklist, "A cleaner version" with the fixes in green (diffed against what he
  meant, not the raw transcript) + pinyin + 🔊, the tips with → the better words 🔊; then "One way to say
  it", Not quite / I said it well with the suggested one ringed, 🔁 Try again (a new take; every try kept)
  and 💬 Ask about this (its own quick questions). The attempt carries the transcript (`text`, input
  spoken) and the check, so the tutor's attempt review shows both.
- `speak` ("Say it out loud") gets the same recorder + check (nothing kept), with "🎤 I said it without
  recording" as before. Analytics: `lesson.speaking_transcribed` (via, live_error, ms, seconds) and the
  answer-check events with `exercise_type`. E2E_TEST_MODE: `SPEAKING_FIXTURE` in `answer-check-fake.ts`.
  Rules `shared/lesson/answerCheck.ts` + `speakingTake.ts` (Lab `LessonAnswerCheck.kt` / `SpeakingTake`,
  parity-tested by `parity/fixtures/lesson-speaking-check.ts`).

### Unlockable lessons (podcast companions, real-world tasks)

Jerome (Oct 2026): after a dialogue podcast he loved, he wanted a mini lesson drilling its characters,
sentences and meanings — queued, but LOCKED until he has listened to the podcast (or done some other
real thing: "Watch episode 3 of …", "Go to a restaurant and order 打包"). `shared/lesson/unlock.ts`
(Lab `core/…/LessonUnlock.kt`, parity-tested by `parity/fixtures/lesson-unlock.ts` + the `locked` /
`unlocked` sets in `parity/fixtures/revisit.ts`, legacy).

- **The condition**: `unlock: { kind: 'audio_lesson', audio_lesson_id } | { kind: 'manual', prompt }` on
  the lesson (columns `custom_lessons.unlock_kind / unlock_ref / unlock_prompt`, migration 0119);
  `unlocked_at` (+ `unlocked_via` auto | manual | player) once met; `companion_of` = the podcast a
  companion was written for. Synced with the lesson list (`GET /api/custom-lessons`).
- **Locked = never offered**: not on Home's card nor in the Mini Lessons page's To do — only in
  "🔒 Ready to unlock".
- **Unlocked**: an ordinary new lesson (Home, To do); after its first run it revises like any other.
- **Unlocking** (offline-first; the earliest time wins, `POST /api/custom-lessons/unlock` idempotent):
  automatically when a listen reaches ≥ 85 % or the last chapter ("Final listen") of its audio lesson
  (`audioLessonListened`; web player tick / Lab `AudioLessonEngine`, recorded per device and uploaded
  to `POST /api/audio-lessons/listened`, which unlocks server-side too) — only at the moment of a
  listen, so a companion made for a podcast already heard waits for one tap; by hand ("✓ I've listened
  — unlock" / "✓ Done — unlock"); or from the audio player's card ("Mini lesson ready: <title> → ▶ Start").
  Web: IndexedDB `lessonUnlocks` (Dexie v32), re-applied over each sync's rebuilt rows until the server
  carries it (`services/lessonUnlock.ts`). Lab: `lessons/local-unlocks` + the Outbox (`LessonStore.unlock`,
  `markAudioListened`).
- **Where**: web `/lessons` "🔒 Ready to unlock" (▶ Listen = the podcast, the unlock button) and a
  locked gate on `/lessons/:id/play`; Lab: the Mini Lessons list and the same gate. Locked
  lessons' media is prefetched too (one is often unlocked on the train).
- Analytics `lesson.unlock { via, kind }`; `lesson.companion_created` (server).


**Audio plays the moment it's asked for** (docs/AUDIO.md "Lesson audio prefetch"): every clip a
lesson can play is on the device before it opens — the sync fetches the lessons to do (Home's), every lesson
with open homework, locked / unlocked ones and the next few new ones; opening a lesson fetches
whatever is still missing, the exercise on screen first; the server makes a lesson's clips when it
is created / assigned / updated. A clip that arrives after the learner moved on is dropped, never
played over the next exercise.
## Graded readers: read once, one a day, listen-first

Graded readers close out an all-decks session (after the cards). A story is
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

## Listen in context (the listening card's question)

Jerome: *"On the listening cards, show all the example sentences so I can play them, and at the very
bottom play the individual word … ideally I have to listen to the sentences before the word."*

The question side of an **audio → hanzi** card is a list of the note's sentences — the card's own
sentence first (shown once when the set repeats it), then the generated set in order — as
**audio-only rows**: ▶, the row's number and a ✓ once heard. The Chinese, the pinyin and the English
stay hidden (they would give the answer away); **EN** on a row shows just that row's English, a hint,
never the characters. Under the list **+ More sentences** (online) writes more for the note
(`POST /api/notes/:id/sentences/generate { count, keepExisting: true }`, enough to reach about 8, at
least 3); the new rows appear when they are made, their clips through ensure-audio ("Audio coming…"
on ▶ while one is being made). At the bottom **▶ The word** (the note's clip / voices in turn, as
before). While no sentence has been played on the card, tapping it asks first, in the page (no
browser dialog): **"Try the sentences first? Hearing the word in context helps."** —
[Play the word anyway] [Play a sentence]. Once any sentence was heard (or "anyway" was chosen) the
word plays at once. The answer box / multiple choice / voice-first controls below are unchanged; the
old "Use in Sentence" button is gone from this card (its sentence is the list's row 1). The answer
side's sentence list is unchanged.

- **Auto-play** (the card used to read the word as it showed): the **first sentence whose clip is
  ready** plays instead (it counts as heard, ✓); only when no sentence has a clip does the word play,
  as before. Never on a peek back at the question.
- **Offline**: a row plays when its clip is on the device; the others show "Not downloaded" and are
  disabled. The card's own sentence with no clip yet uses the device voice online; a set row with no
  clip waits for it. The word always plays (device voice when its clip isn't cached).
- **Top-up**: a listening card shown with fewer than **five** sentences in total (card sentence +
  set) asks the server for more in the background — `POST /api/sentences/top-up { note_ids }` (the
  card shown now; the upcoming listening cards in the web's hourly sentence prefetch and the Lab
  session's next ten). The server queues a `top_up` job on `sentence-set-queue` that ADDS sentences
  after the set (rows, clips and breakdowns kept; `appendNoteSentences` touches every row so the sync
  still hands the set out whole) — at most one job per note a day, never one given up on (3 failed
  attempts), ≤ 50 notes a call. The card never waits for it; the rows arrive with a later sync.
- **Rules** (`shared/study/listenContext.ts`, Lab `core/…/ListenContext.kt`, parity-tested by
  `android-lab/parity/fixtures/listen-context.ts`): row order, row state (ready / fetch / device /
  unavailable), the auto-play choice, the word-first ask, the top-up and "+ More" counts. Web
  `components/study/ListenContext.tsx`; Lab `ui/study/ListenContextUi.kt` (state per card in
  `ListenState`, the auto-play in `CardStage`).
- **Analytics**: `study.listen_context { sentences_played, word_first_prompt_shown,
  played_word_anyway }` once the card is answered (verbose level), `study.listen_more_sentences
  { before, after }`.

## Card back layout

The back of a card is: hanzi · pinyin · (tutor note) · meaning · the word tags (below) · **Play** · **Record
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

### Practise a sentence aloud (🎤 on the sentence rows)

Once something is open on a row, a small **🎤** sits left of its **▶** (the same 36px circle as ▶,
a 44px target; a blank listen-first row has none, so the rows stay compact until a result shows).
Rules: `shared/study/sentencePractise.ts` (Lab `core/…/SentencePractise.kt`, parity-tested by
`parity/fixtures/sentence-practise.ts`).

- **Read it** — the row shows its Chinese (normal mode, or English-first with the Chinese
  revealed): say the sentence; the take is judged exactly like the Sentence Coach's "Practise
  saying it" (`practiseSentence`: the recogniser's trailing 。 tidied, punctuation ignored,
  homophones right by sound, other tones = close) and shown as the compact "You said" row under the
  sentence.
- **Translate it** — English-first with the English up and the Chinese not yet revealed: "Say it
  in Chinese". The row's sentence (or a homophone) is right on the device. Anything else in Chinese
  may still be a right translation, so online it goes to the lesson answer check
  (`POST /api/lessons/answer-check`, `exercise_type: translate`, `input: spoken`, cached; its verdict
  shows compactly — chip, headline, what was said, the fix — and correct / acceptable count as
  right). Offline / no check: "You said" vs the sentence (the hanzi diff) and "Check online for other
  ways to say it". After the take the row reveals its Chinese to compare.
- ONE microphone per list: 🎤 again, Enter or a tap anywhere else stops the take; a 🎤 on another
  row only stops the current take (its result lands on its own row first). Offline the 🎤 is off
  (transcription needs a connection). Hiding a row again (or EN) clears its result.
- **Practice only**: nothing is recorded, no review event, the card's rating is never touched (except
  through the gate below). The homework pass's calm rows have the read 🎤 too; the card editor's
  list has none.
- Web: `components/study/SentencePractise.tsx` (`useSentencePractise` on `useVoiceDictation`, surface
  `sentence_practise`) in `components/SentenceSet.tsx` (`practise`); Lab: `ui/study/SentencePractiseUi.kt`
  (`rememberSentencePractise`, `SentenceMicButton`, `SentencePractiseOutcome`) in `SentenceRowView`.
  Analytics `study.sentence_practise { mode: read | translate, result: right | close | wrong | failed |
  empty, via: local | claude | offline }`. Tests: `SentenceSet.practise.test.tsx`, Lab
  `SentencePractiseUiTest`.

### Hard mode (question → check → Sentence round → answer)

Jerome: "I said the word, recorded it, clicked submit, and it took me straight to the round page. It's jarring:
I don't know if my answer was right until after the next questions." **Hard mode** is the Worldle-like ladder on
the **reading (hanzi → meaning) and meaning (meaning → hanzi) cards** of the regular study session — never the
listening card, the homework pass, the tutor-notes practice or the Try-it previews:

1. **The question's own answer is checked AT ONCE, on the question** — with the checks the card already has: a
   typed answer `checkTypedAnswer`, a spoken one `checkSpokenAnswer` (homophones by sound), a multiple-choice grid
   all rows right, a read card's take its "You said" against the card (said as written, or inside a sentence —
   the "✅ Match"). While the take is transcribed: "Checking what you said…" (with 👁 Show answer). Offline / a
   failed transcription: "Couldn't check your answer" — 🔁 Try again or go on as before.
2. **✗ Not quite / ≈ Nearly** (his own words under it — "You said: 音乐" / "Your answer: …", never the card's
   answer): **🔁 Try again** asks the same question again (records again at once on a read card; the 🎤 again for a
   spoken answer; an empty box for a typed one; the grid again) — as often as he likes — or **👁 Show answer**.
3. **✓ Right** → a short beat (1.5 s, `HARD_MODE_RIGHT_BEAT_MS`, or **Next: harder questions →** at once) → the
   **Sentence round** below (or the answer side when the card has no sentences).
4. **Giving up is a miss**: 👁 Show answer, Skip recording, or Check / Show with nothing typed before a right answer
   → the answer side at once, **no round**, and **Good / Easy stay locked on this showing** (the sentences can't
   unlock them) — the line above the ratings says "👁 You looked at the answer — Again or Hard this time", a tap on a
   locked Good / Easy says why. Again and Hard are always there.

**Three settings, per device** — web `services/hardModePrefs.ts` (localStorage, under the old switch's key: '1'
reads as All cards), Lab `StudyPrefs.hardMode`: **Off** (the default: straight to the answer, no round, no lock) ·
**Red cards only** · **All cards**. Switched from the session header's **🎯 chip** (next to the ✈ Auto pill: "🎯 Off /
Red / All", a tap opens the three choices with a hint each — web `components/study/HardModeChip.tsx`, Lab
`HardModeChip` in `ui/study/HardModeUi.kt`) and **Settings → Study → 🎯 Hard mode**. The card on screen follows at
once: switched off while the check or the round is up → the answer; on the answer side switching it ON never locks
a card revealed without it, OFF frees Good / Easy.

**Red cards only**: Hard mode only for the cards he's struggling with right now — learning / relearning (the red
count in the session header, `isRedCard`). Every card rated Again today is one of these (Again on a new card →
learning, on a review card → relearning). Cards he's doing fine with (new, review) go straight to the answer.

- Today is the session: the resume point carries `feedback_open`, `gave_up` and `round_log` (with `round_open` /
  `sentences_right`), so leaving and coming back shows the check (recomputed from the answer / the take — a take
  that didn't survive a reload goes back to the question), the round (the same exercises) or the answer as it was.
  Undo / a new showing starts afresh.
- Rules: `shared/study/hardMode.ts` (`parseHardMode`, `nextHardMode`, `isRedCard`, `hardModeApplies`,
  `hardModeQuestionResult`, `hardModeRoundFollows`, `hardModeLock` + the words), Lab `core/…/HardMode.kt`,
  parity-tested (`parity/fixtures/hard-mode.ts` → `HardModeParityTest`). Web `StudyCard` in `pages/StudyPage.tsx`
  (`revealOrRound(attempted)`, `questionResult`, `hardTryAgain`, `giveUp`), `components/study/HardModeFeedback.tsx`;
  Lab `ui/study/CardStage.kt` (`reveal`, `questionResult`, `hardTryAgain`, `giveUp`), `HardModeFeedbackPanel`.
  Analytics `study.hard_mode { action: set | right | miss | retry | give_up | next, mode, where: header | settings,
  result, card_type }`. Tests: `shared/study/hardMode.test.ts`, `components/study/HardMode.test.tsx`, E2E
  `study-sentence-gate.spec.ts`, Lab `HardModeUiTest`.

### Sentence round (between the question and the answer)

In Hard mode (above), once the question was answered right, a **reading or meaning card** goes to the **Sentence
round** before the answer — like Worldle, a ladder of harder questions about the same item.

- **Up to four exercises** from the card's sentences (the card's own sentence first, then the set, easiest →
  hardest): up to four different sentences spread over the list, modes alternating **📖 Read it aloud**
  (the Chinese up) and **🔁 Say it in Chinese** (the English up) — so two of each. A translate slot whose
  sentence has no English swaps with the nearest read one that has (the card's own sentence often has
  none, so it is read). **A sentence is in AT MOST ONE exercise** — never read in one and translated in another
  (Jerome: the answer to one exercise was the question to another): fewer than four sentences = fewer
  exercises (3 → 3, 2 → one read + one translate when it can — a read slot leaves the only sentence with English
  to the translate slot —, 1 → 1, 0 → no round), and the word asks for more sentences (top-up `reason: few`,
  below). Deterministic — the same list gives the same round in both apps.
- **Any two right** (min(2, exercises)) — in any order. The counter
  "0 / 2 → 1 / 2 → 2 / 2" with dots, a "🎉 Nice — 1 / 2" cheer, and confetti + "🎉 2 / 2 — Good and Easy
  unlocked" when done; the answer side then opens by itself (≈1.4 s, or **See the answer →**) with Good and
  Easy already unlocked: the round's exercise ids (`read:<key>` / `translate:<key>`) are the gate's count.
- Each exercise is a card with its own 🎤 (the rows' take: the live words, then "You said" / Claude's verdict
  — `useSentencePractise` / `rememberSentencePractise`, judged by `sentenceTake` / `sentencePractiseResult`,
  the translate take's online answer check). Result icon + words: **✓ Right**, **≈ Nearly**, **✗ Not quite**
  (border solid / yellow / dashed). A miss offers **🔁 Try again**; he may also move on to another one.
- What it never gives away: the card's own answer shows only as the sentences inevitably do. The question
  stays small at the top (the hanzi on a reading card, the English on a meaning card). A translate
  exercise's Chinese, pinyin and ▶ appear only once it's answered; a read exercise's ▶, pinyin and "Show
  English" only after its attempt.
- **Skip to the answer →** is always there, with one line under it: "Good and Easy stay locked until 2 more
  sentences are right — the sentences on the answer side still count." — the answer side's gate (below)
  keeps the round's count.
- **On the answer side, the round's sentences lead the list** (in the round's order), **opened** (hanzi, pinyin and
  English up — he has seen them) and **outlined in their result's style** with a label: "In the round · ✓ Right"
  (green), "· ≈ Nearly" (yellow), "· ✗ Not quite" (red, dashed on the web), and a neutral "In the round" for ones he
  skipped — icon + words, never colour alone — so he can find them and tap "What's going on here?" / Ask Claude about
  them. Rule: `roundRowMarks` / `orderKeysForRound` (`shared/study/sentenceRound.ts`, Lab `SentenceRound.rowMarks` /
  `orderKeys`, parity-tested); web `SentenceSet` `roundRows`, Lab `SentenceList` `roundMarks`.
- Today is the session: the resume point carries `round_open`, `sentences_right` and `round_log` (the exercises as
  shown + each one's last result: `exercisesFromLog` brings the same ones back), so leaving and coming back shows the
  round (or the answer, with its outlined rows) with what was already right; Undo / a new showing starts afresh.
  Lab: back on the round returns to the question (its count kept).
- Practice only: no review event, no recording kept. Offline the 🎤 is off (transcription needs a
  connection) and the round says so — Skip is the way on.
- Rules: `shared/study/sentenceRound.ts` (`roundSentences`, `pickRoundExercises`, `sentenceRoundOpens`,
  `sentenceRoundProgress` + the words), Lab `core/…/SentenceRound.kt`, parity-tested
  (`parity/fixtures/sentence-round.ts`). Web `components/study/SentenceRound.tsx` (`useRoundSentences`,
  `SentenceRound`) in `StudyCard` (`revealOrRound`); Lab `ui/study/SentenceRoundUi.kt` in `CardStage`
  (`reveal()`). Analytics `study.sentence_round { action: shown | right | miss | retry | skip | done, index,
  mode, got, needed }`. Tests: `SentenceRound.test.tsx`, E2E `study-sentence-gate.spec.ts`, Lab
  `SentenceRoundUiTest`.

### Sentence practice history (which sentences he knows; hide one; more sentences)

Every 🎤 take on an example sentence — in the Sentence round or on the answer side's rows — is recorded:
**sentence, mode (read | translate), result (right | close | wrong), when**. "Stop showing this sentence"
(hide + reason) and "Show again" (unhide) are recorded the same way. Like reviews these are EVENTS, the
truth on every device: written on the device first (web: own IndexedDB `sentence-practice`; Lab: JsonCache
`sentences/practice` + the Outbox), uploaded to `POST /api/me/sentence-practice` (idempotent by client id;
the account's own notes only) and fetched back from `GET /api/me/sentence-practice?since=` in every sync
(D1 `sentence_practice_events`, migration 0138; account deletion removes them). Each device folds a note's
events into per-sentence stats (`sentenceStats`: attempts / rights / misses / last time per mode, hidden).
The sentence key is the set row's id, or `clue` for the note's own sentence.

- **The round picks for him**: each of its four slots (read, translate, read, translate) takes the sentence
  he knows LEAST in that mode — never practised first, then fewest rights, then most misses, then the longest
  ago (`compareLeastKnown`); ties in the list's spread order (the easiest, the hardest and evenly between),
  every slot a different sentence; shown easiest → harder. With no history this is the round as before. The
  picks are made once per showing, so a take never reshuffles the round; what was already right on this
  showing still counts after a reload (`sentenceRoundProgress` with the sentences in rotation).
- **Known** = right 3 times in a mode (`SENTENCE_KNOWN_RIGHTS`).
- **More sentences**: when every sentence left in rotation is known in both modes (translate only where it has
  English), or fewer than four are left, the word asks for more — `POST /api/sentences/top-up { note_ids,
  reason: known | few }` (appends to the set; once a day per word; "few" counts what's left after his hidden
  ones; ≤ 30 in a set) — and the round shows "✨ New sentences coming for this word". Offline the ask waits for
  the next sync.
- **Stop showing this sentence**: long-press a sentence (or its ⋯ in the round; "🙈 Hide" in an open row's
  tools on the answer side) → the sheet with reason chips **🤔 Weird · ❌ Wrong · 🗑 Not useful · 🦄 Too rare** →
  hidden for him at once (never offered in the round, not listed on the answer side, not counted by the gate
  or "more sentences"), with an Undo toast. The answer side list's ⋯ → **Show hidden (N)** lists them with
  **Show again**. Never the homework pass.
- Rules: `shared/study/sentenceHistory.ts` (+ `pickRoundExercises` in `sentenceRound.ts`), Lab
  `core/…/SentenceHistory.kt`, parity-tested (`parity/fixtures/sentence-history.ts`). Web
  `services/sentencePractice.ts`, `components/study/SentenceHideSheet.tsx`, `SentenceRound.tsx`,
  `SentenceSet.tsx`; Lab `data/sentences/SentencePracticeStore.kt`, `ui/study/SentenceHideUi.kt`,
  `SentenceRoundUi.kt`, `Sentences.kt`. Worker `routes/sentence-practice.ts`, `services/sentence-practice.ts`.
  Analytics `study.sentence_hidden { reason, where, unhidden }`, `study.sentence_topup_requested { why,
  queued }`, `server.sentence_practice_events { count }`.

### The gate — Good / Easy wait for two sentences (part of Hard mode)

Hard mode above (Settings → Study → 🎯 Hard mode / the header chip; was the switch "Sentence round before the answer
(2 sentences)", before that "Get two sentences right before Good / Easy"; `settings.change { setting: hard_mode }`)
also keeps the gate: the round's right exercises count here, so two right there arrive unlocked; after giving up
Good / Easy stay locked whatever (`hardModeLock`). With Hard mode on for the card, the regular study session's **reading
(hanzi → meaning) and meaning (meaning → hanzi) cards** keep **Good** and **Easy** locked (🔒, faded)
until two example sentences were said right with the rows' 🎤 on this showing of the card — read or
translate mode both count; "right" = the device's exact / homophone match or Claude's correct /
acceptable; close / wrong don't count; each sentence counts once. **Again** and **Hard** are always
there. A line above the ratings says where he stands — "🎤 Get 2 sentences right to unlock Good · 1/2",
then "✓ 2/2 right — Good and Easy unlocked"; a tap on it scrolls to the sentences, and a tap on a
locked Good / Easy rates nothing, says why and scrolls there too. A card with fewer than two sentences
(the card's own + the set) asks for as many as exist; none → no gate. The count starts again on every
showing (a new showing, Undo). Never the listening card (its sentences are its clues), the homework
pass (Not yet / Got it), the tutor-notes practice or the Try-it previews. Every way of rating goes
through the same check (`handleRate` on the web, the RatingBar callback in the Lab; neither app has
rating shortcuts or auto-advance). Rule: `sentenceGate` / `ratingLockedByGate` / `sentenceGateLabel` in
`shared/study/sentencePractise.ts` (Lab `SentencePractise.gate` …). Analytics `study.sentence_gate
{ action: rated | blocked | unlocked, unlocked, needed, got, card_type }`. E2E
`study-sentence-gate.spec.ts`.

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
level and "Tap anywhere to stop"; the footer swaps the ratings for **⏹ Stop** / **← Back** (see
"No ratings while re-recording" below). A tap anywhere on the card (or Stop) saves the take and turns back to the answer, where it is transcribed as usual
("You said …", live Soniox or the upload) and **the card's own clip plays again** — the reveal's
auto-play (the note's recordings in turn, else its clip; a clip still being made is waited for), once,
with his own take's playback stopped — so the right pronunciation follows straight after his.
Cancelled, or a take that came out empty, plays nothing. Back (the Android back gesture / browser back), Esc or
← Back throws the new take away and the answer comes back with the previous take and its result —
the previous take is replaced only when the new one is saved. Rating, FSRS and the upload are
unchanged; the first Record on the question works as before. Web: `reRecording` /
`renderReRecordPanel` in `StudyPage.tsx` (a history entry is pushed while recording so back
cancels), `useAudioRecorder` `keepPrevious` / `cancelRecording`; e2e `study-record-again.spec.ts`.
Lab: `RecordingAgainPanel` + `BackHandler` in `ui/study/CardStage.kt`, `cancelRecording` /
`keepNewTake` in `StudyViewModel.kt` (`RecordAgainFlipTest`). The replay: web
`replayAfterReRecordRef` in `StudyPage.tsx` (plays when the new take's blob lands); Lab
`recordingAgain` / `playWordAfterRecordAgain` in `StudyViewModel.kt` (`RecordAgainAutoplayTest`).

## Deck pill

The card says which deck it came from with a **📚 deck pill** (web `components/study/DeckPill.tsx`; Lab
`ui/study/DeckPill.kt`) — on the **answer side only**, as a small quiet line under the meaning / word tags
(above Play and the example sentences). Jerome (Oct 2026): "The deck pill is on the question side of the card.
I'd like it smaller and on the answer side." On the question side the deck name can hint the answer, so it is
never shown there (and the question header is just the card-type chip and ⚡). The pill is caption-size (11 px /
`labelSmall`), muted grey, no border, a smaller 📚, one line cut with an ellipsis (≤ 13 rem / 200 dp) so a long
name ("张老师课本 1–2 册补漏 (from tutor)") never crowds the answer. A tap opens a small popover / popup centred
under it with the **full** name and **Open deck →** (the deck page; coming back to Study shows the same card, as
left); a tap elsewhere, Escape / back or a second tap on the pill closes it. Its taps stop there, so it never
peeks back at the question. The tap target is still 44 px / dp tall (invisible padding around the small pill);
its label is "Deck: <full name>". Same on every screen that shows the study card: the session, a homework pass
word and the tutor-notes practice (the Try-it preview has the deck name as its title). Analytics
`study.deck_pill` (`action` expand | open_deck, `where` homework | tutor_notes).

## New characters shimmer

Jerome: "When a card arrives with a character I've never seen before, the character should be
lightly shimmering, so it looks new."

- **Never seen** is the queue's own "New characters first" rule (`shared/decks/novelty.ts`,
  `new-card-order.ts`): seen = the Han characters in the hanzi of every note with at least one
  REVIEWED card, any deck (not the example sentence). A character of the card's hanzi outside that
  set is new. Pure rules: `shared/study/newCharacters.ts` (`seenCharactersOf`, `markCharactersSeen`,
  `newCharactersIn`, `newCharacterMask`, `newCharactersLabel`); Lab `core/…/NewCharacters.kt`,
  parity-tested (`parity/fixtures/new-characters.ts` → `NewCharactersParityTest`).
- **Flashcard session only** (Jerome, Oct 2026: "With the one-off homework from the tutor, it
  probably shouldn't do the shimmering at all. It should really only be in the flashcard section."):
  the regular study session (FSRS cards) shimmers; the **homework pass, the tutor-notes practice and
  Try-it / preview viewers never do**, though they show the same card. One rule for both apps:
  `cardNewCharacters(text, seen, inStudySession)` (Lab `NewCharacters.forCard`, parity-tested) —
  web `StudyCard`'s `inStudySession` (only the Study page's session passes it, never with `pass`),
  Lab `StudyViewModel` (`pass == null && practice == null`).
- **Not loaded is not "nothing seen"**: until the seen set has actually been loaded a card has NO new
  characters (web: a failed IndexedDB load = no shimmer; Lab `seenChars` is null until the queue load
  built it). The homework-pass bug was exactly this — the Lab pass dealt its word before its
  seen-set load had finished, against an empty set, so every character of 第一节课前半小时 shimmered.
  A loaded but EMPTY set (an account with no reviews yet) is real: then everything is new.
- **Once per card**: the seen set is built once per session from what the queue already loads (web
  `getStudyQueue` → `seenCharacters`, kept by `services/newCharacters.ts`, else loaded once from
  IndexedDB; Lab `StudyViewModel.seenChars`, built in the same load as the queue, before any card is
  shown). A card works out its new characters when it is shown (`useNewCharacters` /
  `CardView.newChars`); rating it adds its characters, so the NEXT card with 行 is plain while the
  card on screen keeps its shimmer.
- **Where**: the study card's big hanzi only — the read card's question, the answer side's hanzi
  (the explorer's per-character tap targets unchanged), the correct-answer rows of a typed / spoken /
  multiple-choice answer. Not in sentence rows, chips or the explorer.
- **Look**: a narrow warm band (amber; paler gold on a dark card) sweeps across the glyph every
  3.6 s (the sweep takes the first 45 %, staggered 140 ms per character), with a faint warm glow;
  the glyph keeps its own colour (the gradient is built on it), so green answer boxes stay green.
  Reduced motion (web `prefers-reduced-motion`; Lab: animator duration scale 0, "Remove
  animations") = a static warm tint + the glow. Screen readers: "New character: 行" beside the
  hanzi (web, visually hidden) / the glyph's state "New character" (Lab).
- **Switch**: Settings → Study → "Shimmer new characters" (on by default, per device: web
  localStorage `new-char-shimmer-v1`, Lab `StudyPrefs.newCharShimmerOn`); `settings.change`
  `setting: new_char_shimmer`.
- Web: `components/study/NewCharShimmer.tsx` + `newCharShimmer.css`, `ExplorableText newChars`,
  `StudyPage.tsx`; test `NewCharShimmer.test.tsx`. Lab: `ui/study/NewCharShimmer.kt`
  (`NewCharGlyph`: a `ShaderBrush` band on the Text, `rememberInfiniteTransition`;
  `LocalNewCharShimmerPhase` freezes it for screenshots), `CardStage.kt`, `AnswerMarks.kt`,
  `McGrid.kt`; test `NewCharShimmerTest` (Roborazzi `study-newchar-*`).

## Word tags

Under the meaning on the answer side sits a quiet row of small pills — **metadata about the word,
with no AI**: part of speech (≤ 2: Noun · Verb · Adjective · Adverb · Measure word · Pronoun ·
Question word · Preposition · Conjunction · Particle · Number · Time word · Position word ·
Idiom 成语 · Set phrase · Name …), **Separable verb** (离合词), register (≤ 2: Polite · Formal ·
Literary · Colloquial · Informal · Slang · Rude · Derogatory · Humorous · Euphemism · Dated ·
Regional · Taiwan · Cantonese), **Measure: 本 běn** (≤ 2), **HSK 3** (HSK 3.0, 2021; 7–9 as one
band), how common (Top 100 / 1,000 / 2,000 / Rare — the explorer's decal colours, from the
shipped word-freq list; **an HSK word is never Rare**: the list counts mostly written text, so it
ranks ~3,800 HSK words — 一块儿, 一下儿, 打包… — beyond 10,000 or not at all; they get no
frequency pill instead, the unmarked middle band — `frequencyTier(rank, kind, hsk)`, the same rule
as the explorer's decals) and **Trad. 長得**. A tap on a pill opens a tiny sheet: what it means in
one or two lines, an example (the separable verb's split — 睡了一个好觉 — or 一本书 built from the
word), and where it comes from. The pills are buttons, so they never peek the card. The question
side has none. The same pills (minus how common) head the explorer's Word view.

**Chinese in the sheet is explorable** (Oct 2026 — Jerome on 人性's ✨ Formal sheet: "when it
suggests less formal words, I'd love to click those words … and add them as cards"). Every line of
the sheet — the title (离合词), the body, the AI register note ("use 人品 or 脾气 in casual
speech"), the example (睡了一个好觉, 一本书) — goes through `ExplorableText`, by WORD from the
device segmenter (`shared/chinese/segment.ts`: web `useSegmentedWords`, Lab `DeviceWords`; by
character until its lists are loaded), dotted / underlined, with a hint line "Tap any Chinese word to
explore it or add it as a card." A tap opens the language explorer on it (source `word_tag`) where
+ Add as card / ⚡ Study it today / Open card already are; the sheet steps aside and comes back
when the explorer closes (✕ / back) so the next suggested word is one tap away (web
`ExplorerOpenOptions.onClosed`, Lab: waits for `ExplorerController.isOpen` to fall). Opened from
the explorer's own Word view, a tap pushes onto the stack instead and the sheet stays closed (back
returns to the Word view). Analytics `study.word_tag_word` (kind, tag_source, item, inside). Web
`components/wordTags/WordTagPills.tsx` (`SheetChinese`), Lab `ui/study/WordTagsUi.kt` (`SheetText`).

A sentence or phrase card gets only what applies: "Phrase" for 2–6 Han characters that aren't a
dictionary word (not for a card ending in 。？！ or with a comma), and the register words found in it
(您, 请问, 贵姓, 啥, 干嘛…, and 请 only at the start of a clause — 请坐, not 申请).

**Settings → Study → "Word tags on the answer"** turns them off (on by default, per device: web
localStorage `word-tags-on-answer-v1`, Lab `StudyPrefs.wordTagsOn`).

**Data** (`shared/data/word-tags/word-tags.txt`, ~45,000 words and characters, ~580 kB / 250 kB
gzipped; sources and licences in its README): part of speech from HanLP's CoreNatureDictionary
(Apache-2.0, corpus tag counts; a second part of speech only with ≥ 20 % of the first's count) with
jieba (MIT) for words HanLP lacks; register, measure words, idioms and traditional forms from
CC-CEDICT — register only from the FIRST sense of a word of 2+ characters, and only what every
common reading shares (single characters' first senses are often archaic: 派 "(literary) tributary");
HSK levels from complete-hsk-vocabulary (MIT); separable verbs and the register of everyday
polite / informal / slang / rude words curated in `shared/cards/word-tags-curated.ts`. HanLP's
"intransitive verb" tag is deliberately NOT used — it marks 喜欢, 叫, 从事 and 停 intransitive — so
transitivity is never shown; the separable-verb sheet says they take no object. Built by
`npm run build:word-tags` (`scripts/build-word-tags.ts`, rules in `shared/cards/word-tags-build.ts`).
Web: loaded lazily as a precached chunk (`services/wordTags.ts`), works offline. Lab: the same file
as a core resource.

Rules: `shared/cards/word-tags.ts` (`wordTags`, `wordTagExplanation`; Lab `core/…/cards/WordTags.kt`,
parity-tested over the shipped file by `android-lab/parity/fixtures/word-tags.ts`). Web
`components/wordTags/WordTagPills.tsx`; Lab `ui/study/WordTagsUi.kt`. Event: `study.word_tag_open`
`{ kind, tag, source, tag_source: lexicon | ai }`; the switch: `settings.change { setting: 'word_tags' }`.

### AI tags (✨)

What the lexicon can't say — whether a verb takes an object, a register for the many words it
has no label for, and whether a word is everyday spoken Mandarin — comes from a cheap AI pass per
note, stored on the note (`notes.word_tags`, JSON `{ v, transitivity?: transitive | intransitive |
both | n/a, separable?, register?: formal | neutral | informal | polite | rude | slang | literary,
register_note? (≤ 60 chars), spoken?: everyday, spoken_confidence?: high | medium | low,
confidence: high | medium | low }`) and synced to the devices like everything else on a note, so it
works offline. `v` is `WORD_TAGS_AI_VERSION` (2 since Everyday speech).

Shown only where the lexicon has nothing, and marked: the pill carries a small ✨ and its sheet says
**"Suggested by AI — may be wrong"**, plus the register note ("formal written; in speech use 告诉").
- **Transitivity** — "Takes an object" / "No object" / "Object optional" — only for a verb (the
  lexicon says Verb, or has no part of speech for the card) and never for a sentence; placed after
  the part of speech. `n/a` shows nothing.
- **Register** — Formal / Polite / Informal / Slang / Rude / Literary, the lexicon's own colours —
  only when the lexicon gave the card no register (it always wins); `neutral` shows nothing.
- **Separable verb** from the AI only when the lexicon doesn't already say so (no split example).
- **Everyday speech** (v2) — a word a learner would HEAR regularly in daily life (restaurants,
  shops, transport, home, chatting), not merely one that exists in speech: 结账 (jiézhàng, settle
  the bill) is everyday restaurant talk but ranks ~29,000 in the written-text frequency list, so it
  used to say "Rare". Shown only at **high** `spoken_confidence` (its own confidence; the overall
  `confidence` is about transitivity and register), never on a sentence. It **drops the "Rare"
  pill** and shows "✨ Everyday speech" where the frequency pill was — but only where the list
  doesn't already call the word common (no Top 100 / 1,000 / 2,000 pill: on 吃饭 it would add
  nothing). Its sheet: "A word you'll hear all the time in daily life … that's why this card isn't
  marked Rare." The explorer's tiles aren't notes, so their decals follow only the HSK rule.
- **Low confidence is never shown**; a note the model said nothing about is stored as
  `{ v: 2, confidence: 'low' }` (done, nothing shown).

Rules: `shared/cards/word-tags-ai.ts` (`parseAiWordTags`, `mergeAiWordTags`, `wordTagsWithAi`,
`explainWordTag`; Lab `core/…/cards/WordTagsAi.kt`, parity-tested by
`android-lab/parity/fixtures/word-tags-ai.ts`). The pills take the note's `word_tags` on the answer
side and, in the explorer's Word view, the learner's own card of that word.

**Making them** (`worker/src/services/word-tags-ai.ts`): one Haiku call per 40 notes (forced
`tag_words` tool, thinking off), on `card-check-queue`. A note is tagged when created and re-tagged
when its hanzi or English changes (same trigger points and skips as the word check, for every
account); a tutor's copy carries the source's tags. Existing notes fill themselves: every
`/api/sync/changes` queues up to 200 of the user's untagged notes an hour (newest first, looked for
at most every 15 minutes). **Version bumps re-tag**: a note whose verdict has an older `v` (or none,
or unreadable JSON) counts as untagged (`needsWordTagsSql`), so bumping `WORD_TAGS_AI_VERSION`
makes the same fill redo every note — never-tagged notes first, then the outdated ones, newest
first; the old verdict keeps showing until the new one replaces it, and `updated_at` is never
touched (`word_tags_at` carries it to the devices). Progress reports `outdated`. On demand:
`POST /api/notes/word-tags/backfill { limit }` / MCP `backfill_word_tags` (progress + cost). Cost:
v1 measured ≈ $0.22 per 1,000 notes; v2 (the `spoken` field in the prompt and every verdict) is
estimated at ≈ $0.26 per 1,000, ~$1.50 for 5,600 (`estimateWordTagsCost`) — so the re-tag of every
existing note costs about that once. Real token use is kept per user in `word_tag_runs` and reported
as `server.word_tags_batch` (with `everyday` = notes called Everyday speech).

## Pictures on cards

One optional picture per note (migration 0123; rules `shared/cards/note-image.ts`, Lab
`core/…/cards/NoteImage.kt`, parity-tested by `android-lab/parity/fixtures/note-image.ts`). Asked
for by Jerome's tutor: "Can images be generated for the words in a deck?"

**Where it shows** — the picture depicts the MEANING, so it may never give away the answer of a
card that tests the meaning:

| Card | Question side | Answer side |
|------|---------------|-------------|
| meaning → hanzi | ✅ with the English (picture + English = the clue) | ✅ |
| hanzi → meaning | — (it would be the answer) | ✅ under the meaning |
| audio → hanzi | — | ✅ under the meaning |

Modest on the card (at most ~a quarter of the screen height, so the answer row stays on a folded
Pixel's screen); a tap shows it big (`card.picture_open`). Settings → Study → "Show pictures on
cards" (on by default, per device: web `services/noteImages.ts` localStorage, Lab
`StudyPrefs.picturesOn`). The same rule on the homework pass (it uses the study card), Try it
(`/decks/:id/try`), a thumbnail on the deck page rows and the card hub.

**Generated pictures** (`worker/src/services/note-images.ts`): the prompt is built from the note's
English (+ the card sentence's translation to pin the sense) in one friendly picture-book style,
with NO writing — the Chinese is left out of the prompt on purpose so the model can't paint it.
Prompts are hashed; `note_images` keeps one row per hash, so the same word asked by a tutor, her
students' copies or another account is drawn ONCE. Asking marks the note `image_status =
'pending'` and queues the hash on **`image-generation-queue`** (`{ kind: 'note_image' }`, never
blocking); when it is drawn every note waiting for that hash gets it. 3 attempts with a growing
delay, then `failed` (Regenerate tries again); a pending row older than 15 min is re-queued the next
time anyone looks. Regenerate = a new variant (a new hash). About **$0.04–0.07 a picture**
(`NOTE_IMAGE_COST_USD` = 0.07 is the upper estimate the apps show). E2E_TEST_MODE draws a fixed fake
PNG inline (`fakeNoteImage`).

**Entry points**: the card editor's **Picture** section (web `components/noteImage/NotePictureSection.tsx`
in `CardEditModal` + the card hub; Lab `ui/cards/NotePictureSection.kt` in `NoteMediaSections` + the hub):
✨ Generate picture / ↻ Regenerate, 📷 Take photo, 🖼 Choose photo (square crop sheet → ≤ 800 px JPEG made
on the device, EXIF stripped again by the server), Remove — saved at once, not with the form's Save.
The deck ⋯ menu → **🖼 Illustrate this deck** (cost first — "24 pictures · about $1.68" — then every card
without a picture; progress while open; closing never stops it) and the deck's **"Illustrate new cards
automatically"** switch (`decks.illustrate_new`, off by default: each picture costs money). Not
automatic otherwise. MCP: `illustrate_deck` (`dry_run` for the estimate) / `illustrate_note`.

**Sync, copies, deletion**: picture writes touch `notes.image_at`, never `updated_at` (the tutor →
student copy rules compare it); `/api/sync/changes` returns notes by `image_at`. Pictures ride the
offline prefetch (`/api/audio-manifest` lists them; Lab `NoteImages.Sync` downloads after each sync).
A student's copy shares the tutor's key: a copy made while the picture is drawn waits on the hash; a
later picture / change / removal follows to copies still showing the OLD picture (or none) — a
student's own upload is never replaced; "Update their copy" fills copies without one. An R2 object is
deleted only when no note references it (`note-images/` generated + collectable, `note-uploads/`
person-made; both in `STORAGE_PREFIXES`). Events: `card.picture_generate | upload | remove | open`,
`deck.illustrate`, `deck.illustrate_new`, `settings.change { setting: card_pictures }`.

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

- **Voice first.** The question opens on ONE row of the app's own buttons where the read card's
  Show answer / 🎤 Record row sits (same height, corners and type): **✏️ Type** and **👁 Show
  answer** small on the left, the wide primary **🎤 Say it** on the right taking the rest — no
  answer box and no keyboard on card show. ✏️ Type switches THIS card to the box (focused, keyboard
  up) with the small 🎤 beside it as before; the next card is voice first again. 👁 Show answer
  reveals without answering. While speaking the live transcript shows above the row and the row
  turns into **✕ Cancel** + a red **⏹ Stop** (the read card's Stop recording), "Finishing…" until
  the transcript is final; a listen card's floating 🔊 steps aside. A resumed card with an answer in
  the box, or a transcript sent to the box by ✏️ Edit (below), shows the box. **Offline** (no live
  transcription) the box comes first with the 🎤 dimmed, as before. Accessibility labels "Say it" /
  "Type the answer" / "Show answer". Web `renderTypingActions` `typingMode` (`.study-voice-first`,
  `.study-voice-row`: `.btn .btn-secondary .study-voice-side` + `.btn .btn-primary .study-voice-say`);
  Lab `CardStage` `typingMode` / `VoiceFirstControls` (the kit's `SecondaryPill` / `PrimaryPill`, 60dp
  like `RecordControls`); e2e `study-speak-answer.spec.ts` "voice first", Lab `SpokenAnswerUiTest`.
- **Tap 🎤** → the SAME recorder and live Soniox stream as a read card's take (web
  `useAudioRecorder` + `LiveTranscriber`, Lab `VoiceRecorder.startLive` + `SonioxStream`); the box
  turns into the live transcript — confirmed text in ink, the provisional tail grey (the
  transcriber's `onUpdate`). **✕ Cancel** throws the take away and fills nothing. A listen card's
  clip is stopped first so it doesn't play into the microphone.
- **Tap ⏹ → the review step** (the read cards' record → stop → check-or-re-record, for a spoken
  answer): the card stays on the question and shows what he said, big and clear — the transcript in
  the card's hanzi style (web `.hanzi` / `.hanzi-large` by length; Lab `studyHanziSize`, capped) with
  the device's pinyin under it (`devicePinyinLine`: the app's one automatic pinyin + the 一 / 不 tone
  changes) — as read-only text, not a box: nothing is focused, no keyboard, nothing checked yet. The
  bottom row becomes, in the same buttons: **🔁 Retry** and **✏️ Edit** small on the left, the wide
  orange **✓ Submit** on the right.
  - **✓ Submit** checks the transcript with the spoken rule (`checkSpokenAnswer`) and turns to the
    answer, the card's audio playing as on any reveal.
  - **🔁 Retry** records again (back to listening; a listen card's clip stops first); the new take
    replaces this one.
  - **✏️ Edit** only on tap: the transcript goes into the answer box, prefilled, focused with the
    cursor at the end, keyboard up; Check / Enter submits it — in spoken mode while it is still
    exactly the transcript, as typed once changed (#570's rule).
  - A take that gave nothing: "Couldn't transcribe — tap to retry" (the same take, upload) or
    "Didn't catch anything — tap Retry to try again, or type it", with **✏️ Type** small and the wide
    **🔁 Retry** — no Submit.
  - **Settings → Study → "Skip the review — submit spoken answers as soon as I stop"** (OFF by
    default; per device) checks it at once instead — the path before the review step existed. It is
    the old "Submit spoken answers automatically" switch under its old key (web localStorage
    `spoken-answer-auto-submit-v1` `'1'`, Lab `StudyPrefs.spokenSkipReview` = SharedPreferences
    `spoken_auto_submit`), which both apps only ever wrote when it was flipped: a device that never
    touched it has no value and gets the review; a choice made on purpose is kept (on = skip, off =
    the review, which replaced "only fill the box").
  - Web: `SpokenAnswerController` `phase: 'review' | 'editing'`, `submit` / `edit` / `retake` /
    `submitEdit`, `onResult({ text, transcript, submit, again, reviewed })`; `renderSpokenReviewText` /
    `renderSpokenReviewRow` / `renderSpokenFailedRow` in `StudyPage.tsx`; unit `spokenAnswer.test.ts`
    "the review step", `spokenAnswerPrefs.test.ts`, e2e `study-speak-answer.spec.ts`. Lab:
    `SpokenPhase.REVIEW` / `EDITING`, `StudyViewModel.submitSpokenAnswer` / `editSpokenAnswer` /
    `retakeSpokenAnswer` / `submitEditedSpokenAnswer`, `SpokenReviewControls` / `SpokenFailedRow` in
    `CardStage.kt`; `SpokenAnswerTest`, `SpokenAnswerUiTest`.
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
  **right by sound**: the answer in green and "You said 油" with 油 marked yellow and "✓ Sounded right —
  written differently". The same syllables with other tones is **close** — still wrong ("≈ Close —
  tones off", the characters marked red). Exact hanzi = right, as typed. Edited after speaking = a typed answer again.
  The expected answer is never sent to Soniox (no context) — it would bias recognition.
- **Said inside a sentence** (`contains`, the read card's rule — Jerome said 他长得很好。 for
  长得 and got every character red): a spoken answer that CONTAINS the answer is right, exactly like
  the read card's yellow "Contains the answer" (the "You said" row's ≈ chip). `spokenAnswerWithin`
  (`shared/cards/answer.ts`, Lab `AnswerKey.answerWithin`, parity-tested) finds it either by hanzi —
  the answer's (or an alternative's) answer key as one contiguous stretch of the transcript's
  (numbers → hanzi, 两 → 二, punctuation / spaces dropped, common traditional characters →
  simplified) — or by sound: a contiguous window of the transcript's syllables (per character, the
  app's automatic pinyin + 一 / 不) equal to the answer's, the alternatives' or the note's written
  pinyin. A **one-character answer counts too** (好 in 我今天很好, 由 inside 由我负责 — and, by sound,
  游 in 我想去游泳), as on the read card. **Neutral tones**: a neutral syllable of the answer (得 de
  in 长得 zhǎng de — pinyin-pro reads 他长得很好 as … dé …) matches that syllable in any tone, in the
  window and in the whole-answer `sound` check; an all-neutral answer (吗 ma) gets no allowance (妈
  is not 吗), nor does pinyin written without any tone mark. The read card's `compareTranscription`
  (web) / `Transcription.compare` (Lab) uses `spokenAnswerWithin` too, so both card types follow one
  rule (it also feeds the worker's recording check). Typed (keyboard) answers keep exact matching.
- **The spoken result on the answer side — the answer once, ONE compact "You said" row** (Oct 2026;
  Jerome: "it takes way too much of the screen; my wrong answer is shown twice, the correct answer
  twice, and the correct answer is disconnected from its pinyin"). A spoken answer on a typing card
  (and 🎤 Say it practice) shows, top to bottom: the card's answer big (green when the verdict counts,
  ink otherwise — the card's border colour is unchanged), its own pinyin directly under it, the
  meaning, then ONE row attached under the meaning:

      ( ▶ )  You said 朗 lǎng  [≈ Close — tones off]  ( ✎ )

  ▶ plays the take (`study.you_said_play`), then what was said (hanzi, its automatic pinyin small),
  the verdict chip and ✎ Open in Coach (Check my sentence; every state but a plain match). No second
  copy of what was said, no ↓ arrow diff, no "Close" pill, no separate box. The row's rule is shared:
  `shared/cards/spoken-result.ts` (`spokenResult`, `spokenResultLabel`; Lab core
  `SpokenAnswerResult`, parity-tested in `parity/fixtures/spoken-answer.ts`) — five states with their
  own icon + words: **✓ Match** (exact / punctuation / equivalent / alternative), **✓ Sounded right —
  written differently** (`sound`: still a tick — he SAID it right), **≈ Contains the answer**
  (`contains`), **≈ Close — tones off** (`close`, wrong), **✕ Didn't match** (`wrong`); green, yellow
  (the partial token) or red. Each character of the transcript is marked (lined up with the answer by
  longest common subsequence, so words around it never push everything red): **written differently**
  (`sound`: 友 said for 有) = YELLOW highlight + dotted underline; **not in the answer** (close / didn't
  match: 朗 for 狼) = red + solid underline; in `contains` the answer's characters stay ink and the
  words around it quiet; punctuation is never marked. A screen reader hears the whole row as one
  sentence: "You said 朗 (lǎng). Close — the tones are off. Not in the answer: 朗." Space: Jerome's
  狼 / 朗 card's answer block went from 499 to 305 px above the Play row on the web (412 px wide) and
  from 552 to 384 dp in the Lab app. Typed answers keep the character diff (`AnswerDiff`), minus its
  own pinyin line under an exact answer — the card's pinyin follows right under it, so it was shown
  twice. Web: `YouSaidRow` in `components/study/YouSaid.tsx` (`.spoken-result*` in `StudyPage.css`),
  `spokenBack` in `StudyPage.tsx`; Lab: `SpokenResultRow` in `ui/study/YouSaidBox.kt`, `CardBack` in
  `CardStage.kt`. The read card's "You said" box (`YouSaid` / `YouSaidBox`) is unchanged. Tests: unit
  `spoken-result.test.ts`, `YouSaid.test.tsx` (`YouSaidRow` per state); e2e `study-speak-answer.spec.ts`
  ("狼 said 朗"); Lab `SpokenAnswerParityTest`, `SpokenAnswerUiTest`, `SpokenResultRowTest`, Roborazzi
  `SpokenResultScreenshots` (`study-spoken-result-*`, light + dark).
- **The read card's "You said" box** (web `components/study/YouSaid.tsx` `YouSaid`; Lab
  `YouSaidBox.kt`): green "✓ Match", the yellow "≈ Contains the answer", red "✕ Didn't match".
  **Design** (Oct 2026, "less janky"): what he said is the hero — the
  hanzi (22 px) with the pinyin under it — and "You said" + the verdict chip (icon + short label in the
  tone's colour) sit small above it; a softly tinted 14 px rounded box in the theme's success / warning /
  error colours (light and dark). Round 44 px buttons sit in EQUAL side columns, so the text stays centred:
  **▶ Play my recording** on the left of a read card's box (the take it was transcribed from; analytics
  `study.you_said_play`) and **✎ Check in Coach** on the right of the yellow box. "Transcribing…" (three
  pulsing dots), "Recording saved, will transcribe when online" and "Couldn't transcribe · Tap to retry"
  (↻ circle on the left, the whole box is the button — also the say-it flow's retry) are the same shell
  with the same minimum height (88 px), so the result replaces them without a jump. Tests: unit
  `answer.test.ts`, `useTranscription.test.ts`; Lab `TranscriptionTest`, `YouSaidBoxUiTest`.
- **"Partly right" is YELLOW, never orange** (Oct 2026, Jerome is red / green colour-blind: the dark
  orange "Contains the answer" chip read as the red "Didn't match"). One partial colour per app — web
  `--color-partial` / `-soft` / `-strong` / `-ink` (index.css, a dark set under `data-theme="dark"`),
  Lab `Palette.Partial*` — used by the "You said · ≈ Contains the answer" box (lemon border + pale lemon
  tint, a SOLID lemon chip and ▶ / ✎ circles with dark brown words / icons: #713f12 on #fde047 = 6.9:1;
  dark theme: the chip stays solid lemon with #422006, the circles a lemon wash with lemon icons) and the
  spoken result row's "≈ Close — tones off" and characters "written differently". Every verdict also
  differs without colour: ✓ Match · ≈ Contains the answer · ✕ Didn't match (`YOU_SAID_VERDICT_ICON` /
  `youSaidVerdictIcon`; the spoken row's `SPOKEN_RESULT_ICON`).
  Tests: `YouSaid.test.tsx` (class + icon + words per state), Lab `YouSaidBoxScreenshots`, `YouSaidBoxUiTest`.
- **🎤 Say it again** (answer side, beside Play — Record again's place on a read card; only when the
  answer on the back was spoken): Record again for a spoken answer. The card turns back to the
  question with the mic live and the live transcript in the box's place ("Tap anywhere to stop"; ⏹
  Stop and ← Back in the footer); the previous answer / verdict is out of sight meanwhile. When the
  take ends it goes through **the same review step**, still on the question side (🔁 Retry stays a
  say-again; ✏️ Edit turns the transcript into a box there, focused, and ✓ Check submits it; ← Back /
  back keeps the first answer), unless "Skip the review" is on. Submitted, it is checked with the spoken rule
  (`checkSpokenAnswer`; as typed when edited) and the card turns to the answer with the NEW verdict
  and "You said". The new take replaces the previous one (the review event is
  written at rating time, so the latest answer and take are what is saved), and the card's own
  clip plays once the same way as after Record again (#556: his own take's playback stops first; a
  clip still "Audio coming…" is waited for by the reveal's auto-play; never twice; nothing plays on
  the review). ← Back / back / Esc drops the new take: the previous answer, verdict and take stay
  (a rating made meanwhile would do the same, but the footer shows no ratings then). A take that
  gives nothing stays on the question ("Couldn't transcribe — tap to retry · Or go back to your
  first answer" / "Didn't catch anything — tap Retry to try again") with a wide 🔁 Retry; ← Back
  goes back. An edited say-again answer is a typed
  answer, so it has no Say it again. Offline the pill is dimmed
  and a tap says "Saying it again needs a connection." Typed answers have no Say it again. Web:
  `SpokenAnswerController.start({ again: true })` (`keepPrevious`, `restorePrevious`), `useSpokenAnswer`
  `startAgain` / `keptTake`, `renderSayAgainPanel` + `sayingAgain` in `StudyPage.tsx` (the Record
  again peek flip and history entry); unit `spokenAnswer.test.ts`, e2e `study-speak-answer.spec.ts`
  "say it again". Lab: `StudyViewModel.sayAgain` / `takeBeforeSayAgain` (+ `playWordAfterRecordAgain`),
  `SpokenUi.again` / `SpokenResult.again`, `SayAgainPill` / `SayAgainPanel` in `CardStage.kt`;
  `SayItAgainTest` (ViewModel, fake recorder + transcriber), `SayItAgainUiTest`.
- **No ratings while re-recording** (Jerome, Oct 2026: "a few times I've accidentally clicked the
  rating buttons instead of going back"). While a take is made AGAIN on the answer side — a read
  card's 🎤 Record again, a typing card's 🎤 Say it again, the 🎤 Say it practice — from the mic
  opening to Submit / Back (recording, finishing, the review, ✏️ Edit, "Couldn't transcribe"), the
  card's footer shows **no Again / Hard / Good / Easy and no Ask Claude · Edit card · ⋯ row**: the
  re-record's controls take their place, once (the card above only shows what is going on — time +
  level, the live transcript, the review's hanzi + pinyin, the Edit box, the retry box). Bottom row,
  where the ratings were: the big primary — **⏹ Stop** (Record again: "Starting…" until the mic is
  open), "Finishing…", **✓ Submit** on the review, **✓ Check** while editing (dimmed while empty),
  **🔁 Retry** after a take that gave nothing. Above it: **← Back** (= the answer side as it was,
  previous answer + take kept) with **🔁 Retry · ✏️ Edit** on the review (no Edit in practice) and 🔁
  Retry while editing. The ratings come back after Submit / Check, Stop (Record again: the take is
  then transcribed on the answer side as usual) or Back. The footer is sticky and the page resizes
  with the keyboard (`interactive-widget=resizes-content`; Lab `imePadding`), so with ✏️ Edit's box
  focused the bar sits above the IME. A homework pass gets the same bar instead of Not yet / Got it.
  The first take on the question side is unchanged (no ratings there anyway). Web:
  `components/study/ReRecordBar.tsx` (`ReRecordBar`, `StudyCardFooter`; `reRecordBar` in
  `StudyPage.tsx`), unit `ReRecordBar.test.tsx`, e2e `study-record-again.spec.ts` +
  `study-speak-answer.spec.ts`. Lab: `ReRecordBar` / `ReRecordStep` in `ui/study/CardStage.kt`
  (`RecordAgainFlipTest`, `SayItAgainUiTest`).
- **The recogniser's trailing 。 on a word card** (撤销。 / chè xiāo。): `tidySpokenTranscript(transcript,
  answer)` (`shared/cards/answer.ts`, Lab `AnswerKey.tidySpokenTranscript`, parity-tested in
  `spoken-answer.ts`) drops trailing sentence punctuation from what was said when the card's answer
  doesn't end in punctuation — on the review (hanzi + pinyin), in the answer it submits (so it checks
  `exact`, not `punctuation_only`) and in the read card's "You said". A sentence card ending in 。 / ？
  keeps it.
- **🎤 Say it — practice after Show answer** (answer side, beside Play; only when 👁 Show answer
  revealed the card with nothing typed, said or picked): Jerome wants to say the word in situ even
  when he didn't know it. It runs the Say it again flow (question side, live transcript, ⏹, the
  review — without ✏️ Edit, since it is shown as said — 🔁 Retry, ✕ Cancel), and the result is
  shown ONLY as the compact "You said" row under the meaning (the spoken result above), checked with
  `checkSpokenAnswer` (✓ Match / ✓ Sounded right / ≈ Contains / ≈ Close / ✕ Didn't match). It is never the card's answer: no
  verdict, no diff, no glow, `user_answer` stays empty and the rating buttons work as usual
  (revealing already says he didn't know it). The pill then reads "Say it again" (practice) and can
  be used any number of times; the card's clip plays once after each, like Say it again. **The
  recording**: the take is the recorder's current take, so it goes up with the review event as
  `recording_url` exactly like a read card's take (the latest one; a cancelled practice keeps the
  one before it) — the tutor hears it in the recordings inbox. Offline: dimmed, "Saying it needs a
  connection." Web: `start({ again: true, practice: true })` / `useSpokenAnswer.startPractice`,
  `practiceSaid` + `canSayPractice` in `StudyPage.tsx`; unit `spokenAnswer.test.ts` "Say it"
  practice, e2e `study-speak-answer.spec.ts` "Say it practice". Lab: `StudyViewModel.sayItPractice`,
  `SpokenUi.practice` / `SpokenResult.practice`, `practiceSaid` + `SayAgainPill(practice = true)` in
  `CardStage.kt`; `SayItAgainTest` (practice), `SayItPracticeUiTest` (+ Roborazzi `study-practice01…05`).
- **✎ Check in Coach on the yellow "You said" box** (`contains`: he said a whole sentence around the
  answer — read cards, spoken answers on the typing cards and Say it practice alike; ✏️ Check until Oct
  2026): a round 44 px button in the box's right column (tooltip / long-press label "Check in Coach";
  the left column is ▶ or kept empty, so the text stays centred) opens the
  hanzi he said in the Sentence Coach straight into ✏️ Check my sentence (`/coach?text=…&action=check`,
  `coachDeepLinkAction`; Lab `Routes.coach(text, action = "check")`), so he sees whether his sentence
  was actually good. Back to your card returns to the same card as it was — the ⋯ → Sentence coach
  resume path, plus the card's in-memory extras: the read card's "You said" for that take (not
  transcribed again), a spoken answer's transcript (still checked in spoken mode) and the practice
  transcript (web `services/studyResume.ts` `ResumeExtras`; Lab `CardStartState.spokenText` /
  `practiceSaid` via `StudyViewModel.onCardSpoken`). Offline the coach opens with the text in the box.
  On the spoken result row ✎ shows for every state but a plain ✓ Match; the read card's green / red
  boxes have no button. Analytics `study.you_said_coach` (card_type, source = read |
  spoken | practice). Tests: e2e `study-speak-answer.spec.ts` "yellow You said box"; Lab `YouSaidCoachUiTest`.
- Analytics: `study.answer_spoken` (result submitted / filled = ✏️ Edit / retaken = 🔁 Retry on the
  review / failed / empty / cancelled, via, live_error, speech_ms, ms, auto_submit = "Skip the
  review", retry = a Say it again, reviewed = went through the review, edited = ✏️ Edit, practice =
  "Say it" practice; a reviewed take is reported when he decides) and `study.spoken_answer_checked`
  (verdict, retry, reviewed, practice).

## Voice-first text boxes (say it, or type it — everywhere he would type)

The typing cards' flow above, without the card, as one reusable box: web
`components/voice/VoiceTextInput.tsx` (+ `hooks/useVoiceDictation.ts`, which drives the SAME
`SpokenAnswerController`, live Soniox stream, upload fallback and "Couldn't transcribe — tap to retry"),
Lab `ui/kit/VoiceTextField.kt` (+ `VoiceDictationController.kt`, the same `VoiceRecorder.startLive` /
`SonioxStream` / `TakeTranscription`). The rules are ONE pure module, `shared/voice/dictation.ts`
(Lab `core/…/VoiceDictation.kt`, parity-tested by `parity/fixtures/voice-dictation.ts`):

- **Voice is the default, always** (Jerome: "the default should be speaking") — nothing remembers that he
  typed last time. Idle: ✏️ Type · wide 🎤 Say it. Listening: ✕ Cancel · red ⏹ Stop, the words streaming in
  (confirmed black, provisional grey). Then the **review**: what was heard, big (hanzi + the device's
  pinyin), 🔁 Retry · ✏️ Edit · ✓ Submit (the caller's label, e.g. Check) — no keyboard until Edit / Type.
- **Typing**: the normal box (input or textarea) with a 🎤 beside it to go back to speaking; text typed
  before the 🎤 stays, the take is joined onto it (`joinDictation`).
- **Speaking off** → typing with a short reason under the box (`voiceBlockReason`): offline (no 🎤),
  microphone blocked / not found / wouldn't open (🎤 kept to try again), unsupported browser. Never a dead end.
- **What Submit sends**: `{ text, source, transcript }` — `source` = `spoken` (submitted as heard, or ✏️ Edit
  left unchanged), `edited`, `typed` — so an exercise can be lenient with a spoken answer and record it.
- Language hints: `zh` first (default) or `en` first for an English answer (`dictationLanguageHints`).
- Analytics: `voice_input.used` { surface, outcome, via, live_error, speech_ms, ms, blocked } — enums and
  durations only, never the text.

**Where it is used — mini lessons** (`lesson-exercises.tsx`, `practice-exercises.tsx`; Lab `ui/lessons/`):
translate and listen & translate (Check reveals the reference; a quiet "Show answer" still skips answering;
listen & translate hears English first), sentence making typed (Check sends what was said to Claude's
sentence check), write_typed, dictation with `input: type`, and the conversation exercise's written
questions. write_handwriting and the stroke pad are unchanged. **Checking**: typed or edited text is
checked exactly as before (`diffHanzi`); an UNCHANGED spoken answer to write_typed / dictation also counts
when it is right by the spoken rule (`lessonSpokenCheck`, shared/lesson/spoken-check.ts → `checkSpokenAnswer`:
a homophone the recogniser wrote, the answer said inside a sentence — as on the typing cards, #584), shown
as "✓ Correct (spoken)" with "Sounded right ✓ — written 图书馆"; the translate exercises' green nudge says
"✓ Sounds right". The attempt keeps how it was given (`ExerciseAnswer.input`: spoken / edited / typed),
and the tutor's attempt review labels it "🎤 Said" / "🎤 Said, then edited" (`answerInputLabel`).

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

(When the tutor also recorded how it should sound, the note has "▶ <tutor> says it" · "▶ You" under it —
her model recording next to his own take, cached for offline; docs/RECORDING_REVIEW.md "Model recordings".)

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
