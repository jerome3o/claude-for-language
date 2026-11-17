package dev.jeromeswannack.chineselearning.lab.core

/**
 * "⚡ Study it today" DURING a study session — the new word's card comes NEXT. Port of shared/decks/bump-next.ts,
 * parity-tested (parity/fixtures/bump-next.ts → BumpNextParityTest).
 *
 *  - A bump made while the session is open of an UNSTARTED word: its lead card (the listening card with "Start new
 *    words by ear") is the very next card once the one on screen is rated — never instead of it; several words come
 *    next in the order bumped; before learning cards due now too.
 *  - Its other pocket cards, a STARTED word's bumped cards, and the note on screen / just rated (sibling spacing,
 *    [Bumps.BUMP_SIBLING_GAP]) join the session's ⚡ mix as before ([Bumps.mixBumpedCard]).
 *  - Bumps made outside the session are mixed as before.
 */
object BumpNext {
    /** [next] = the card to show next (null = none); [mixed] = the bump's other cards (the ⚡ mix). */
    data class Plan<C>(val next: C?, val mixed: List<C>)

    /** Port of sessionBumpPlan(): [pocket] = Bumps.bumpedCardsForNote (card-type order). */
    fun <C> sessionPlan(pocket: List<C>, started: Boolean, nearby: Boolean, byEar: Boolean, cardType: (C) -> String): Plan<C> {
        if (pocket.isEmpty()) return Plan(null, emptyList())
        if (started || nearby) return Plan(null, pocket.toList())
        val lead = if (byEar) LeadCard.EAR_TYPE else LeadCard.DEFAULT_TYPE
        val next = pocket.firstOrNull { cardType(it) == lead } ?: pocket[0]
        return Plan(next, pocket.filter { it !== next })
    }

    /** Port of pickNextUpCard(): the first of [nextIds] (the order bumped) still in [queue], or null. */
    fun <C> pickNextUp(queue: List<C>, nextIds: List<String>?, id: (C) -> String): C? {
        if (nextIds.isNullOrEmpty()) return null
        for (want in nextIds) queue.firstOrNull { id(it) == want }?.let { return it }
        return null
    }
}
