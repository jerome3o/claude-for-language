package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.core.ChatBubbles
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ExplainedWord
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceExplanation
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatLinkPreviews
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatWaveforms
import dev.jeromeswannack.chineselearning.lab.data.chat.LinkPreviewDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Chat round 2 (docs/CHAT.md "Round 2"): rows with groups / days / ticks, the composer's caret, waveforms, previews, the sentence card. */
class ChatRound2Test {
    private fun m(id: String, at: String, sender: String = "them", deleted: String? = null) =
        ChatMessageDto(id, conversation_id = "c1", sender_id = sender, content = "好", created_at = at, deleted_at = deleted)

    private val now = Instant.parse("2026-10-03T09:00:00Z").toEpochMilli()

    @Test fun rowsGroupByPersonAndThreeMinutesWithDayPills() {
        val msgs = listOf(
            m("a", "2026-09-28T09:00:00Z"),
            m("b", "2026-10-02T23:59:00Z", "me"),
            m("c", "2026-10-03T00:01:00Z", "me"),
            m("d", "2026-10-03T00:03:30Z", "me"),
            m("e", "2026-10-03T00:07:00Z", "me"),
            m("f", "2026-10-03T00:08:00Z", "them"),
        )
        val rows = ChatRows.build(msgs, emptyList(), null, "me", "2026-10-03T00:03:30Z", now, 0)
        assertEquals(listOf("d-a", "a", "d-b", "b", "d-c", "c", "d", "e", "f"), rows.map { it.key })
        assertEquals(listOf("Mon 28 Sep", "Yesterday", "Today"), rows.filterIsInstance<ChatRow.Day>().map { it.label })
        val l = rows.filterIsInstance<ChatRow.Msg>().associate { it.message.id to it.layout }
        // c + d are one group (2.5 min apart, same day); e starts a new one (3.5 min); b is yesterday.
        assertTrue(l["c"]!!.firstInGroup && !l["c"]!!.lastInGroup)
        assertTrue(!l["d"]!!.firstInGroup && l["d"]!!.lastInGroup)
        assertTrue(l["e"]!!.firstInGroup && l["e"]!!.lastInGroup)
        assertEquals(ChatBubbles.Tick.READ, l["d"]!!.tick)
        assertEquals(ChatBubbles.Tick.SENT, l["e"]!!.tick)
        assertEquals(ChatBubbles.Tick.NONE, l["f"]!!.tick)
        // In UTC+8 the 23:59 message is already 3 Oct, the same day as the rest.
        val east = ChatRows.build(msgs, emptyList(), null, "me", null, now, 480)
        assertEquals(listOf("d-a", "d-b"), east.filterIsInstance<ChatRow.Day>().map { it.key })
    }

    @Test fun pendingBubblesJoinMyLastGroupAndCarryTheirOutboxState() {
        val msgs = listOf(m("a", "2026-10-03T08:59:00Z", "me"))
        val pending = listOf(PendingBubble("p1", "text", "hi", now - 30_000), PendingBubble("p2", "text", "!", now, failed = true))
        val rows = ChatRows.build(msgs, pending, null, "me", null, now, 0)
        val p = rows.filterIsInstance<ChatRow.Pending>()
        assertEquals(listOf(ChatBubbles.Tick.PENDING, ChatBubbles.Tick.FAILED), p.map { it.layout.tick })
        assertFalse(p[0].layout.firstInGroup)
        assertTrue(p[1].layout.lastInGroup)
        assertEquals(ChatBubbles.Tick.SENT, ChatRows.bubbleOf(pending[0].copy(delivered = true), "me").let { ChatBubbles.tickFor(it, "me", null) })
    }

    @Test fun dayLabels() {
        assertEquals("Today", ChatRows.dayLabel("2026-10-03", "2026-10-03"))
        assertEquals("Yesterday", ChatRows.dayLabel("2026-10-02", "2026-10-03"))
        assertEquals("Wed 30 Sep", ChatRows.dayLabel("2026-09-30", "2026-10-03"))
        assertEquals("", ChatRows.dayLabel("", "2026-10-03"))
    }

    @Test fun emojiGoesInAtTheCaret() {
        assertEquals("你😀好" to 3, insertAtCaret("你好", 1, 1, "😀"))
        assertEquals("😀" to 2, insertAtCaret("", 0, 0, "😀"))
        // A selection is replaced; a reversed one too.
        assertEquals("我👍" to 3, insertAtCaret("我很好", 3, 1, "👍"))
        assertEquals("ab👍" to 4, insertAtCaret("ab", 9, 9, "👍"))
    }

    @Test fun waveformsPoolToFortyBarsAndSeededOnesAreStable() {
        val peaks = List(96) { i -> if (i == 50) 0.5f else 0.1f }
        val bars = ChatWaveforms.pool(peaks)
        assertEquals(ChatWaveforms.BARS, bars.size)
        assertEquals(1f, bars.max(), 0f)
        assertEquals(0.2f, bars.first(), 1e-6f)
        assertEquals(List(40) { 0f }, ChatWaveforms.pool(List(10) { 0f }))
        assertEquals(ChatWaveforms.seeded("m1"), ChatWaveforms.seeded("m1"))
        assertNotEquals(ChatWaveforms.seeded("m1"), ChatWaveforms.seeded("m2"))
        assertEquals(40, ChatWaveforms.pool(listOf(0.3f, 0.9f)).size)
    }

    @Test fun linkPreviewsAreKeyedByAHashAndNeedSomethingToShow() {
        assertEquals(ChatLinkPreviews.key("https://a.com"), ChatLinkPreviews.key("https://a.com"))
        assertNotEquals(ChatLinkPreviews.key("https://a.com"), ChatLinkPreviews.key("https://b.com"))
        assertTrue(ChatLinkPreviews.key("https://a.com").startsWith("chat/link/"))
        assertFalse(LinkPreviewDto("https://a.com").usable)
        assertTrue(LinkPreviewDto("https://a.com", title = "A").usable)
    }

    @Test fun saveAsFlashcardMakesOneSentenceCard() {
        val e = SentenceExplanation(
            listOf(ExplainedWord("我", "wǒ", "I"), ExplainedWord("很", "hěn", "very"), ExplainedWord("好", "hǎo", "good")),
            construction = "很 + adjective: the usual way to say how you are.",
            translation = "I'm fine.",
        )
        val c = sentenceCardOf("我很好。", null, e)
        assertEquals("我很好。", c.hanzi)
        assertEquals("wǒ hěn hǎo", c.pinyin)
        assertEquals("I'm fine.", c.english)
        assertEquals("我 (wǒ) I\n很 (hěn) very\n好 (hǎo) good\n很 + adjective: the usual way to say how you are.", c.funFacts)
        // The message's own translation wins.
        assertEquals("I am well.", sentenceCardOf("我很好。", "I am well.", e).english)
    }

    @Test fun bubbleCornersFaceTheirNeighbours() {
        assertEquals(bubbleShape(true, first = true, last = true), bubbleShape(true, true, true))
        assertNotEquals(bubbleShape(true, first = false, last = true), bubbleShape(false, first = false, last = true))
    }
}
