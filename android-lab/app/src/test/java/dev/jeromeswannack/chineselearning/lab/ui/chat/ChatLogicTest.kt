package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

class ChatLogicTest {
    private fun m(id: String, at: String, content: String = "x") = ChatMessageDto(id, content = content, created_at = at)

    @Test
    fun mergeReplacesByIdAndKeepsTimeOrder() {
        val a = listOf(m("1", "2026-09-27T10:00:00Z"), m("2", "2026-09-27T10:01:00Z"))
        val b = listOf(m("3", "2026-09-27T10:02:00Z"), m("2", "2026-09-27T10:01:00Z", "edited"), m("0", "2026-09-27T09:00:00Z"))
        val merged = ChatLogic.merge(a, b)
        assertEquals(listOf("0", "1", "2", "3"), merged.map { it.id })
        assertEquals("edited", merged[2].content)
    }

    @Test
    fun groupsByDayWithTodayAndYesterday() {
        val msgs = listOf(m("1", "2026-09-25T10:00:00Z"), m("2", "2026-09-26 10:00:00"), m("3", "2026-09-27T09:00:00Z"), m("4", "2026-09-27T10:00:00Z"))
        val g = ChatLogic.groupByDate(msgs, LocalDate.of(2026, 9, 27), ZoneOffset.UTC)
        assertEquals(listOf("Friday, Sep 25", "Yesterday", "Today"), g.map { it.label })
        assertEquals(listOf(1, 1, 2), g.map { it.messages.size })
    }

    @Test
    fun callInvitesBecomeAJoinButton() {
        val (text, id) = ChatLogic.callInvite("Video call starting — join here: https://chinese.example.dev/calls/abcDEF123_x")!!
        assertEquals("Video call starting", text)
        assertEquals("abcDEF123_x", id)
        assertNull(ChatLogic.callInvite("see https://example.com/calls/short"))
    }

    @Test
    fun quickEmojisPutRecentFirst() {
        assertEquals(ChatLogic.DEFAULT_EMOJIS, ChatLogic.quickEmojis(emptyList()))
        assertEquals(listOf("🍵", "👍", "❤️", "😂", "😮", "👏"), ChatLogic.quickEmojis(listOf("🍵", "👍")))
        assertEquals(listOf("🔥", "a", "b", "c", "d"), ChatLogic.pushRecent(listOf("a", "b", "c", "d", "e"), "🔥"))
        assertEquals(listOf("b", "a"), ChatLogic.pushRecent(listOf("a", "b"), "b"))
    }
}
