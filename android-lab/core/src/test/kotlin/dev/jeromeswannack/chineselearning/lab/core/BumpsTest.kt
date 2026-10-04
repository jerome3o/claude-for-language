package dev.jeromeswannack.chineselearning.lab.core

import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals

/** "⚡ Study it today" (Bumps.kt): copy, sources, and the session order (selectNext). The queue rule is in StudyQueueParityTest. */
class BumpsTest {
    private val zone = ZoneId.of("Europe/London")
    private val now = ZonedDateTime.of(2026, 10, 4, 10, 0, 0, 0, zone).toInstant().toEpochMilli()
    private val cutoff = StudyQueue.cutoff(now, zone)
    private val h = 3_600_000L

    private fun card(id: String, note: String, type: String = CardTypes.HANZI_TO_MEANING, queue: Int = CardQueue.NEW, due: Long? = null) =
        QueueCard(id, note, "d1", type, CardScheduler.initialCardState().copy(queue = queue, dueTimestamp = due))

    @Test
    fun labelAndMessageMatchTheWebCopy() {
        assertEquals("", Bumps.bumpedLabel(0))
        assertEquals("⚡ 1 bumped for today", Bumps.bumpedLabel(1))
        assertEquals("⚡ 2 bumped for today", Bumps.bumpedLabel(2))
        assertEquals("Nothing to bump", Bumps.bumpedMessage(emptyList()))
        assertEquals("Already in today’s pocket ⚡", Bumps.bumpedMessage(emptyList(), 1))
        assertEquals("⚡ 银行 will come first in today’s study", Bumps.bumpedMessage(listOf("银行")))
        assertEquals("⚡ 银行 and 苹果 will come first in today’s study", Bumps.bumpedMessage(listOf("银行", "苹果")))
        assertEquals("⚡ 银行, 苹果 and 2 more will come first in today’s study", Bumps.bumpedMessage(listOf("银行", "苹果", "妈妈", "长大")))
    }

    @Test
    fun sourcesNormalise() {
        assertEquals("coach", Bumps.normalizeBumpSource("coach"))
        assertEquals("picture_hunt", Bumps.normalizeBumpSource("picture_hunt"))
        assertEquals("other", Bumps.normalizeBumpSource("nope"))
        assertEquals("other", Bumps.normalizeBumpSource(null))
    }

    @Test
    fun aNewNoteIsBumpedOverASpentBudgetAndAReviewedOneGetsOneEarlyReview() {
        val decks = listOf(QueueDeck("d1", 0, "2026-01-01", 3, 6))
        val cards = listOf(
            card("n1h", "n1"), card("n1m", "n1", CardTypes.MEANING_TO_HANZI), card("n1a", "n1", CardTypes.AUDIO_TO_HANZI),
            card("r1h", "r1", queue = CardQueue.REVIEW, due = now + 5 * 24 * h),
            card("r1m", "r1", CardTypes.MEANING_TO_HANZI, CardQueue.REVIEW, now + 9 * 24 * h),
            card("x1", "x"),
        )
        val bumps = QueueBumps(listOf(QueueBump("r1", now - h), QueueBump("n1", now - 2 * h)), emptyMap(), mapOf("r1h" to now - 30 * 24 * h, "r1m" to now - 30 * 24 * h))
        val q = StudyQueue.build(decks, cards, StudyBudget(0, 0), 0, emptyMap(), cutoff, null, bumps = bumps)
        assertEquals(listOf("n1h", "n1m", "n1a", "r1h"), q.bumped.map { it.id })
        assertEquals(listOf("n1", "r1"), q.bumpedNoteIds)
        assertEquals(q.bumped, q.dueCards)
        // Once r1h is reviewed after the bump, r1's bump is done (no second early review).
        val after = bumps.copy(lastReviewMs = mapOf("r1h" to now))
        assertEquals(listOf("r1"), Bumps.bumpPocket(cards, after, cutoff.ts).doneNoteIds)
    }

    @Test
    fun selectNextServesTheFirstBumpedCardBeforeLearningDueNow() {
        val learning = card("l", "nl", queue = CardQueue.LEARNING, due = now - 10 * 60_000)
        val review = card("r", "nr", queue = CardQueue.REVIEW, due = now - h)
        val b1 = card("b1", "nb")
        val b2 = card("b2", "nb", CardTypes.MEANING_TO_HANZI)
        val queue = listOf(b1, b2, learning, review)
        val reviewed = setOf("nl", "nr")
        repeat(20) { seed ->
            assertEquals("b1", StudyQueue.selectNext(queue, reviewed, emptyList(), null, now, cutoff, Random(seed), setOf("b1", "b2"))?.id)
        }
        // b1 rated → it leaves the set; b2's note is recent (the card just rated) → skipped while others are available.
        val next = StudyQueue.selectNext(queue - b1, reviewed, listOf("nb"), "b1", now, cutoff, Random(1), setOf("b2"))
        assertEquals("l", next?.id)
        // Nothing else available → the recent filter falls away and b2 comes.
        assertEquals("b2", StudyQueue.selectNext(listOf(b2), reviewed, listOf("nb"), "b1", now, cutoff, Random(1), setOf("b2"))?.id)
        // Without bumps the old order holds: learning due now first.
        assertEquals("l", StudyQueue.selectNext(queue, reviewed, emptyList(), null, now, cutoff, Random(3))?.id)
    }
}
