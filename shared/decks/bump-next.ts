/**
 * "⚡ Study it today" DURING a study session — the new word's card comes NEXT (docs/STUDY_SESSION.md
 * "⚡ Study it today" → "During a session"). Jerome (Nov 2026): "from the what's going on, click through,
 * add card, study today, and I think other study today actions during a study session. Don't add the new
 * card to the mix straight away. I think it would be good if that blue card appeared straight away."
 *
 *   - A bump made while a session is open (the sentence breakdown → explorer → "+ Add as card" → ⚡, the
 *     explorer's / a word sheet's ⚡, Ask Claude's bump_cards…) of an UNSTARTED word (no card reviewed):
 *     its lead card — the one card the bump put in the pocket (study-today.ts: the listening card with
 *     "Start new words by ear") — is the very NEXT card once the one on screen is rated. Never instead of
 *     the card on screen; several words bumped on one card come next in the order bumped; before learning
 *     cards due now too (he just asked for it; one card later they're still there).
 *   - Its other pocket cards (a whole-note bump of an unstarted word) and a STARTED word's bumped cards join
 *     the session's ⚡ mix as before (bumps.ts `mixBumpedCard`) — so do the cards of the note on screen or
 *     just rated: a sibling never comes straight after its sibling (`BUMP_SIBLING_GAP`, "Practise this word
 *     other ways…").
 *   - Bumps made outside the session (Home, the deck page…) are in the pocket when a session starts and are
 *     mixed as before.
 *
 * Pure; shared by the web (hooks/useStudySession.ts) and the Lab app (core BumpNext.kt, parity-tested
 * through android-lab/parity/fixtures/bump-next.ts).
 */
import { EAR_LEAD_CARD_TYPE, DEFAULT_LEAD_CARD_TYPE } from './lead-card';

export interface SessionBumpPlan<C> {
  /** The card to show next (null = none: mix them all). */
  next: C | null;
  /** The bump's other cards: they join the session's ⚡ mix. */
  mixed: C[];
}

/**
 * Where the cards a bump made during a session put in the pocket go (`pocket` = bumps.ts
 * `bumpedCardsForNote`, card-type order). `started` = a card of the note has been reviewed; `nearby` = the
 * note is the one on screen or among the last BUMP_SIBLING_GAP rated (its siblings keep their spacing);
 * `byEar` = "Start new words by ear" (which card leads when the pocket holds several).
 */
export function sessionBumpPlan<C extends { card_type: string }>(
  pocket: ReadonlyArray<C>,
  started: boolean,
  nearby: boolean,
  byEar: boolean
): SessionBumpPlan<C> {
  if (pocket.length === 0) return { next: null, mixed: [] };
  if (started || nearby) return { next: null, mixed: [...pocket] };
  const lead = byEar ? EAR_LEAD_CARD_TYPE : DEFAULT_LEAD_CARD_TYPE;
  const next = pocket.find(c => c.card_type === lead) ?? pocket[0];
  return { next, mixed: pocket.filter(c => c !== next) };
}

/** The first of `nextIds` (in the order bumped) still in `queue`, or null. Asked before anything else. */
export function pickNextUpCard<C extends { id: string }>(queue: ReadonlyArray<C>, nextIds: ReadonlyArray<string> | null | undefined): C | null {
  if (!nextIds || nextIds.length === 0) return null;
  for (const id of nextIds) {
    const card = queue.find(c => c.id === id);
    if (card) return card;
  }
  return null;
}
