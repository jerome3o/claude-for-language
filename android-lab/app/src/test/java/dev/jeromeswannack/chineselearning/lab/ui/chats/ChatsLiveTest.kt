package dev.jeromeswannack.chineselearning.lab.ui.chats

import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.chat.LiveEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The live socket → the cached inbox (Chats.applyLive) and who ✏️ can start a chat with. */
class ChatsLiveTest {
    private val rows = ChatsSamples.rows
    private fun ids(r: List<dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow>?) = r!!.map { it.conversationId }
    private val never: (String) -> Boolean = { false }

    @Test fun aNewMessageMovesTheRowUpAndCountsUnread() {
        val m = ChatMessageDto(id = "n1", conversation_id = "c-anna", sender_id = "u-anna", content = "我明白了", created_at = "2026-10-03T11:00:00Z")
        val next = Chats.applyLive(rows, LiveEvent.Message("c-anna", m, "rel-anna"), "me", never)
        assertEquals("c-anna", ids(next)[0])
        assertEquals(1, next!![0].unread)
        assertEquals("我明白了", next[0].lastMessage?.preview)
    }

    @Test fun theChatOnScreenStaysRead() {
        val m = ChatMessageDto(id = "n1", conversation_id = "c-anna", sender_id = "u-anna", content = "好", created_at = "2026-10-03T11:00:00Z")
        val next = Chats.applyLive(rows, LiveEvent.Message("c-anna", m, "rel-anna"), "me") { it == "c-anna" }
        assertEquals(0, next!!.first { it.conversationId == "c-anna" }.unread)
    }

    @Test fun photosVoiceAndDeletedGetTheServersPreview() {
        val photo = ChatMessageDto(id = "p", sender_id = "u-wei", content = " 看 ", created_at = "2026-10-03T11:00:00Z", attachment = ChatAttachmentDto(kind = "image"))
        assertEquals("📷 Photo: 看", Chats.previewOf(photo))
        assertEquals("🎤 Voice message", Chats.previewOf(photo.copy(content = "", attachment = ChatAttachmentDto(kind = "voice"))))
        assertEquals("Message deleted", Chats.previewOf(photo.copy(deleted_at = "2026-10-03T11:00:00Z")))
    }

    @Test fun unknownConversationOrNudgeRefetches() {
        val m = ChatMessageDto(id = "x", sender_id = "u-new", content = "hi", created_at = "2026-10-03T11:00:00Z")
        assertNull(Chats.applyLive(rows, LiveEvent.Message("c-new", m, "rel-new"), "me", never))
        assertNull(Chats.applyLive(rows, LiveEvent.Message("c-hw", null, null), "me", never))
    }

    @Test fun editsOnlyTouchTheLastMessage() {
        val edit = ChatMessageDto(id = "m1", sender_id = "u-minghui", content = "你做完作业了吗？", created_at = "2026-10-03T10:42:00Z")
        val next = Chats.applyLive(rows, LiveEvent.Updated("c-hw", edit), "me", never)!!
        assertEquals("你做完作业了吗？", next.first { it.conversationId == "c-hw" }.lastMessage?.preview)
        assertEquals(2, next.first { it.conversationId == "c-hw" }.unread)
        // A reaction on an older message changes nothing.
        val old = edit.copy(id = "older")
        assertEquals(rows, Chats.applyLive(rows, LiveEvent.Updated("c-hw", old), "me", never))
    }

    @Test fun onlyMyReadMarkerClearsUnread() {
        assertEquals(0, Chats.applyLive(rows, LiveEvent.Read("c-hw", "me", null), "me", never)!!.first { it.conversationId == "c-hw" }.unread)
        assertEquals(rows, Chats.applyLive(rows, LiveEvent.Read("c-hw", "u-minghui", null), "me", never))
    }

    @Test fun newChatPeople() {
        val people = ChatsViewModel.peopleFor(rows, null, "me")
        assertEquals(listOf("rel-minghui", "rel-wei", "rel-anna", "rel-tom"), people.map { it.relationshipId })
        assertEquals("Your tutor", people[0].role)
        // A connection with no chat yet comes from the cached relationships; Claude never does.
        val rels = MyRelationshipsDto(
            tutors = listOf(RelationshipDto("rel-claude", requester_id = "me", recipient_id = "claude-ai", status = "active", recipient = UserSummaryDto("claude-ai", name = "Claude"))),
            students = listOf(
                RelationshipDto("rel-li", requester_id = "me", recipient_id = "u-li", status = "active", recipient = UserSummaryDto("u-li", name = "Li Na")),
                RelationshipDto("rel-old", requester_id = "me", recipient_id = "u-old", status = "removed", recipient = UserSummaryDto("u-old", name = "Old")),
            ),
        )
        assertEquals(listOf("rel-minghui", "rel-wei", "rel-anna", "rel-tom", "rel-li"), ChatsViewModel.peopleFor(rows, rels, "me").map { it.relationshipId })
        assertEquals(listOf("rel-li"), ChatsViewModel.peopleFor(emptyList(), rels, "me").map { it.relationshipId })
    }
}
