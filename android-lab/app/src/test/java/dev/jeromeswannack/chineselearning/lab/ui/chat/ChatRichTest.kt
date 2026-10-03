package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.SendMessageBody
import dev.jeromeswannack.chineselearning.lab.data.api.chatMediaUploadPath
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatActions
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaSizing
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.OutboxEntity
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

/** docs/CHAT.md PR 2 rules: merge + cursor, receipts, outbox → pending bubbles, typing, unread, photo sizes. */
class ChatRichTest {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private fun m(id: String, at: String, sender: String = "them", content: String = "x", clientId: String? = null) =
        ChatMessageDto(id, conversation_id = "c1", sender_id = sender, content = content, created_at = at, client_id = clientId)

    private fun outbox(id: String, kind: String, path: String, body: String? = null, state: String = Outbox.PENDING, file: String? = null, at: Long = 1) =
        OutboxEntity(id = id, kind = kind, method = "POST", path = path, bodyJson = body, filePath = file, fileField = null, fileName = null, fileMime = null, createdAt = at, state = state)

    // ---- merge by id + cursor ----

    @Test
    fun anUpdatedCopyReplacesTheOldOneAndTheCursorOnlyMovesForward() {
        val list = listOf(m("1", "2026-10-02T10:00:00.000Z"), m("2", "2026-10-02T10:01:00.000Z", content = "原来"))
        val deleted = m("2", "2026-10-02T10:01:00.000Z", content = "").copy(deleted_at = "2026-10-02T10:05:00.000Z", updated_at = "2026-10-02T10:05:00.000Z")
        val merged = ChatLogic.merge(list, listOf(deleted, m("3", "2026-10-02T10:06:00.000Z")))
        assertEquals(listOf("1", "2", "3"), merged.map { it.id })
        assertTrue(merged[1].isDeleted)
        assertEquals("2026-10-02T10:05:00.000Z", ChatRich.nextCursor("2026-10-02T10:01:00.000Z", "2026-10-02T10:05:00.000Z"))
        assertEquals("2026-10-02T10:05:00.000Z", ChatRich.nextCursor("2026-10-02T10:05:00.000Z", "2026-10-02T10:01:00.000Z"))
        assertEquals("2026-10-02T10:01:00.000Z", ChatRich.nextCursor("2026-10-02T10:01:00.000Z", null))
        assertEquals("a", ChatRich.nextCursor(null, "a"))
    }

    // ---- receipts ----

    @Test
    fun receiptIsSeenOnceTheirMarkerReachesMyNewestMessage() {
        val msgs = listOf(m("1", "2026-10-02T10:00:00.000Z", "me"), m("2", "2026-10-02T10:01:00.000Z", "them"), m("3", "2026-10-02T10:02:00.000Z", "me"))
        assertEquals("3" to ChatRich.Receipt.SENT, ChatRich.receipt(msgs, "me", "2026-10-02T10:01:30.000Z", emptyList()))
        assertEquals("3" to ChatRich.Receipt.SEEN, ChatRich.receipt(msgs, "me", "2026-10-02T10:02:00.000Z", emptyList()))
        assertEquals("3" to ChatRich.Receipt.SENT, ChatRich.receipt(msgs, "me", null, emptyList()))
        // A pending send shows its own clock instead.
        assertNull(ChatRich.receipt(msgs, "me", "2026-10-02T10:02:00.000Z", listOf(PendingBubble("c", "text", "hi", 1))))
        assertNull(ChatRich.receipt(listOf(m("2", "2026-10-02T10:01:00.000Z", "them")), "me", null, emptyList()))
        // A deleted newest message is skipped.
        val withDeleted = msgs + m("4", "2026-10-02T10:03:00.000Z", "me").copy(deleted_at = "2026-10-02T10:04:00.000Z")
        assertEquals("3", ChatRich.receipt(withDeleted, "me", null, emptyList())!!.first)
    }

    @Test
    fun theOtherReadMarkerNeverMovesBack() {
        assertEquals("b", ChatRich.laterOf("b", "a"))
        assertEquals("b", ChatRich.laterOf("a", "b"))
        assertEquals("a", ChatRich.laterOf(null, "a"))
    }

    // ---- outbox → bubbles ----

