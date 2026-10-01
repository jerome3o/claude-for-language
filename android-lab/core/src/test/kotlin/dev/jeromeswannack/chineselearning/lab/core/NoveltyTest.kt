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
}
