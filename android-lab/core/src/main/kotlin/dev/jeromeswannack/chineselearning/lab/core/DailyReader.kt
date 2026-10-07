package dev.jeromeswannack.chineselearning.lab.core

/**
 * Graded readers in the study session — read ONCE, never repeated. Port of
 * shared/study/daily-reader.ts (parity-tested: parity/fixtures/daily-reader.ts → DailyReaderParityTest).
 *
 * - A story that was read (any reader review event: Finish, or listening to the end with
 *   "▶ Play whole story") is never offered by the session again; old reads stay on the
 *   Readers list and open by hand.
 * - One reader a day: a reader read today owns the day. Otherwise the newest UNREAD story —
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
)

object DailyReader {
    /** `READERS_PER_DAY`. */
    const val READERS_PER_DAY = 1

    /** `STORY_PAGE_GAP_MS`: the beat between one page's narration and the next page. */
    const val STORY_PAGE_GAP_MS = 600L

    /** `nextUnreadReader`: the newest unread, studyable story (ties by id), ignoring today. */
    fun <T> nextUnread(readers: List<T>, offer: (T) -> ReaderOffer): T? {
        var best: T? = null
        var bestOffer: ReaderOffer? = null
        for (r in readers) {
            val o = offer(r)
            if (!o.studyable || o.read) continue
            val b = bestOffer
            if (b == null || o.createdAt > b.createdAt || (o.createdAt == b.createdAt && o.id < b.id)) {
                best = r
                bestOffer = o
            }
        }
        return best
    }

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
