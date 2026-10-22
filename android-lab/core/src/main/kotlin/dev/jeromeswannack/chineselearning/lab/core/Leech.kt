package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/cards/leech.ts: leeches (Anki's lapse count — Again on a card in Review — with
 * its default threshold of 8; never auto-suspended) and the "Forget this card" words.
 * Parity-tested by parity/fixtures/card-forget.ts (CardForgetParityTest).
 */
object Leech {
    const val THRESHOLD = 8
    const val RECENT_LIMIT = 10

    fun isLeech(lapses: Int?): Boolean = lapses != null && lapses >= THRESHOLD

    data class Pill(val icon: String, val text: String)

    fun pill(lapses: Int?): Pill? = if (!isLeech(lapses)) null else Pill("⚠️", "Missed ${lapses}×")

    data class Recent(val reviewedAt: String, val rating: Int, val lapse: Boolean)

    data class Info(
        val lapses: Int,
        val isLeech: Boolean,
        val lapseDates: List<String>,
        val reviews: Int,
        val recent: List<Recent>,
        val forgottenAt: String?,
    )

    /** `leechInfo(events)`: events = reviews + forgets sorted by time (Forgets.merge). */
    fun info(events: List<ReviewEventInput>): Info {
        val timeline = CardScheduler.computeCardTimeline(events)
        var before = 0
        var lapseDates = ArrayList<String>()
        var reviews = ArrayList<Recent>()
        var forgottenAt: String? = null
        events.forEachIndexed { i, e ->
            val after = timeline[i].queue
            if (e.forget) {
                lapseDates = ArrayList()
                reviews = ArrayList()
                forgottenAt = e.reviewedAt
            } else {
                val lapse = e.rating == 0 && before == 2
                if (lapse) lapseDates += e.reviewedAt
                reviews += Recent(e.reviewedAt, e.rating, lapse)
            }
            before = after
        }
        return Info(
            lapses = lapseDates.size,
            isLeech = isLeech(lapseDates.size),
            lapseDates = lapseDates,
            reviews = reviews.size,
            recent = reviews.takeLast(RECENT_LIMIT).reversed(),
            forgottenAt = forgottenAt,
        )
    }

    fun headline(lapses: Int): String = "You've missed this card $lapses ${if (lapses == 1) "time" else "times"} after learning it."

    const val EXPLANATION =
        "A card you keep forgetting is called a leech. More reviews alone rarely fix it — a clearer card, a memory hook or a short rest usually does. Nothing changes unless you choose one."

    fun memoryHookQuestion(hanzi: String, english: String, lapses: Int): String =
        "I keep forgetting this card (missed $lapses times): $hanzi — $english. Can you give me a memorable memory hook or mnemonic for it, and tell me what I'm probably mixing it up with?"

    fun ratingTag(rating: Int): String = when (rating) {
        0 -> "✗ Again"
        1 -> "~ Hard"
        2 -> "✓ Good"
        3 -> "✓✓ Easy"
        else -> "?"
    }

    // ---- Forget this card ----

    const val FORGET_WARNING =
        "This card goes back to New: its schedule restarts from scratch and it re-enters your new-card queue. Its review history is kept but no longer counts toward scheduling. Can't be undone except by Undo right now."

    fun forgetWarning(count: Int): String =
        if (count <= 1) FORGET_WARNING
        else "These $count cards go back to New: their schedules restart from scratch and they re-enter your new-card queue. Their review history is kept but no longer counts toward scheduling. Can't be undone except by Undo right now."

    /** scope: "card" | "note". */
    fun forgetTitle(scope: String, count: Int): String =
        if (scope == "card" || count <= 1) "Forget this card?" else "Forget all $count cards of this word?"

    fun forgetButton(count: Int): String = if (count <= 1) "↺ Forget card" else "↺ Forget $count cards"

    fun forgetMessage(count: Int): String = if (count <= 1) "Card reset to New." else "$count cards reset to New."

    fun undoForgetMessage(count: Int): String =
        if (count <= 1) "Forget undone — the card is back as it was." else "Forget undone — $count cards are back as they were."

    const val FORGET_HISTORY_LABEL = "↺ Forgotten — back to New"
}
