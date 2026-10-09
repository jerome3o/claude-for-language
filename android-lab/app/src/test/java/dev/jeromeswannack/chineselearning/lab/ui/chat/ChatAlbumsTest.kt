package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.core.ChatBubbles
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.data.api.AlbumRef
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ForwardBody
import dev.jeromeswannack.chineselearning.lab.data.api.InboxMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.chatMediaUploadPath
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatActions as ChatWrites
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatPushData
import dev.jeromeswannack.chineselearning.lab.data.chat.IncomingChat
import dev.jeromeswannack.chineselearning.lab.data.chat.PushEvent
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Photo albums in the Lab app (docs/CHAT.md "Photo albums"): rows (album / pending / old photos),
 * the upload + forward paths, the outbox keeping the album id, the album menu, one notification line.
 */
class ChatAlbumsTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val now = Instant.parse("2026-10-08T09:00:00Z").toEpochMilli()

    private fun photo(id: String, at: String, sender: String = "me", album: String? = "al-1", index: Int? = 0, caption: String = "", deleted: Boolean = false) =
        ChatMessageDto(
            id, conversation_id = "c1", sender_id = sender, content = caption, created_at = at,
            attachment = if (deleted) null else ChatAttachmentDto("image", width = 1600, height = 1200, bytes = 300_000, mime = "image/jpeg"),
            media_url = if (deleted) null else "/api/chat-media/$id",
            deleted_at = if (deleted) "2026-10-08T09:10:00Z" else null,
            album_id = album, album_index = index,
        )

    private fun text(id: String, at: String, sender: String = "them") = ChatMessageDto(id, conversation_id = "c1", sender_id = sender, content = "好看！", created_at = at)

    @Test fun anAlbumIsOneRowWithItsCaptionHeadAndLastPhoto() {
        val msgs = listOf(
            text("t", "2026-10-08T08:59:00Z"),
            photo("a", "2026-10-08T09:00:00Z", index = 0, caption = "我们的猫"),
            photo("b", "2026-10-08T09:00:02Z", index = 1),
            photo("c", "2026-10-08T09:00:04Z", index = 2),
        )
        val rows = ChatRows.build(msgs, emptyList(), null, "me", "2026-10-08T09:00:04Z", now, 0)
        assertEquals(listOf("d-t", "t", "album-a"), rows.map { it.key })
        val album = rows.last() as ChatRow.Album
        assertEquals(listOf("a", "b", "c"), album.photos.map { it.id })
        assertEquals("a", album.caption?.id)
        assertEquals("a", album.head.id)
        assertEquals("c", album.last.id)
        assertEquals(ChatBubbles.Tick.READ, album.layout.tick)
        assertTrue(album.mine)
        assertFalse(album.pending)
    }

    @Test fun myPhotosStillInTheOutboxJoinTheirAlbum() {
        val msgs = listOf(photo("a", "2026-10-08T08:59:58Z", index = 0))
        val pending = listOf(
            PendingBubble("p1", "image", "", now - 1_000, filePath = "/staged/1", width = 1600, height = 1200, albumId = "al-1"),
            PendingBubble("p2", "image", "", now, failed = true, filePath = "/staged/2", width = 1200, height = 1600, albumId = "al-1"),
        )
        val rows = ChatRows.build(msgs, pending, null, "me", null, now, 0)
        val album = rows.filterIsInstance<ChatRow.Album>().single()
        assertEquals(listOf("a", "p-p1", "p-p2"), album.photos.map { it.id })
        assertEquals(ChatBubbles.Tick.FAILED, album.layout.tick)
        assertTrue(album.failed)
        assertEquals(listOf("a"), album.messages.map { it.id })
    }

    @Test fun aDeletedPhotoIsHiddenAndOldPhotosGroupByTheTenSecondRule() {
        val msgs = listOf(
            photo("a", "2026-10-08T08:00:00Z", index = 0),
            photo("b", "2026-10-08T08:00:01Z", index = 1, deleted = true),
            photo("c", "2026-10-08T08:00:02Z", index = 2),
            // Before albums existed: no album id, sent 3 s apart, a caption on the first only.
            photo("o1", "2026-10-08T08:30:00Z", album = null, index = null, caption = "旧照片"),
            photo("o2", "2026-10-08T08:30:03Z", album = null, index = null),
            photo("o3", "2026-10-08T08:30:30Z", album = null, index = null),
        )
        val rows = ChatRows.build(msgs, emptyList(), null, "me", null, now, 0)
        val albums = rows.filterIsInstance<ChatRow.Album>()
        assertEquals(listOf(listOf("a", "c"), listOf("o1", "o2")), albums.map { a -> a.photos.map { it.id } })
        assertEquals(listOf("o3"), rows.filterIsInstance<ChatRow.Msg>().map { it.message.id })
    }

    @Test fun theUnreadDividerSitsAboveTheAlbumThatHoldsIt() {
        val msgs = listOf(photo("a", "2026-10-08T09:00:00Z", sender = "them"), photo("b", "2026-10-08T09:00:01Z", sender = "them", index = 1))
        val rows = ChatRows.build(msgs, emptyList(), "b", "me", null, now, 0)
        assertEquals(listOf("d-a", "unread", "album-a"), rows.map { it.key })
    }

    @Test fun uploadAndForwardCarryTheAlbum() {
        assertEquals(
            "/api/conversations/c1/media?kind=image&client_id=x&album_id=al-1&album_index=2&album_count=3&caption=%E7%8C%AB",
            chatMediaUploadPath("c1", "image", "x", "猫", album = AlbumRef("al-1", 2, 3)),
        )
        assertEquals("/api/conversations/c1/media?kind=image&client_id=x", chatMediaUploadPath("c1", "image", "x"))
        assertEquals("""{"conversation_id":"c2","client_id":"k"}""", json.encodeToString(ForwardBody.serializer(), ForwardBody("c2", "k")))
        assertEquals(
            """{"conversation_id":"c2","client_id":"k","album_id":"fw","album_index":1,"album_count":2}""",
            json.encodeToString(ForwardBody.serializer(), ForwardBody("c2", "k", "fw", 1, 2)),
        )
    }

    @Test fun theOutboxKeepsTheAlbumIdOfEachPhoto() {
        val path = chatMediaUploadPath("c1", "image", "cid-1", album = AlbumRef("al-9", 0, 2))
        val row = OutboxEntity(id = "cid-1", kind = ChatWrites.KIND_MEDIA, method = "POST", path = path, bodyJson = null, filePath = "/staged/a", fileField = null, fileName = null, fileMime = null, createdAt = 3, state = Outbox.PENDING)
        val bubble = ChatRich.pendingFromOutbox(listOf(row), "c1", json) { 1600 to 1200 }.single()
        assertEquals("al-9", bubble.albumId)
        assertEquals("al-9", ChatRows.bubbleOf(bubble, "me").albumId)
    }

    @Test fun theAlbumMenuKeepsWholeAlbumActions() {
        val m = MessageMenu.Message(senderId = "me", content = "我们的猫", attachmentKind = "image")
        val menu = MessageMenu.albumMenu(MessageMenu.messageMenu(m, "student", false, "me"), 3)
        assertEquals(listOf("reply", "copy", "forward", "explain", "save_card", "pin", "info", "edit", "delete"), menu.items.map { it.id })
        assertEquals("Forward all 3", menu.items.first { it.id == MessageMenu.FORWARD }.label)
        assertEquals("Delete all 3", menu.items.first { it.id == MessageMenu.DELETE }.label)
    }

    @Test fun anAlbumIsOneNotificationLineHoweverItArrives() {
        val push = ChatPushData.parse(
            mapOf(
                "type" to "chat_message", "conversation_id" to "c1", "relationship_id" to "r1", "message_id" to "a",
                "sender_id" to "u-t", "sender_name" to "Minghui", "content" to "📷 3 photos: 我们的猫", "album_id" to "al-1", "album_count" to "3",
            ),
        ) as PushEvent.Message
        val live = IncomingChat.fromMessage(photo("b", "2026-10-08T09:00:02Z", sender = "u-t").copy(sender = ChatSenderDto("u-t", "Minghui")), "r1", albumCount = 3)
        val inbox = IncomingChat.fromInbox(InboxMessageDto("a", "c1", "r1", "我们的猫", "2026-10-08T09:00:00Z", ChatSenderDto("u-t", "Minghui"), "image", "📷 3 photos: 我们的猫", album_id = "al-1", album_count = 3))
        assertEquals("album:c1:al-1", push.chat.lineKey)
        assertEquals(push.chat.lineKey, live.lineKey)
        assertEquals(push.chat.lineKey, inbox.lineKey)
        assertEquals("📷 3 photos", live.content)
        // A photo on its own keeps its own line.
        val single = IncomingChat.fromMessage(photo("s", "2026-10-08T09:00:00Z", album = null, index = null), "r1")
        assertEquals("s", single.lineKey)
        assertEquals("📷 Photo", single.content)
        assertNull(single.albumId)
    }
}