    @Test
    fun outboxRowsOfThisChatBecomePendingBubbles() {
        val text = outbox("cid-1", ChatActions.KIND_SEND, "/api/conversations/c1/messages", json.encodeToString(SendMessageBody.serializer(), SendMessageBody("明天见", "m9", "cid-1")), at = 5)
        val other = outbox("cid-2", ChatActions.KIND_SEND, "/api/conversations/c2/messages", json.encodeToString(SendMessageBody.serializer(), SendMessageBody("x", null, "cid-2")))
        val photo = outbox("cid-3", ChatActions.KIND_MEDIA, chatMediaUploadPath("c1", "image", "cid-3", "我的猫 & dog"), file = "/tmp/p.jpg", at = 7, state = Outbox.FAILED)
        val voice = outbox("cid-4", ChatActions.KIND_MEDIA, chatMediaUploadPath("c1", "voice", "cid-4", durationMs = 4200), file = "/tmp/v.m4a", at = 9)
        val read = outbox("r", ChatActions.KIND_READ, "/api/conversations/c1/read", "{}")
        val bubbles = ChatRich.pendingFromOutbox(listOf(text, other, photo, voice, read), "c1", json) { 1600 to 1200 }
        assertEquals(listOf("cid-1", "cid-3", "cid-4"), bubbles.map { it.clientId })
        assertEquals(PendingBubble("cid-1", "text", "明天见", 5, replyToId = "m9"), bubbles[0])
        assertEquals("image", bubbles[1].kind)
        assertEquals("我的猫 & dog", bubbles[1].content)
        assertTrue(bubbles[1].failed)
        assertEquals(1600, bubbles[1].width)
        assertEquals("/tmp/p.jpg", bubbles[1].filePath)
        assertEquals(4200L, bubbles[2].durationMs)
        assertFalse(bubbles[2].failed)
        // The server's copy (same client_id) replaces the bubble.
        val visible = ChatRich.visiblePending(bubbles, listOf(m("s1", "2026-10-02T10:00:00.000Z", "me", clientId = "cid-1")))
        assertEquals(listOf("cid-3", "cid-4"), visible.map { it.clientId })
    }

    // ---- typing ----

    @Test
    fun typingShowsForFourSecondsAfterTheLastEventAndClearsOnTheirMessage() {
        val t = TypingIndicator()
        assertFalse(t.visible(0))
        t.onTyping(1_000)
        assertTrue(t.visible(4_999))
        assertFalse(t.visible(5_000))
        t.onTyping(3_000)
        assertEquals(3_000L, t.remaining(4_000))
        t.onMessage()
        assertFalse(t.visible(4_000))
        assertEquals(0L, t.remaining(4_000))
    }

    @Test
    fun typingFramesGoAtMostEveryTwoAndAHalfSecondsWhileTheBoxChanges() {
        val th = TypingThrottle()
        assertTrue(th.shouldSend("你", 0))
        assertFalse(th.shouldSend("你好", 1_000))
        assertFalse(th.shouldSend("你好", 3_000)) // unchanged
        assertTrue(th.shouldSend("你好吗", 3_000))
        assertFalse(th.shouldSend("", 9_000)) // emptied
        th.reset()
        assertTrue(th.shouldSend("a", 9_100))
    }

    // ---- unread, pins, preview, rows ----

    @Test
    fun theDividerSitsAtTheirFirstMessageAfterMyOldMarker() {
        val msgs = listOf(m("1", "2026-10-02T10:00:00.000Z"), m("2", "2026-10-02T10:01:00.000Z", "me"), m("3", "2026-10-02T10:02:00.000Z"), m("4", "2026-10-02T10:03:00.000Z"))
        assertEquals("3", ChatRich.firstUnreadId(msgs, "me", "2026-10-02T10:00:00.000Z"))
        assertNull(ChatRich.firstUnreadId(msgs, "me", "2026-10-02T10:03:00.000Z"))
        assertEquals("1", ChatRich.firstUnreadId(msgs, "me", null))
        val now = java.time.Instant.parse("2026-10-02T12:00:00Z").toEpochMilli()
        val rows = ChatRows.build(msgs, listOf(PendingBubble("p", "text", "hi", now)), "3", "me", "2026-10-02T10:01:00.000Z", now, 0)
        assertEquals(listOf("d-1", "1", "2", "unread", "3", "4", "p-p"), rows.map { it.key })
        assertEquals("Today", (rows[0] as ChatRow.Day).label)
        assertEquals(dev.jeromeswannack.chineselearning.lab.core.ChatBubbles.Tick.READ, (rows[2] as ChatRow.Msg).layout.tick)
        assertEquals(dev.jeromeswannack.chineselearning.lab.core.ChatBubbles.Tick.PENDING, (rows.last() as ChatRow.Pending).layout.tick)
    }

