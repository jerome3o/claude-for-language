package dev.jeromeswannack.chineselearning.lab.core

/**
 * Graded readers in the study session — read ONCE, never repeated. Port of
 * shared/study/daily-reader.ts (parity-tested: parity/fixtures/daily-reader.ts → DailyReaderParityTest).
 *
 * - A story that was read (any reader review event: Finish, or listening to the end with
 *   "▶ Play whole story") is never offered by the session again; old reads stay on the
 *   Readers list and open by hand.
 * - One reader a day: a reader read today owns the day. Otherwise the first UNREAD story of the
 *   reader queue ([ReaderQueue] — newest first until reordered) —
 *   so an unread daily reader keeps being offered until it is read.
 * - A new daily story is generated only when no unread story is waiting, nothing was read
 *   today, and at most once per local day.
 */
data class ReaderOffer(
    val id: String,
    val createdAt: String,
    /** Generation finished ('ready') and it has pages. */
    val studyable: Boolean,
    /** It has at least one reader review event. */
    val read: Boolean,
    /** Its place in the reader queue ([ReaderQueue]); null = never placed by hand. */
    val queuePriority: Long? = null,
)

/**
 * The graded-reader queue ("Up next") — port of shared/reader/queue.ts (parity-tested in
 * DailyReaderParityTest). Readers never placed by hand come first, newest first (ties by id);
 * then placed ones, higher priority first (ties newest first, then id). A move / reorder writes
 * a priority on every reader of the queue (first = highest); a new story lands on top unless it
 * asks for the bottom ([bottomPriority]). Functions return the SAME list instance when nothing
 * changes, like the TypeScript.
 */
object ReaderQueue {
    /** `compareReaderQueue`: negative when [a] comes before [b]. */
    fun compare(aId: String, aCreatedAt: String, aPriority: Long?, bId: String, bCreatedAt: String, bPriority: Long?): Int {
        val ap = aPriority != null
        val bp = bPriority != null
        if (ap != bp) return if (ap) 1 else -1
        if (ap && bp && aPriority != bPriority) return if (bPriority!! > aPriority!!) 1 else -1
        if (aCreatedAt != bCreatedAt) return if (aCreatedAt > bCreatedAt) -1 else 1
        if (aId != bId) return if (aId < bId) -1 else 1
        return 0
    }

    fun compare(a: ReaderOffer, b: ReaderOffer): Int = compare(a.id, a.createdAt, a.queuePriority, b.id, b.createdAt, b.queuePriority)

    /** `sortReadersForQueue`. */
    fun <T> sort(rows: List<T>, offer: (T) -> ReaderOffer): List<T> = rows.sortedWith { x, y -> compare(offer(x), offer(y)) }

    /** `queuePriorities`: first = highest (n … 1). */
    fun priorities(orderedIds: List<String>): List<Pair<String, Long>> {
        val n = orderedIds.size
        return orderedIds.mapIndexed { i, id -> id to (n - i).toLong() }
    }

    /** `bottomQueuePriority`: below every placed reader (and every unplaced one). */
    fun bottomPriority(priorities: List<Long?>): Long {
        var min = 0L
        for (p in priorities) if (p != null && p < min) min = p
        return min - 1
    }

    /** `mergeReaderOrder`: [requested] first (unknown / duplicate ids ignored), then the rest of [current]. */
    fun merge(current: List<String>, requested: List<String>): List<String> {
        val known = current.toHashSet()
        val seen = HashSet<String>()
        val out = ArrayList<String>()
        for (id in requested) if (id in known && seen.add(id)) out.add(id)
        for (id in current) if (id !in seen) out.add(id)
        return out
    }

    /** `moveReaderInQueue` with a deck-queue move. */
    fun move(orderedIds: List<String>, id: String, to: DeckQueue.Move): List<String> = DeckQueue.moveInOrder(orderedIds, id, to)

    /** `moveReaderInQueue` with a 1-based place, clamped to the list. */
    fun moveToPosition(orderedIds: List<String>, id: String, position: Int): List<String> {
        val index = minOf(orderedIds.size - 1, maxOf(0, position - 1))
        return DeckQueue.moveToIndex(orderedIds, id, index)
    }
}

object DailyReader {
    /** `READERS_PER_DAY`. */
    const val READERS_PER_DAY = 1

    /** `STORY_PAGE_GAP_MS`: the beat between one page's narration and the next page. */
    const val STORY_PAGE_GAP_MS = 600L

    /** `nextUnreadReader`: the first unread, studyable story in queue order ([ReaderQueue]), ignoring today. */
    fun <T> nextUnread(readers: List<T>, offer: (T) -> ReaderOffer): T? {
        var best: T? = null
        var bestOffer: ReaderOffer? = null
        for (r in readers) {
            val o = offer(r)
            if (!o.studyable || o.read) continue
            val b = bestOffer
            if (b == null || ReaderQueue.compare(o, b) < 0) {
                best = r
                bestOffer = o
            }
        }
        return best
    }

    /** `unreadReaderQueue`: the unread, studyable readers in queue order ("Up next"). */
    fun <T> unreadQueue(readers: List<T>, offer: (T) -> ReaderOffer): List<T> =
        ReaderQueue.sort(readers.filter { val o = offer(it); o.studyable && !o.read }, offer)

    /** `pickTodaysReader`: nothing once a story was read today, else the newest unread one. */
    fun <T> pickTodays(readers: List<T>, readToday: Boolean, offer: (T) -> ReaderOffer): T? =
        if (readToday) null else nextUnread(readers, offer)

    /** `shouldGenerateDailyReader`: only when nothing was read today, nothing unread waits, and no attempt today. */
    fun shouldGenerate(readToday: Boolean, hasUnread: Boolean, lastAttemptDate: String?, today: String): Boolean {
        if (readToday || hasUnread) return false
        return lastAttemptDate != today
    }

    /** `storyNextPage`: after page [pageIndex] finished in "Play whole story", the next page, or null = listened to the end. */
    fun storyNextPage(pageIndex: Int, pageCount: Int): Int? {
        if (pageCount <= 0) return null
        val next = maxOf(0, pageIndex) + 1
        return if (next < pageCount) next else null
    }

    /** `storyPageGapMs`: a slower speed gets a proportionally longer beat (0.5× → 1.2 s). */
    fun storyPageGapMs(speed: Double): Long =
        if (speed > 0) Js.roundToLong(STORY_PAGE_GAP_MS / minOf(1.0, speed)) else STORY_PAGE_GAP_MS
}
