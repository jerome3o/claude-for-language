package dev.jeromeswannack.chineselearning.lab.core

import kotlin.test.Test
import kotlin.test.assertEquals

/** Hand-written cases mirroring shared/decks/novelty.test.ts (the parity vectors cover the rest). */
class NoveltyTest {
    @Test
    fun countsNewCharactersUnseenWordAndLength() {
        val seen = NoveltyRank.seenFrom(listOf("大学生", "我是老师。", "OK"))
        assertEquals(Novelty(0, false, 2), NoveltyRank.noveltyOf("学生", seen))
        assertEquals(Novelty(0, true, 2), NoveltyRank.noveltyOf("学老", seen))
        assertEquals(Novelty(2, true, 4), NoveltyRank.noveltyOf("咖啡咖啡", seen))
        assertEquals(Novelty(2, true, 2), NoveltyRank.noveltyOf("卡拉OK", seen))
        assertEquals(Novelty(0, false, 0), NoveltyRank.noveltyOf("OK", seen))
        assertEquals(true, NoveltyRank.noveltyOf("生我", seen).unseenWord)
    }

    @Test
    fun earlierPicksCountAsSeen() {
        val seen = NoveltyRank.seenFrom(listOf("你好"))
        assertEquals(listOf("咖啡", "茶", "你们"), NoveltyRank.pick(listOf("咖啡", "喝咖啡", "茶", "你们"), 3, { it }, seen))
        assertEquals(listOf("熊猫"), NoveltyRank.pick(listOf("我们明天去北京看长城。", "熊猫"), 1, { it }, NoveltyRank.seenFrom(emptyList())))
    }

    @Test
    fun bottomDeckNewCharacterBeatsTopDeckFamiliarWord() {
        val blank = CardScheduler.initialCardState()
        val hanzi = mapOf("s" to "你好", "t" to "你", "b" to "熊")
        val cards = listOf(
            QueueCard("s1", "s", "top", CardTypes.HANZI_TO_MEANING, blank.copy(queue = CardQueue.REVIEW, dueTimestamp = Long.MAX_VALUE)),
            QueueCard("t1", "t", "top", CardTypes.HANZI_TO_MEANING, blank),
            QueueCard("b1", "b", "bottom", CardTypes.HANZI_TO_MEANING, blank),
        )
        val decks = listOf(QueueDeck("top", 9, "2026-01-01", 3, 6), QueueDeck("bottom", 0, "2026-01-01", 3, 6))
        val built = StudyQueue.build(decks, cards, StudyBudget(1, 0), 0, emptyMap(), StudyCutoff(0), null, hanzi)
        assertEquals(listOf("b1"), built.dueCards.filter { it.queue == CardQueue.NEW }.map { it.id })
        assertEquals(DeckAllocation(1, 0), built.allocation["bottom"])
        assertEquals(DeckAllocation(0, 0), built.allocation["top"])
    }

    @Test
    fun acrossGroupsRespectsRoomAndRank() {
        val seen = NoveltyRank.seenFrom(listOf("你"))
        val items = listOf("a:熊猫", "b:猴子", "b:虎", "a:你")
        val got = NoveltyRank.pickAcrossGroups(items, 5, { it.substringAfter(':') }, { it.substringBefore(':') },
            { if (it == "b") 0 else 1 }, mapOf("a" to 5, "b" to 1), { it }, seen)
        // b ranks first but has room for one; 你 brings nothing new.
        assertEquals(listOf("b:猴子", "a:熊猫"), got)
    }
}
