package dev.jeromeswannack.chineselearning.lab.data.chat

import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListPerson
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListResponse
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** One chat per pair (docs/CHAT.md): the pure rules behind merged ids and "THE chat of a pair". */
class ChatPairTest {
    @Test fun aliasesFollowToThePrimaryAndStopOnACycle() {
        val map = mapOf("a" to "b", "b" to "c", "x" to "y", "y" to "x")
        assertEquals("c", ChatPair.follow(map, "a"))
        assertEquals("c", ChatPair.follow(map, "c"))
        assertEquals("z", ChatPair.follow(map, "z"))
        // A bad map never hangs.
        ChatPair.follow(map, "x")
        assertEquals(listOf("c", "a", "b"), ChatPair.aliasesOf(map, "c"))
        assertEquals(listOf("z"), ChatPair.aliasesOf(map, "z"))
    }

    @Test fun theServerRevealsAMergeThroughTheMessagesOrTheLookup() {
        val m = ChatMessageDto("m1", conversation_id = "primary")
        assertEquals("primary", ChatPair.mergedInto("old", listOf(m)))
        assertNull(ChatPair.mergedInto("primary", listOf(m)))
        // Messages without an id (an old cache) say nothing.
        assertNull(ChatPair.mergedInto("old", listOf(ChatMessageDto("m1"))))
        // An empty chat: GET /api/conversations/:id answers with merged_from.
        assertEquals("primary", ChatPair.mergedInto("old", emptyList(), ConversationLookupDto("primary", merged_from = "old")))
        assertNull(ChatPair.mergedInto("old", emptyList(), ConversationLookupDto("old")))
        assertNull(ChatPair.mergedInto("old", emptyList(), null))
    }

    private fun row(conv: String, rel: String, at: String, ai: Boolean = false) =
        ChatListRow(conv, rel, null, ai, ChatListPerson("u", "Minghui"), "tutor", null, 0, at)

    @Test fun theCachedChatOfAPair() {
        val inbox = ChatListResponse(
            "", listOf(row("ai-1", "rel-c", "2026-10-03T00:00:00Z", ai = true), row("c-min", "rel-m", "2026-10-02T00:00:00Z")),
        )
        val convs = listOf(
            ChatConversationDto("old", "rel-m", null, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
            ChatConversationDto("newer", "rel-m", null, "2026-03-01T00:00:00Z", "2026-09-01T00:00:00Z"),
            ChatConversationDto("practice", "rel-m", null, "2026-03-01T00:00:00Z", "2026-10-01T00:00:00Z", is_ai_conversation = true),
        )
        // The last /open answer wins, mapped through the aliases.
        assertEquals("p", ChatPair.cachedChat("rel-m", "p", inbox, convs, emptyMap()))
        assertEquals("q", ChatPair.cachedChat("rel-m", "p", inbox, convs, mapOf("p" to "q")))
        // Else the inbox's row for that person (never a Claude chat).
        assertEquals("c-min", ChatPair.cachedChat("rel-m", null, inbox, convs, emptyMap()))
        assertNull(ChatPair.cachedChat("rel-c", null, inbox, null, emptyMap()))
        // Else the newest person-chat of the relationship's list.
        assertEquals("newer", ChatPair.cachedChat("rel-m", null, null, convs, emptyMap()))
        assertNull(ChatPair.cachedChat("rel-x", null, null, null, emptyMap()))
    }
}
