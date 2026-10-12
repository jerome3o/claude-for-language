package dev.jeromeswannack.chineselearning.lab.core

/**
 * "Up next" — the account's ORDERED list of notes chosen to be introduced next. Port of
 * shared/decks/up-next.ts (parity-tested through parity/fixtures/up-next.ts → UpNextParityTest).
 *
 * Inside the daily budget, before the deck queue and "Order new cards by" (StudyQueue.build):
 *   - an unstarted note takes ONE blue card (its best NEW card, card-type order — meaning_to_hanzi for
 *     a word of known characters, LeadCard.kt / StudyQueue.withLeadCards); its other NEW
 *     cards wait until that card is reviewed;
 *   - a started note offers each NEW card to the PURPLE budget (never a spill from blue);
 *   - deck caps do not limit it (one-off 0 + 0 copies included) but its picks count against
 *     them for the rest of the deck's words;
 *   - an unstarted word opted out of long-term review is skipped; bumped notes are the pocket's.
 * A note leaves the list when every card has been reviewed ([status] "done").
 */
object UpNext {
    const val MAX = 500
    const val MAX_PER_REQUEST = 100

    val CARD_TYPE_ORDER = listOf(CardTypes.HANZI_TO_MEANING, CardTypes.MEANING_TO_HANZI, CardTypes.AUDIO_TO_HANZI)

    /** Port of UP_NEXT_SOURCES. */
    val SOURCES = listOf("up_next_page", "search", "deck", "card_hub", "explorer", "mcp", "tutor", "other")

    fun normalizeSource(s: String?): String = if (s != null && s in SOURCES) s else "other"

    const val NEW = "new"
    const val STARTED = "started"
    const val DONE = "done"
    const val MISSING = "missing"

    /** Port of upNextStatus(): new / started / done / missing from the note's card queues. */
    fun status(queues: List<Int>): String {
        if (queues.isEmpty()) return MISSING
        val fresh = queues.count { it == CardQueue.NEW }
        return when {
            fresh == 0 -> DONE
            fresh == queues.size -> NEW
            else -> STARTED
        }
    }

    fun canAdd(queues: List<Int>): Boolean = status(queues).let { it == NEW || it == STARTED }

    private fun typeRank(t: String): Int = CARD_TYPE_ORDER.indexOf(t).let { if (it < 0) CARD_TYPE_ORDER.size else it }

    private val byType = Comparator<QueueCard> { a, b ->
        val r = typeRank(a.cardType) - typeRank(b.cardType)
        if (r != 0) r else a.id.compareTo(b.id)
    }

    data class Slots(
        /** One card per never-started note (its best NEW card), list order. */
        val primary: List<QueueCard>,
        /** Every NEW card of the started notes, list order. */
        val secondary: List<QueueCard>,
        /** Notes the list holds today (insertion = list order). */
        val noteIds: LinkedHashSet<String>,
    )

    /** Port of upNextSlots(). [longTerm] holds 0 / 1 per note with a choice. */
    fun slots(
        cards: List<QueueCard>,
        upNext: List<String>?,
        reviewedNoteIds: Set<String>,
        skipCardIds: Set<String>? = null,
        longTerm: Map<String, Int>? = null,
    ): Slots {
        val primary = ArrayList<QueueCard>()
        val secondary = ArrayList<QueueCard>()
        val noteIds = LinkedHashSet<String>()
        if (upNext.isNullOrEmpty()) return Slots(primary, secondary, noteIds)
        val wanted = upNext.toHashSet()
        val fresh = HashMap<String, MutableList<QueueCard>>()
        for (c in cards) {
            if (c.queue != CardQueue.NEW || c.noteId !in wanted || (skipCardIds != null && c.id in skipCardIds)) continue
            fresh.getOrPut(c.noteId) { ArrayList() } += c
        }
        for (noteId in upNext) {
            if (noteId in noteIds) continue
            val list = fresh[noteId]
            if (list.isNullOrEmpty()) continue
            val started = noteId in reviewedNoteIds
            if (!started && longTerm?.get(noteId) == 0) continue
            noteIds += noteId
            val sorted = list.sortedWith(byType)
            if (started) secondary += sorted else primary += sorted[0]
        }
        return Slots(primary, secondary, noteIds)
    }

    /** Port of takeUpNext(): the first slots what is left of each budget allows. */
    fun take(primarySlots: Int, secondarySlots: Int, left: Spent): Spent =
        Spent(Math.max(0, minOf(primarySlots, left.primary)), Math.max(0, minOf(secondarySlots, left.secondary)))

    /** Port of withUpNextPicks(): the pools with the picks counted as introduced today in their decks. */
    fun withPicks(pools: List<DeckNewPool>, primaryDeckIds: List<String>, secondaryDeckIds: List<String>): List<DeckNewPool> {
        if (primaryDeckIds.isEmpty() && secondaryDeckIds.isEmpty()) return pools
        val p = primaryDeckIds.groupingBy { it }.eachCount()
        val s = secondaryDeckIds.groupingBy { it }.eachCount()
        return pools.map { pool ->
            if (pool.deckId in p || pool.deckId in s) {
                pool.copy(studiedPrimary = pool.studiedPrimary + (p[pool.deckId] ?: 0), studiedSecondary = pool.studiedSecondary + (s[pool.deckId] ?: 0))
            } else pool
        }
    }

    // ---- the list itself ----

    /** Port of insertIntoOrder(): [add] placed so its first id ends up at [index] (null = bottom); present ids are moved. */
    fun insertIntoOrder(ids: List<String>, add: List<String>, index: Int?): List<String> {
        val adding = add.distinct()
        val addSet = adding.toHashSet()
        val rest = ids.filter { it !in addSet }
        val at = if (index == null) rest.size else index.coerceIn(0, rest.size)
        return rest.subList(0, at) + adding + rest.subList(at, rest.size)
    }

    /** Port of reorderUpNext(): the requested ids first (known ones, once), the rest after in old order. */
    fun reorder(current: List<String>, requested: List<String>): List<String> {
        val have = current.toHashSet()
        val seen = LinkedHashSet<String>()
        for (id in requested) if (id in have) seen += id
        return seen.toList() + current.filter { it !in seen }
    }

    /** Port of upNextLabel(). */
    fun label(count: Int): String = if (count > 0) "↑ $count up next" else ""

    /** Port of upNextAddedMessage(). */
    fun addedMessage(hanzi: List<String>, already: Int = 0, noNewCards: Int = 0): String {
        val n = hanzi.size
        if (n == 0) {
            if (noNewCards > 0) return "Already studied — use ⚡ Study it today instead"
            return if (already > 0) "Already up next" else "Nothing added"
        }
        val shown = when (n) {
            1 -> hanzi[0]
            2 -> "${hanzi[0]} and ${hanzi[1]}"
            else -> "${hanzi[0]}, ${hanzi[1]} and ${n - 2} more"
        }
        return "↑ $shown ${if (n == 1) "is" else "are"} up next"
    }

    /** Port of upNextStatusLabel(). */
    fun statusLabel(status: String, newCards: Int): String = when (status) {
        NEW -> "New word"
        STARTED -> "Started · $newCards new ${if (newCards == 1) "card" else "cards"} left"
        DONE -> "All cards studied"
        else -> "Not on this device"
    }
}
