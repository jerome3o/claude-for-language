package dev.jeromeswannack.chineselearning.lab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** docs/CHAT.md PR 3 — the chat's learning-tool rules (ChatLearning, FlashcardReview). */
class ChatLearningTest {
    @Test fun checkButtonFollowsTheLearnerRule() {
        assertTrue(ChatLearning.canCheckDraft("我想去北京", "student", isAi = false))
        assertTrue(ChatLearning.canCheckDraft("我想去北京", "tutor", isAi = true), "the Claude chat: always the learner")
        assertFalse(ChatLearning.canCheckDraft("我想去北京", "tutor", isAi = false), "a tutor never checks")
        assertFalse(ChatLearning.canCheckDraft("see you tomorrow", "student", false), "no Chinese")
        assertFalse(ChatLearning.canCheckDraft("我想去北京", "student", false, editing = true), "not while editing")
    }

    @Test fun wordsTextAndWhenToAskForWords() {
        assertEquals("好可爱", ChatLearning.wordsText("", "好可爱", "transcript"))
        assertEquals("你好", ChatLearning.wordsText("你好", "x", "content"))
        assertEquals("你好", ChatLearning.wordsText("你好", null, null))
        assertTrue(ChatLearning.needsWords("你好吗", null, null, null, deleted = false, hasWords = false))
        assertFalse(ChatLearning.needsWords("你好吗", null, null, null, deleted = false, hasWords = true))
        assertFalse(ChatLearning.needsWords("hello", null, null, null, false, false))
        assertFalse(ChatLearning.needsWords("你好", null, null, null, deleted = true, hasWords = false))
        assertFalse(ChatLearning.needsWords("", "voice", "pending", null, false, false), "not transcribed yet")
        assertTrue(ChatLearning.needsWords("", "voice", "done", "它叫什么名字", false, false))
        assertFalse(ChatLearning.needsWords("你".repeat(1501), null, null, null, false, false), "too long (400)")
    }

    @Test fun pinyinLineFromWords() {
        val words = listOf("我" to "wǒ", "想" to "xiǎng", "去" to "qù", "北京" to "Běijīng", "，" to "", "好" to "hǎo", "吗" to "ma", "？" to "")
        assertEquals("wǒ xiǎng qù Běijīng, hǎo ma?", ChatLearning.pinyinLine(words))
        assertEquals("OK hǎo", ChatLearning.pinyinLine(listOf("OK" to "", " " to "", "好" to "hǎo")))
    }

    @Test fun togglesRememberPerMessageAndForAll() {
        var a = ChatLearning.Aids()
        assertFalse(a.pinyin("m1"))
        a = a.togglePinyin("m1")
        assertTrue(a.pinyin("m1"))
        assertFalse(a.pinyin("m2"))
        a = a.setPinyinAll(true)
        assertTrue(a.pinyin("m1") && a.pinyin("m2"), "for all")
        a = a.togglePinyin("m2")
        assertFalse(a.pinyin("m2"), "one turned off while all are on")
        assertTrue(a.pinyin("m3"))
        a = a.setPinyinAll(false)
        assertFalse(a.pinyin("m2") || a.pinyin("m1"), "the switch is a clean slate")
        a = a.toggleTranslation("v1")
        assertTrue(a.translation("v1"))
        assertFalse(a.pinyin("v1"), "kinds are independent")
    }

    private val msgs = listOf(
        ChatLearning.Pickable("old", 1_000, true),
        ChatLearning.Pickable("deleted", 2_000, false),
        ChatLearning.Pickable("y", 5_000, true),
        ChatLearning.Pickable("t1", 10_000, true),
        ChatLearning.Pickable("t2", 11_000, true),
    )

