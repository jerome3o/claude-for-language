package dev.jeromeswannack.chineselearning.lab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NewCardOrderTest {
    private val cutoff = StudyCutoff(1_800_000_000_000)
    private val blank = CardScheduler.initialCardState()
    private fun card(id: String, note: String, deck: String, queue: Int, type: String = CardTypes.HANZI_TO_MEANING) =
        QueueCard(id, note, deck, type, blank.copy(queue = queue, dueTimestamp = if (queue == 0) null else cutoff.ts - 1))

    @Test
    fun sentencesLastPutsLowerDeckWordsBeforeTheTopDeckSentence() {
        val decks = listOf(QueueDeck("top", 9, "2026-01-01", 5, 6), QueueDeck("low", 0, "2026-01-01", 5, 6))
        val hanzi = mapOf("seen" to "我在银行工作。", "s1" to "你好，我是老师。", "w1" to "工作", "w2" to "电脑", "w3" to "老师")
        val cards = listOf(card("seen1", "seen", "top", 2), card("s1c", "s1", "top", 0), card("w1c", "w1", "low", 0), card("w2c", "w2", "low", 0), card("w3c", "w3", "low", 0))
        fun newIds(order: NewCardOrder, take: Int) = StudyQueue.build(decks, cards, StudyBudget(take, 0), 0, emptyMap(), cutoff, null, hanzi, order = order)
            .dueCards.filter { it.queue == 0 }.map { it.id }
        assertEquals(listOf("s1c", "w1c"), newIds(NewCardOrder.ALL_OFF, 2))
        assertEquals(listOf("w1c", "w2c", "w3c", "s1c"), newIds(NewCardOrder.ALL_OFF.copy(sentencesLast = true), 4))
    }

    @Test
    fun ordersTenThousandNotesQuickly() {
        val shipped = WordFrequency.shipped!!
        val pool = shipped.words.keys.toList().sortedBy { shipped.words[it] }.take(6000)
        val random = java.util.Random(11)
        val decks = (0 until 20).map { QueueDeck("d$it", it, "2026-01-01", 20, 10) }
        val hanzi = HashMap<String, String>()
        val cards = ArrayList<QueueCard>()
        for (n in 0 until 10_000) {
            hanzi["n$n"] = if (random.nextDouble() < 0.25) pool[random.nextInt(pool.size)] + pool[random.nextInt(pool.size)] + "。" else pool[random.nextInt(pool.size)]
            val reviewed = random.nextDouble() < 0.5
            for (t in listOf(CardTypes.HANZI_TO_MEANING, CardTypes.MEANING_TO_HANZI, CardTypes.AUDIO_TO_HANZI)) {
                cards += card("c$n-${t[0]}", "n$n", "d${n % 20}", if (reviewed) 2 else 0, t)
            }
        }
        fun run() = StudyQueue.build(decks, cards, StudyBudget(20, 10), 10, emptyMap(), cutoff, null, hanzi, frequency = shipped)
        repeat(3) { run() }
        val times = (0 until 7).map { val t0 = System.nanoTime(); run(); (System.nanoTime() - t0) / 1e6 }.sorted()
        println("StudyQueue.build + Order new cards by, 10k notes / 30k cards / 20 decks: median ${"%.1f".format(times[3])} ms")
        assertEquals(30, run().dueCards.count { it.queue == 0 })
        assertTrue(times[3] < 250, "median ${times[3]} ms") // generous for CI; a few tens of ms on a dev container
    }
}
