package dev.jeromeswannack.chineselearning.lab.core

/**
 * The homework pass's "⚡ Study it today" (docs/HOMEWORK.md §3c). Port of
 * shared/homework/pass-bump.ts, parity-tested (parity/fixtures/pass-bump.ts → PassBumpParityTest).
 *
 *   - an UNSTARTED word → a card-level bump of ONE card: its listening card (audio_to_hanzi) when
 *     the note has audio and a NEW listening card; else its lead card (meaning_to_hanzi for a word
 *     of known characters with "English → Chinese" on, else hanzi_to_meaning). Its other cards wait
 *     ([Bumps.pocketSiblingIds]) and later arrive as purple cards within the daily budget;
 *   - and the word goes into long-term review when it isn't already ([Plan.longTerm]);
 *   - a STARTED word → the whole-note bump, as before.
 */
object PassBump {
    const val LISTENING = "listening"
    const val LEAD = "lead"
    const val WHOLE = "whole"

    /**
     * [kind] listening / lead / whole; [cardTypes] null = the whole note; [setLongTerm] true = store
     * [longTerm] (0 / 1 / null) with the bump, false = leave the choice as it is.
     */
    data class Plan(val kind: String, val cardTypes: List<String>?, val setLongTerm: Boolean, val longTerm: Int?)

    /** A card of the note: its type and queue (NEW = 0). */
    data class NoteCard(val cardType: String, val queue: Int)

    /** Port of passBumpPlan(). [cards] empty = not on the device yet (three NEW cards). */
    fun plan(
        cards: List<NoteCard>,
        started: Boolean,
        hasAudio: Boolean,
        longTermPref: Int?,
        deckInReview: Boolean,
        knownCharactersLead: (() -> Boolean)? = null,
    ): Plan {
        if (started) return Plan(WHOLE, null, false, null)
        val newTypes: Set<String> = if (cards.isEmpty()) Bumps.BUMP_CARD_TYPE_ORDER.toSet()
        else cards.filter { it.queue == CardQueue.NEW }.mapTo(HashSet()) { it.cardType }
        val setLongTerm = !LongTerm.isLongTerm(longTermPref, deckInReview, false)
        val longTerm = if (setLongTerm) LongTerm.prefForToggle(true, deckInReview) else null
        if (hasAudio && LeadCard.EAR_TYPE in newTypes) return Plan(LISTENING, listOf(LeadCard.EAR_TYPE), setLongTerm, longTerm)
        val lead = when {
            LeadCard.KNOWN_CHARACTERS_TYPE in newTypes && knownCharactersLead?.invoke() == true -> LeadCard.KNOWN_CHARACTERS_TYPE
            LeadCard.DEFAULT_TYPE in newTypes -> LeadCard.DEFAULT_TYPE
            else -> Bumps.BUMP_CARD_TYPE_ORDER.firstOrNull { it in newTypes }
        } ?: return Plan(WHOLE, null, setLongTerm, longTerm)
        return Plan(LEAD, listOf(lead), setLongTerm, longTerm)
    }

    /** Port of passBumpLabel(): off = what a tap does, on = what it did. */
    fun label(kind: String, on: Boolean): String = when (kind) {
        LISTENING -> if (on) "⚡ Listening card today ✓" else "⚡ Study it today · listening card"
        LEAD -> if (on) "⚡ 1 card today ✓" else "⚡ Study it today · 1 card"
        else -> if (on) "⚡ Today ✓" else "⚡ Study it today"
    }

    /** Port of passBumpHint(): the muted line under the button while it is on ('' = none). */
    fun hint(kind: String): String = if (kind == WHOLE) "" else "Its other cards come later, with your daily new cards."

    /** What an existing bump row holds (its card types): one listening card, one other card, or the whole note. */
    fun kindOfRow(cardTypes: List<String>?): String = when {
        cardTypes.isNullOrEmpty() -> WHOLE
        cardTypes.size == 1 && cardTypes[0] == LeadCard.EAR_TYPE -> LISTENING
        else -> LEAD
    }
}