    @Test
    fun pinnedNewestFirstAndPreviewsUseTheWorkersWords() {
        val msgs = listOf(
            m("1", "a").copy(pinned_at = "2026-10-01T00:00:00Z"),
            m("2", "b").copy(pinned_at = "2026-10-02T00:00:00Z"),
            m("3", "c").copy(pinned_at = "2026-10-03T00:00:00Z", deleted_at = "x"),
        )
        assertEquals(listOf("2", "1"), ChatRich.pinned(msgs).map { it.id })
        assertEquals("📷 Photo", ChatRich.preview("", "image", null))
        assertEquals("📷 Photo: 我的猫", ChatRich.preview("我的猫", "image", null))
        assertEquals("🎤 Voice message", ChatRich.preview("", "voice", null))
        assertEquals("Message deleted", ChatRich.preview("", null, "2026-10-02"))
        assertEquals("你好", ChatRich.preview("你好", null, null))
        assertEquals("0:07", ChatRich.duration(7_400))
        assertEquals("1:05", ChatRich.duration(65_000))
    }

    @Test
    fun notificationsSayPhotoAndVoiceLikeTheWorker() {
        val photo = m("p", "a", content = "第三题").copy(attachment = ChatAttachmentDto(kind = "image"))
        assertEquals("📷 Photo: 第三题", dev.jeromeswannack.chineselearning.lab.data.chat.IncomingChat.fromMessage(photo, "r1").content)
        val voice = m("v", "a", content = "").copy(attachment = ChatAttachmentDto(kind = "voice"))
        assertEquals("🎤 Voice message", dev.jeromeswannack.chineselearning.lab.data.chat.IncomingChat.fromMessage(voice, "r1").content)
        assertEquals("你好", dev.jeromeswannack.chineselearning.lab.data.chat.IncomingChat.fromMessage(m("t", "a", content = "你好"), "r1").content)
    }

    @Test
    fun searchCoversVoiceTranscripts() {
        val voice = m("v", "a", content = "").copy(attachment = ChatAttachmentDto(kind = "voice", transcript_status = "done", transcript = "我想去银行", translation = "I want to go to the bank"))
        val s = ChatRich.searchable(voice)
        assertTrue(dev.jeromeswannack.chineselearning.lab.core.ChatSearch.matches(s, "bank"))
        assertTrue(dev.jeromeswannack.chineselearning.lab.core.ChatSearch.matches(s, "银行"))
    }

    // ---- photo sizes ----

    @Test
    fun photosShrinkToSixteenHundredOnTheLongSide() {
        assertEquals(1600 to 1200, ChatMediaSizing.targetSize(4000, 3000))
        assertEquals(900 to 1600, ChatMediaSizing.targetSize(2160, 3840))
        assertEquals(800 to 600, ChatMediaSizing.targetSize(800, 600)) // never upscaled
        assertEquals(1600 to 1, ChatMediaSizing.targetSize(9000, 2))
        assertEquals(0 to 0, ChatMediaSizing.targetSize(0, 10))
        assertEquals(2, ChatMediaSizing.sampleSize(4000, 3000))
        assertEquals(1, ChatMediaSizing.sampleSize(1600, 1200))
        assertEquals(4, ChatMediaSizing.sampleSize(8000, 6000))
    }

    @Test
    fun bubblesKeepTheAspectRatioWithinLimits() {
        assertEquals(260f to 195f, ChatMediaSizing.bubbleSize(1600, 1200))
        val tall = ChatMediaSizing.bubbleSize(900, 1600)
        assertEquals(280f, tall.second)
        assertEquals(157.5f, tall.first, 0.01f)
        assertEquals(260f to 110f, ChatMediaSizing.bubbleSize(4000, 500)) // panorama: min height
        assertEquals(260f to 195f, ChatMediaSizing.bubbleSize(0, 0))
    }
}