    @Test fun selectionQuickPicksAndRequest() {
        assertEquals(setOf("t1", "t2"), ChatLearning.today(msgs, dayStartMs = 9_000))
        assertEquals(setOf("y", "t1", "t2"), ChatLearning.lastN(msgs, 3))
        assertEquals(listOf("old", "y", "t1", "t2"), ChatLearning.lastN(msgs).toList(), "only eligible, oldest first")
        var sel = ChatLearning.toggle(emptySet(), "t2", msgs)
        sel = ChatLearning.toggle(sel, "old", msgs)
        sel = ChatLearning.toggle(sel, "deleted", msgs)
        assertEquals(setOf("t2", "old"), sel, "a deleted message can't be picked")
        assertEquals(listOf("old", "t2"), ChatLearning.requestIds(sel, msgs), "the request goes oldest first")
        assertEquals(setOf("old"), ChatLearning.toggle(sel, "t2", msgs))
        val many = (1..100).map { ChatLearning.Pickable("m$it", it.toLong(), true) }
        val all = ChatLearning.lastN(many, 100)
        assertEquals(80, ChatLearning.requestIds(all, many).size, "at most 80 (the worker's limit)")
        assertEquals(80, ChatLearning.today(many, 0).size)
        var full = (1..80).mapTo(HashSet()) { "m$it" }
        full = ChatLearning.toggle(full, "m99", many).toHashSet()
        assertEquals(80, full.size, "no 81st")
    }

    @Test fun eligibility() {
        assertTrue(ChatLearning.eligible("你好", null, null, null, false))
        assertFalse(ChatLearning.eligible("", null, null, null, false))
        assertFalse(ChatLearning.eligible("你好", null, null, null, true))
        assertTrue(ChatLearning.eligible("", "voice", "done", "好可爱", false))
        assertFalse(ChatLearning.eligible("", "voice", "pending", null, false))
        assertFalse(ChatLearning.eligible("", "image", null, null, false))
        assertTrue(ChatLearning.eligible("我家的猫", "image", null, null, false))
    }

    @Test fun correctionDiffRuns() {
        val d = ChatLearning.correctionDiff("我昨天去商店买东西了。", "我昨天去了商店买东西。")
        assertEquals("我昨天去商店买东西了", d.original.joinToString("") { it.text })
        assertEquals("我昨天去了商店买东西", d.corrected.joinToString("") { it.text })
        assertEquals(listOf(ChatLearning.Run("我昨天去", true), ChatLearning.Run("了", false), ChatLearning.Run("商店买东西", true)), d.corrected)
        assertEquals(listOf(ChatLearning.Run("我昨天去商店买东西", true), ChatLearning.Run("了", false)), d.original)
        assertFalse(d.identical)
        assertTrue(ChatLearning.correctionDiff("你好！", "你好。").identical, "punctuation only")
    }

    private fun card(h: String, have: Boolean = false) = ProposedCard(h, "pīn", "meaning", alreadyHave = have)

    @Test fun reviewStartsWithAlreadyHaveUnchecked() {
        val r = FlashcardReview.of(listOf(card("商店"), card("你好", have = true), card("东西")))
        assertEquals(setOf(0, 2), r.checked)
        assertEquals(2, r.count)
        val r2 = r.toggle(1).toggle(0)
        assertEquals(setOf(1, 2), r2.checked)
        assertEquals(listOf("你好", "东西"), r2.chosen().map { it.second.hanzi })
        val edited = r2.edit(2, card("东西").copy(english = "thing"))
        assertEquals("thing", edited.cards[2].english)
    }

    @Test fun reviewChecksTheCardStandardLocally() {
        val r = FlashcardReview.of(listOf(card("你好/您好"), card("商店"), ProposedCard("东西", "", "thing")))
        val p = r.localProblems()
        assertEquals(setOf(0, 2), p.keys)
    }

    @Test fun afterBatchKeepsOnlyTheFailedCards() {
        val r = FlashcardReview.of(listOf(card("a"), card("b", have = true), card("c"), card("d")))
        // Sent a, c, d (request indexes 0, 1, 2); c failed.
        val after = r.afterBatch(sent = listOf(0, 2, 3), failed = mapOf(1 to "pinyin is required"))
        assertEquals(listOf("b", "c"), after.cards.map { it.hanzi })
        assertEquals(setOf(1), after.checked, "the failed card stays checked, the unchecked one stays unchecked")
        assertEquals(mapOf(1 to "pinyin is required"), after.problems)
    }
}
