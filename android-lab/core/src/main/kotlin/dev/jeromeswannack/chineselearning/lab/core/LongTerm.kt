package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/decks/long-term.ts — "Add to my long-term review", the learner's per-word
 * choice (notes.long_term on THEIR copy), set on the answer side of a homework pass:
 *
 *  - null  follow the deck: a deck in daily review introduces the word as usual, a one-off-only
 *          homework copy (caps 0 + 0) never does;
 *  - 1     opted IN: introduced even from a 0 + 0 deck, which then gives it the new-deck default
 *          caps (3 + 6), in the deck's queue position;
 *  - 0     opted OUT: never gets NEW cards introduced (not by the budget, not by "Study 10 more").
 *
 * Opting out only affects words not met yet: once any card of the note has been reviewed the
 * choice is ignored (the switch shows "Already in your reviews"). Parity-tested through
 * parity/fixtures/long-term.ts.
 */
object LongTerm {
    /** `deckInDailyReview`: a deck is in daily review unless BOTH its caps are 0. */
    fun deckInDailyReview(capPrimary: Int, capSecondary: Int): Boolean = capPrimary > 0 || capSecondary > 0

    /** `isLongTerm`: the switch's state. */
    fun isLongTerm(pref: Int?, deckInReview: Boolean, noteReviewed: Boolean = false): Boolean = when {
        noteReviewed -> true
        pref == 1 -> true
        pref == 0 -> false
        else -> deckInReview
    }

    /** `prefForToggle`: back to the deck's own default stores null, anything else explicit. */
    fun prefForToggle(on: Boolean, deckInReview: Boolean): Int? = if (on == deckInReview) null else if (on) 1 else 0

    /** `admitsNewCards`: whether the note's NEW cards enter its deck's new-card pool. */
    fun admitsNewCards(pref: Int?, deckInReview: Boolean, noteReviewed: Boolean): Boolean = when {
        pref == 1 -> true
        pref == 0 && !noteReviewed -> false
        else -> deckInReview
    }

    /** `longTermCaps`: a deck out of daily review gives its opted-in words the new-deck caps. */
    fun caps(capPrimary: Int, capSecondary: Int): Pair<Int, Int> =
        if (deckInDailyReview(capPrimary, capSecondary)) capPrimary to capSecondary
        else DeckSettings.DEFAULT_NEW_PER_DAY to DeckSettings.DEFAULT_SECONDARY_PER_DAY

    data class Word(val pref: Int?, val reviewed: Boolean)
    data class Summary(val added: Int, val leftOut: Int)

    /** `longTermSummary`: "12 words added to daily review · 4 left out". */
    fun summary(words: List<Word>, deckInReview: Boolean): Summary {
        val added = words.count { isLongTerm(it.pref, deckInReview, it.reviewed) }
        return Summary(added, words.size - added)
    }

    /** The pass's finish line (web: longTermLine in components/homework/LongTermSwitch.tsx). */
    fun line(added: Int, leftOut: Int): String {
        fun words(n: Int) = "$n ${if (n == 1) "word" else "words"}"
        return when {
            leftOut == 0 -> if (added == 1) "The word goes into your daily review" else "All $added words go into your daily review"
            added == 0 -> "${words(leftOut)} left out of daily review"
            else -> "${words(added)} added to daily review · $leftOut left out"
        }
    }
}
