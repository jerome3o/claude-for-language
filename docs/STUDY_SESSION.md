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

## Session Completion

A session ends (shows "All Done!" screen) when:

- **All learning cards have graduated** - Their next review is tomorrow or later (moved to REVIEW queue with 1+ day interval)
- **AND no new/review cards remain** - Daily new card limit reached, all review cards done

The session does NOT end when:
- Learning cards are on cooldown but due today - these are shown immediately to continue drilling
- There are still new cards within the daily limit
- There are review cards due today

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

- **New cards per day** (blue): Configurable per deck (default: 20). Reserved for cards of unseen notes, preferring the hanzi_to_meaning card so a brand-new word is introduced by its characters first.
- **Secondary cards per day** (purple): Configurable per deck (default: 10), additive to the new card limit. Reserved for NEW cards whose note already has at least one reviewed card (e.g. meaning_to_hanzi after hanzi_to_meaning is in circulation). Without this quota, a steady inflow of brand-new words would consume the entire daily limit and the other card types of started words would never be introduced.
- **Review cards**: No limit - all due reviews are shown
- **Learning cards**: No limit - always shown when due

The two new-card budgets are complementary: leftover primary (blue) budget can admit secondary cards when no unseen notes remain, so with no unseen notes both numbers draw from the same pool. Secondary cards studied beyond their own quota count against the primary budget.

When the daily new card limit is reached, the "All Done!" screen offers a **"Study More"** button to add 10 bonus new cards.

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

5. "All Done!" screen appears
```

## Edge Cases

### All cards are learning cards on cooldown
If the only remaining cards are learning cards with cooldowns (e.g., all due in 5 minutes), they are shown immediately rather than making the user wait. The user can keep drilling until they graduate.

### Single learning card remaining
The same card is shown immediately and repeatedly, even if just rated, until it graduates. No cooldown wait screen — the user prefers to drill continuously in one sitting. Each rating updates the card's state, causing the UI to reset for a fresh review.

### Offline behavior
All session logic works offline. Reviews are stored locally and synced when connectivity returns. The "Ask Claude" feature gracefully fails when offline.

## Card back layout

The back of a card is deliberately short: hanzi · pinyin · (tutor note) · meaning ·
**Play** · **Record again** · the card's own sentence (two quiet lines) · one action row
**Ask Claude · Sentences · ⋯** · the four ratings (64px tall). Everything else is still
available under **⋯** (a bottom sheet, `components/study/StudyMoreMenu.tsx`): edit card,
generate fun fact, regenerate audio, new voice, roleplay, play my recording, debug info
(only with the Debug Console flag on) and the "Added <date>" line. Nothing was removed —
usage will tell what to cull. *Sentences* opens the full `SentenceSet` list (progressive
reveal, audio, generated set) in place of the two-line clue.

On the unfolded Fold (≥ 700px) the whole card column is capped at 640px and centred.

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

## Ending a session

✕ ends the session immediately when nothing has been reviewed yet. After at least one review
it shows the session recap and asks "End session?" (`components/study/ExitSessionModal.tsx`).

## Tutor notes on recordings

When a tutor marks one of the student's recordings *needs work* with a comment, the student
sees "From <tutor>: <comment>" under the pinyin the next time that card comes up, once. The
unseen notes are pulled into IndexedDB (`recordingNotes`) during sync
(`services/recording-notes.ts`, `GET /api/me/recording-notes`); rating the card marks the note
seen locally first and `POST /api/me/recording-notes/:eventId/seen` follows, immediately or on
the next sync.
