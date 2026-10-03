package dev.jeromeswannack.chineselearning.lab.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The vitest cases of frontend/src/services/chatDrafts.test.ts, readable here. */
class ChatDraftsTest {
    @Test
    fun keepsADraftPerConversationAndClearsItWhenEmptied() {
        var d: List<ChatDrafts.Draft> = emptyList()
        d = ChatDrafts.save(d, "a", "我明天", 1)
        d = ChatDrafts.save(d, "b", "hello", 2)
        assertEquals("我明天", ChatDrafts.load(d, "a"))
        assertEquals("hello", ChatDrafts.load(d, "b"))
        d = ChatDrafts.save(d, "a", "   ", 3)
        assertEquals("", ChatDrafts.load(d, "a"))
        assertEquals("", ChatDrafts.load(d, null))
    }

    @Test
    fun keepsOnlyTheNewest50() {
        var d: List<ChatDrafts.Draft> = emptyList()
        for (i in 0 until 55) d = ChatDrafts.save(d, "c$i", "t$i", 1000L + i)
        assertEquals("", ChatDrafts.load(d, "c0"))
        assertEquals("t54", ChatDrafts.load(d, "c54"))
        assertEquals("t5", ChatDrafts.load(d, "c5"))
        assertEquals(50, d.size)
    }

    @Test
    fun labelsTheQueue() {
        assertNull(ChatDrafts.queueLabel(0, false))
        assertEquals("🕓 1 message waiting for a connection", ChatDrafts.queueLabel(1, false))
        assertEquals("🕓 Sending 3 messages…", ChatDrafts.queueLabel(3, true))
    }
}
