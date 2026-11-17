package dev.jeromeswannack.chineselearning.lab.core

/**
 * "⚡ Study it today" — what ONE tap puts in today's study, the same from everywhere. Port of
 * shared/decks/study-today.ts, parity-tested (parity/fixtures/study-today.ts → StudyTodayParityTest).
 *
 *   - an UNSTARTED word → a card-level bump of ONE card: its listening card (audio_to_hanzi) when the
 *     note has a NEW listening card and either has audio or "Start new words by ear" is on ([plan]'s
 *     `newWordsByEar` — a word just added has no clip for a few seconds; the card waits on "Audio coming…");
 *     else its lead card (meaning_to_hanzi for a word of known
 *     characters with "English → Chinese" on, else hanzi_to_meaning). Its other cards wait
 *     ([Bumps.pocketSiblingIds]) and later arrive as purple cards; the word goes into long-term review
 *     when it isn't already ([Plan.longTerm]);
 *   - a STARTED word → a card-level bump of its listening card only, when it has audio and a listening
 *     card; else the whole-note bump.
 *
 * Every ⚡ that doesn't let the learner pick card types goes through it (data/bumps/BumpStore.bumpNotes).
 */
object StudyToday {
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

    /** Port of studyTodayPlan(). [cards] empty = not on the device yet (three NEW cards). */
    fun plan(
        cards: List<NoteCard>,
        started: Boolean,
        hasAudio: Boolean,
        longTermPref: Int?,
        deckInReview: Boolean,
        knownCharactersLead: (() -> Boolean)? = null,
        /** "Start new words by ear" is on: an unstarted word's listening card leads even before its clip exists. */
        newWordsByEar: Boolean = false,
    ): Plan {
        if (started) {
            val types = if (cards.isEmpty()) Bumps.BUMP_CARD_TYPE_ORDER.toSet() else cards.mapTo(HashSet()) { it.cardType }
            return if (hasAudio && LeadCard.EAR_TYPE in types) Plan(LISTENING, listOf(LeadCard.EAR_TYPE), false, null)
            else Plan(WHOLE, null, false, null)
        }
        val newTypes: Set<String> = if (cards.isEmpty()) Bumps.BUMP_CARD_TYPE_ORDER.toSet()
        else cards.filter { it.queue == CardQueue.NEW }.mapTo(HashSet()) { it.cardType }
        val setLongTerm = !LongTerm.isLongTerm(longTermPref, deckInReview, false)
        val longTerm = if (setLongTerm) LongTerm.prefForToggle(true, deckInReview) else null
        if ((hasAudio || newWordsByEar) && LeadCard.EAR_TYPE in newTypes) return Plan(LISTENING, listOf(LeadCard.EAR_TYPE), setLongTerm, longTerm)
        val lead = when {
            LeadCard.KNOWN_CHARACTERS_TYPE in newTypes && knownCharactersLead?.invoke() == true -> LeadCard.KNOWN_CHARACTERS_TYPE
            LeadCard.DEFAULT_TYPE in newTypes -> LeadCard.DEFAULT_TYPE
            else -> Bumps.BUMP_CARD_TYPE_ORDER.firstOrNull { it in newTypes }
        } ?: return Plan(WHOLE, null, setLongTerm, longTerm)
        return Plan(LEAD, listOf(lead), setLongTerm, longTerm)
    }

    /** Port of studyTodayLabel(): off = what a tap does, on = what it did. */
    fun label(kind: String, on: Boolean): String = when (kind) {
        LISTENING -> if (on) "⚡ Listening card today ✓" else "⚡ Study it today · listening card"
        LEAD -> if (on) "⚡ 1 card today ✓" else "⚡ Study it today · 1 card"
        else -> if (on) "⚡ Today ✓" else "⚡ Study it today"
    }

    /** Port of studyTodayHint(): the muted line under the button while it is on ('' = none). */
    fun hint(kind: String, started: Boolean = false): String =
        if (kind == WHOLE || started) "" else "Its other cards come later, with your daily new cards."

    /** What an existing bump row holds (its card types): one listening card, one other card, or the whole note. */
    fun kindOfRow(cardTypes: List<String>?): String = when {
        cardTypes.isNullOrEmpty() -> WHOLE
        cardTypes.size == 1 && cardTypes[0] == LeadCard.EAR_TYPE -> LISTENING
        else -> LEAD
    }

    private fun joinShown(hanzi: List<String>): String = when (hanzi.size) {
        1 -> hanzi[0]
        2 -> "${hanzi[0]} and ${hanzi[1]}"
        else -> "${hanzi[0]}, ${hanzi[1]} and ${hanzi.size - 2} more"
    }

    /** Port of studyTodayMessage(): the toast says what happened. [added] = (hanzi, kind). */
    fun message(added: List<Pair<String, String>>, alreadyBumped: Int = 0): String {
        val shown = added.filter { it.first.isNotEmpty() }
        if (shown.isEmpty()) return Bumps.bumpedMessage(emptyList(), alreadyBumped)
        val hanzi = shown.map { it.first }
        if (shown.all { it.second == WHOLE }) return Bumps.bumpedMessage(hanzi, alreadyBumped)
        if (shown.all { it.second == LISTENING }) {
            return if (shown.size == 1) "⚡ Listening card of ${hanzi[0]} added to today" else "⚡ Listening cards of ${joinShown(hanzi)} added to today"
        }
        if (shown.size == 1 && shown[0].second == LEAD) return "⚡ 1 card of ${hanzi[0]} added to today"
        return "⚡ ${joinShown(hanzi)} added to today"
    }
}
