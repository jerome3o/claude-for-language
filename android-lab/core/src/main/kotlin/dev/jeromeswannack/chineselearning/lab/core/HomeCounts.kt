package dev.jeromeswannack.chineselearning.lab.core

/**
 * What a study session still has to show, published as it changes (port of `SessionCounts` in
 * shared/study/homeCounts.ts). Home paints it the moment Study is left — 0 after "All done" —
 * instead of the counts it worked out before the session (Jerome, Nov 2026).
 */
data class SessionCounts(
    /** The study day (StudyDayClock.todayKey) the session's queue was built for. */
    val day: String,
    /** When these numbers last changed (epoch ms). */
    val at: Long,
    /** The deck the session studies; null = all decks. */
    val deckId: String?,
    /** The session's own numbers (its top bar). */
    val remaining: QueueCounts,
    /** Its cards still to show, per deck. */
    val byDeck: Map<String, QueueCounts>,
    /** "⚡ Study it today": notes with a bumped card still to show. */
    val bumpedNotes: Int,
)

/** When Home's own counts were worked out: the moment the computation read the data, and that study day. */
data class ComputedStamp(val at: Long, val day: String)

/**
 * Home's numbers right after a study session — port of shared/study/homeCounts.ts (parity-tested,
 * parity/fixtures/home-counts.ts): Home paints the NEWEST of its own counts and the session's,
 * never an older snapshot over a newer one. docs/STUDY_SESSION.md "Back on Home".
 */
object HomeCounts {
    val NONE = QueueCounts(0, 0, 0, 0)

    /** Port of sessionCountsNewer(): today's session numbers newer than Home's own (a tie goes to Home's — exact). */
    fun sessionNewer(session: SessionCounts?, computed: ComputedStamp?, today: String): Boolean {
        if (session == null || session.day != today) return false
        if (computed == null || computed.day != today) return true
        return session.at > computed.at
    }

    private fun nonNegative(n: Int) = if (n > 0) n else 0

    /** Port of deckCountsAfterSession(). */
    fun deckAfterSession(row: QueueCounts?, session: SessionCounts, deckId: String): QueueCounts {
        if (session.deckId != null && session.deckId != deckId) return row ?: NONE
        val left = session.byDeck[deckId] ?: NONE
        val before = row ?: left
        return QueueCounts(
            new = nonNegative(minOf(before.new, session.remaining.new)),
            secondaryNew = nonNegative(minOf(before.secondaryNew, session.remaining.secondaryNew)),
            learning = nonNegative(left.learning),
            review = nonNegative(left.review),
        )
    }

    /** Port of totalAfterSession(). */
    fun totalAfterSession(total: QueueCounts?, rows: Map<String, QueueCounts>, session: SessionCounts): QueueCounts {
        if (session.deckId == null || total == null) return session.remaining
        val before = rows[session.deckId] ?: NONE
        val after = deckAfterSession(before, session, session.deckId)
        return QueueCounts(
            new = nonNegative(total.new - before.new + after.new),
            secondaryNew = nonNegative(total.secondaryNew - before.secondaryNew + after.secondaryNew),
            learning = nonNegative(total.learning - before.learning + after.learning),
            review = nonNegative(total.review - before.review + after.review),
        )
    }

    /** Port of bumpedAfterSession(). */
    fun bumpedAfterSession(bumped: Int, session: SessionCounts): Int = if (session.deckId == null) session.bumpedNotes else bumped

    /** Port of countSessionCards(): by queue, NEW of a started note = secondary. */
    fun countSessionCards(cards: Iterable<Triple<String, String, Int>>, reviewedNoteIds: Set<String>): Pair<QueueCounts, Map<String, QueueCounts>> {
        val total = IntArray(4)
        val byDeck = LinkedHashMap<String, IntArray>()
        for ((deckId, noteId, queue) in cards) {
            val row = byDeck.getOrPut(deckId) { IntArray(4) }
            val k = when (queue) {
                CardQueue.NEW -> if (noteId in reviewedNoteIds) 1 else 0
                CardQueue.REVIEW -> 3
                else -> 2
            }
            row[k]++
            total[k]++
        }
        fun of(a: IntArray) = QueueCounts(a[0], a[1], a[2], a[3])
        return of(total) to byDeck.mapValues { of(it.value) }
    }

    /** The session's queue as a [SessionCounts] (its cards by deck, the ⚡ notes still in it). */
    fun fromSession(
        day: String,
        at: Long,
        deckId: String?,
        queue: Collection<QueueCard>,
        reviewedNoteIds: Set<String>,
        bumpedCardIds: Set<String>,
    ): SessionCounts {
        val (total, byDeck) = countSessionCards(queue.map { Triple(it.deckId, it.noteId, it.queue) }, reviewedNoteIds)
        val bumped = queue.filter { it.id in bumpedCardIds }.map { it.noteId }.toSet().size
        return SessionCounts(day, at, deckId, total, byDeck, bumped)
    }
}
