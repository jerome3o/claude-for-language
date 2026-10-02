package dev.jeromeswannack.chineselearning.lab.core

import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class StudyQueueTest {
    private val zone = ZoneId.of("Pacific/Auckland")
    private val now = ZonedDateTime.of(2026, 9, 27, 10, 0, 0, 0, zone).toInstant().toEpochMilli()
    private val cutoff = StudyQueue.cutoff(now, zone)

    private fun state(queue: Int, due: Long? = null) = CardScheduler.initialCardState().copy(
        queue = queue,
        dueTimestamp = due,
        nextReviewAt = due?.let { Js.toIsoString(it) },
    )

    private fun card(id: String, note: String, deck: String = "d1", type: String = CardTypes.HANZI_TO_MEANING, queue: Int = CardQueue.NEW, due: Long? = null) =
        QueueCard(id, note, deck, type, state(queue, due))

    @Test
    fun cutoffIsEndOfLocalDayOrAnHourFromNow() {
        assertEquals(ZonedDateTime.of(2026, 9, 27, 23, 59, 59, 999_000_000, zone).toInstant().toEpochMilli(), cutoff.ts)
        val late = ZonedDateTime.of(2026, 9, 27, 23, 30, 0, 0, zone).toInstant().toEpochMilli()
        assertEquals(late + 3_600_000, StudyQueue.cutoff(late, zone).ts)
    }

    @Test
    fun budgetIsFilledFromTheTopDeckWithHanziFirst() {
        val decks = listOf(
            QueueDeck("low", priority = 0, createdAt = "2026-01-01 00:00:00", capPrimary = 3, capSecondary = 6),
            QueueDeck("top", priority = 1, createdAt = "2025-01-01 00:00:00", capPrimary = 2, capSecondary = 6),
        )
        val cards = listOf(
            card("a2", "na", "top", CardTypes.MEANING_TO_HANZI),
            card("a1", "na", "top"),
            card("b1", "nb", "top"),
            card("c1", "nc", "top"),
            card("l1", "nl", "low"),
            card("l2", "nm", "low"),
        )
        val q = StudyQueue.build(decks, cards, StudyBudget(3, 0), bonus = 0, introduced = emptyMap(), cutoff = cutoff, deckId = null)
        // top deck cap 2 → a1, b1 (hanzi→meaning of unseen notes, by id); 1 left for the low deck
        assertEquals(listOf("a1", "b1", "l1"), q.dueCards.map { it.id })
        assertTrue(q.hasMoreNew)
    }

    @Test
    fun learningAndReviewCardsAreDueByTheCutoff() {
        val decks = listOf(QueueDeck("d1", 0, "2026-01-01", 0, 0))
        val cards = listOf(
            card("learn-soon", "n1", queue = CardQueue.LEARNING, due = now + 10 * 60_000),
            card("learn-tomorrow", "n2", queue = CardQueue.LEARNING, due = cutoff.ts + 1),
            card("review-today", "n3", queue = CardQueue.REVIEW, due = now + 5 * 3_600_000),
            card("review-later", "n4", queue = CardQueue.REVIEW, due = cutoff.ts + 86_400_000),
        )
        val q = StudyQueue.build(decks, cards, StudyBudget.DEFAULT, 0, emptyMap(), cutoff, null)
        assertEquals(setOf("learn-soon", "review-today"), q.dueCards.map { it.id }.toSet())
        assertFalse(q.hasMoreNew)
    }

    @Test
    fun introducedTodayCountsSecondaryWhenASiblingCameFirst() {
        val start = StudyQueue.startOfDay(now, zone)
        val cards = listOf(card("x1", "nx"), card("x2", "nx", type = CardTypes.AUDIO_TO_HANZI), card("y1", "ny"), card("z1", "nz"))
        val first = mapOf("x1" to start + 1000, "x2" to start + 5000, "y1" to start - 1000, "z1" to start + 10)
        assertEquals(mapOf("d1" to Introduced(primary = 2, secondary = 1)), StudyQueue.introducedToday(cards, first, start))
    }

    @Test
    fun selectNextPrefersLearningDueNowThenSkipsRecentNotes() {
        val learning = card("L", "n1", queue = CardQueue.LEARNING, due = now - 60_000)
        val recentNew = card("R", "n2")
        val otherNew = card("O", "n3")
        val rnd = Random(1)
        assertEquals("L", StudyQueue.selectNext(listOf(recentNew, learning, otherNew), emptySet(), emptyList(), null, now, cutoff, rnd)?.id)
        repeat(20) {
            assertEquals("O", StudyQueue.selectNext(listOf(recentNew, otherNew), emptySet(), listOf("n2"), null, now, cutoff, rnd)?.id)
        }
    }

    @Test
    fun cooldownCardsAreShownAtOnceButNotTheSameCardTwice() {
        val a = card("A", "n1", queue = CardQueue.LEARNING, due = now + 60_000)
        val b = card("B", "n2", queue = CardQueue.LEARNING, due = now + 120_000)
        assertEquals("B", StudyQueue.selectNext(listOf(a, b), emptySet(), emptyList(), "A", now, cutoff, Random(2))?.id)
        // The only card left comes straight back (no waiting screen).
        assertEquals("A", StudyQueue.selectNext(listOf(a), emptySet(), emptyList(), "A", now, cutoff, Random(2))?.id)
    }

    @Test
    fun countsSplitNewIntoBlueAndPurple() {
        val cards = listOf(card("1", "n1"), card("2", "n2"), card("3", "n3", queue = CardQueue.REVIEW), card("4", "n4", queue = CardQueue.RELEARNING))
        assertEquals(QueueCounts(new = 1, secondaryNew = 1, learning = 1, review = 1), StudyQueue.counts(cards, setOf("n2")))
    }

    @Test
    fun answerCheckAcceptsEquivalentsAndAlternatives() {
        assertEquals(AnswerKey.Verdict.EXACT, AnswerKey.check(" 你好 ", "你好", emptyList()))
        assertEquals(AnswerKey.Verdict.PUNCTUATION_ONLY, AnswerKey.check("你好", "你好。", emptyList()))
        assertEquals(AnswerKey.Verdict.EQUIVALENT, AnswerKey.check("7个", "七个", emptyList()))
        assertEquals(AnswerKey.Verdict.EQUIVALENT, AnswerKey.check("两个", "二个", emptyList()))
        assertEquals(AnswerKey.Verdict.ALTERNATIVE, AnswerKey.check("您好", "你好", listOf("您好")))
        assertEquals(AnswerKey.Verdict.WRONG, AnswerKey.check("你们", "你好", listOf("您好")))
    }

    /** An account shaped like the one that reported the launch crash: 26 decks, ~3000 notes, odd hanzi. */
    private fun bigAccount(): Triple<List<QueueDeck>, List<QueueCard>, Map<String, String>> {
        val rnd = Random(3)
        val decks = (0 until 26).map { QueueDeck("d$it", 26 - it, "2026-01-01 00:00:00", if (it % 5 == 0) 0 else 3, 6) }
        val odd = listOf("", " ", "𠮷野家", "😀", "OK", "我…了", "（请）坐", "你好/您好", "也许是我手机的问题。")
        val hanzi = HashMap<String, String>()
        val cards = ArrayList<QueueCard>()
        for (n in 0 until 3037) {
            val deck = if (n < 3000) "d${1 + n % 23}" else "d24"
            hanzi["n$n"] = if (n % 50 == 0) odd[n / 50 % odd.size] else (0 until 1 + rnd.nextInt(4)).joinToString("") { String(Character.toChars(0x4e00 + rnd.nextInt(0x5000))) }
            val reviewed = n % 3 != 0
            for (t in listOf(CardTypes.HANZI_TO_MEANING, CardTypes.MEANING_TO_HANZI, CardTypes.AUDIO_TO_HANZI)) {
                val q = if (reviewed && (t == CardTypes.HANZI_TO_MEANING || n % 2 == 0)) CardQueue.REVIEW else CardQueue.NEW
                cards += card("c$n-$t", "n$n", deck, t, q, if (q == CardQueue.REVIEW) now - rnd.nextLong(0, 86_400_000L * 5) else null)
            }
        }
        // A note with no hanzi row at all (deleted / not synced yet).
        cards += card("orphan", "missing-note", "d1")
        return Triple(decks, cards, hanzi)
    }

    @Test
    fun newCharactersFirstCopesWithAWholeRealSizedAccount() {
        val (decks, cards, hanzi) = bigAccount()
        for (bonus in listOf(0, 10, 200)) for (deck in listOf<String?>(null, "d1", "d24", "d0")) {
            val plain = StudyQueue.build(decks, cards, StudyBudget(5, 10), bonus, emptyMap(), cutoff, deck)
            val novel = StudyQueue.build(decks, cards, StudyBudget(5, 10), bonus, emptyMap(), cutoff, deck, hanzi)
            // Same amount of every kind of card; only which new words differs.
            assertEquals(StudyQueue.counts(plain.dueCards, plain.reviewedNoteIds), StudyQueue.counts(novel.dueCards, novel.reviewedNoteIds), "bonus $bonus deck $deck")
            assertEquals(novel.dueCards.size, novel.dueCards.map { it.id }.distinct().size)
        }
    }

    @Test
    fun aFailureInNewCharactersFirstFallsBackToThePlainOrder() {
        val (decks, cards, _) = bigAccount()
        val broken = object : AbstractMap<String, String>() {
            override val entries: Set<Map.Entry<String, String>> get() = throw IllegalStateException("broken hanzi map")
            override fun get(key: String): String = throw IllegalStateException("broken hanzi map")
        }
        val plain = StudyQueue.build(decks, cards, StudyBudget(5, 10), 0, emptyMap(), cutoff, null)
        val fallback = StudyQueue.build(decks, cards, StudyBudget(5, 10), 0, emptyMap(), cutoff, null, broken)
        assertEquals(plain.dueCards.map { it.id }, fallback.dueCards.map { it.id })
    }
}
