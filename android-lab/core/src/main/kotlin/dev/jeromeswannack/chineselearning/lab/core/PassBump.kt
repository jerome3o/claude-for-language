package dev.jeromeswannack.chineselearning.lab.core

/**
 * The homework pass's "⚡ Study it today" (docs/HOMEWORK.md §3c) — now the ONE rule every ⚡ follows,
 * [StudyToday] (shared/decks/study-today.ts). These names stay for the pass (shared/homework/pass-bump.ts).
 */
object PassBump {
    const val LISTENING = StudyToday.LISTENING
    const val LEAD = StudyToday.LEAD
    const val WHOLE = StudyToday.WHOLE

    /** A card of the note: its type and queue (NEW = 0). */
    data class NoteCard(val cardType: String, val queue: Int)

    /** Port of passBumpPlan() = [StudyToday.plan]. */
    fun plan(
        cards: List<NoteCard>,
        started: Boolean,
        hasAudio: Boolean,
        longTermPref: Int?,
        deckInReview: Boolean,
        knownCharactersLead: (() -> Boolean)? = null,
        newWordsByEar: Boolean = false,
    ): StudyToday.Plan = StudyToday.plan(cards.map { StudyToday.NoteCard(it.cardType, it.queue) }, started, hasAudio, longTermPref, deckInReview, knownCharactersLead, newWordsByEar)

    fun label(kind: String, on: Boolean): String = StudyToday.label(kind, on)

    fun hint(kind: String, started: Boolean = false): String = StudyToday.hint(kind, started)

    fun kindOfRow(cardTypes: List<String>?): String = StudyToday.kindOfRow(cardTypes)
}
