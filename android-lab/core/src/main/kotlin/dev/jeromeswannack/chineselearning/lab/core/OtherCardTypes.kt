package dev.jeromeswannack.chineselearning.lab.core

/**
 * "Practise this word other ways…" — the study card's ⋯ sheet. Port of
 * shared/decks/other-card-types.ts (parity-tested by parity/fixtures/other-card-types.ts →
 * OtherCardTypesParityTest).
 *
 * The note's card types with their state; a NEW sibling can be added to today ("⚡ Add to
 * today"), a started one not due yet reviewed early — both through a CARD-LEVEL bump
 * ([QueueBump.cardTypes], Bumps.kt): outside the daily budget, a few cards later in this
 * session, then FSRS from its first review.
 */
object OtherCardTypes {
    private const val DAY_MS = 86_400_000L

    const val ACTION_ADD = "add"
    const val ACTION_EARLY = "early"

    /** Port of CARD_TYPE_SHORT_LABELS. */
    val SHORT_LABELS = mapOf(
        CardTypes.HANZI_TO_MEANING to "Read → meaning",
        CardTypes.MEANING_TO_HANZI to "English → 汉字",
        CardTypes.AUDIO_TO_HANZI to "Listen → 汉字",
    )

    fun shortLabel(cardType: String): String = SHORT_LABELS[cardType] ?: cardType

    data class Row(
        val cardId: String,
        val cardType: String,
        val label: String,
        /** "this card" · "new" · "⚡ in today’s study" · "due today" · "in review, due in 12 days" · "learning, due tomorrow" */
        val status: String,
        /** [ACTION_ADD] / [ACTION_EARLY]; null = nothing to do. */
        val action: String?,
        val isCurrent: Boolean,
    )

    /** Port of dueInLabel(): "due tomorrow" / "due in 12 days" for a card due after the cutoff. */
    fun dueInLabel(dueMs: Long, cutoffMs: Long): String {
        val diff = dueMs - cutoffMs
        val days = maxOf(1L, if (diff <= 0) 0L else (diff + DAY_MS - 1) / DAY_MS)
        return if (days == 1L) "due tomorrow" else "due in $days days"
    }

    private fun typeRank(t: String): Int = Bumps.BUMP_CARD_TYPE_ORDER.indexOf(t).let { if (it < 0) Bumps.BUMP_CARD_TYPE_ORDER.size else it }

    /** Port of otherCardTypeRows(). */
    fun rows(
        noteCards: List<QueueCard>,
        currentCardId: String,
        cutoffMs: Long,
        inToday: Set<String> = emptySet(),
        wholeNoteBumped: Boolean = false,
    ): List<Row> {
        val sorted = noteCards.sortedWith(compareBy<QueueCard> { typeRank(it.cardType) }.thenBy { it.id })
        return sorted.map { c ->
            fun row(status: String, action: String?) = Row(c.id, c.cardType, shortLabel(c.cardType), status, action, c.id == currentCardId)
            val due = c.state.dueTimestamp
            when {
                c.id == currentCardId -> row("this card", null)
                c.id in inToday -> row("⚡ in today’s study", null)
                c.queue == CardQueue.NEW -> row("new", if (wholeNoteBumped) null else ACTION_ADD)
                due == null || due <= cutoffMs -> row("due today", null)
                else -> row(
                    "${if (c.queue == CardQueue.REVIEW) "in review" else "learning"}, ${dueInLabel(due, cutoffMs)}",
                    if (wholeNoteBumped) null else ACTION_EARLY,
                )
            }
        }
    }

    /** Port of defaultOtherCardPicks(): the first NEW sibling, else nothing. */
    fun defaultPicks(rows: List<Row>): List<String> = rows.firstOrNull { it.action == ACTION_ADD }?.let { listOf(it.cardId) } ?: emptyList()

    /** Port of hasOtherCardTypes(). */
    fun hasOtherCardTypes(noteCardIds: List<String>, currentCardId: String): Boolean = noteCardIds.any { it != currentCardId }

    /** Port of otherCardsButtonLabel(). */
    fun buttonLabel(count: Int): String = if (count > 0) "⚡ Add $count to today" else "Nothing ticked"

    /** Port of otherCardsAddedMessage(). */
    fun addedMessage(labels: List<String>): String {
        if (labels.isEmpty()) return "Nothing added"
        val shown = if (labels.size == 1) labels[0] else "${labels.dropLast(1).joinToString(", ")} and ${labels.last()}"
        return "⚡ $shown ${if (labels.size == 1) "comes" else "come"} up in a few cards"
    }

    /** Port of otherCardTypesProp(): the analytics `types` token. */
    fun typesProp(cardTypes: List<String>): String = cardTypes.sortedBy { typeRank(it) }.joinToString("/")
}
