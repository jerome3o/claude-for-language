package dev.jeromeswannack.chineselearning.lab.ui.chat

import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatCorrectionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionUserDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.api.chatMediaUploadPath
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaSizing
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaStore
import dev.jeromeswannack.chineselearning.lab.data.chat.IncomingChat
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Round 2 PR 3's pure rules: the forward list, the queue line, message info, previews, the upload path, file names. */
class ChatRound3Test {
    private val tutorRel = RelationshipDto("r1", "me", "t1", "student", "active", recipient = UserSummaryDto("t1", name = "Minghui Li"))
    private val studentRel = RelationshipDto("r2", "s2", "me", "student", "active", requester = UserSummaryDto("s2", email = "anna@example.com"))

    @Test fun forwardTargetsAreEveryPersonConversationNewestFirst() {
        val convs = mapOf(
            "r1" to listOf(
                ChatConversationDto("old", "r1", "Grammar", "2026-01-01T00:00:00Z", last_message_at = "2026-02-01T00:00:00Z"),
                ChatConversationDto("ai", "r1", "Café role-play", "2026-09-01T00:00:00Z", last_message_at = "2026-10-03T00:00:00Z", is_ai_conversation = true),
                ChatConversationDto("new", "r1", "", "2026-09-01T00:00:00Z", last_message_at = "2026-10-02T00:00:00Z"),
            ),
            // No last message: its creation time counts.
            "r2" to listOf(ChatConversationDto("anna", "r2", null, "2026-09-15T00:00:00Z")),
        )
        val t = ChatRound3.forwardTargets(MyRelationshipsDto(tutors = listOf(tutorRel), students = listOf(studentRel)), convs, "me")
        assertEquals(listOf("new", "anna", "old"), t.map { it.conversationId })
        assertEquals(ForwardTarget("new", "r1", "Minghui Li", null), t[0])
        assertEquals("anna@example.com", t[1].label, "no name → the email, like the web")
        assertEquals("Grammar", t[2].sub)
        assertEquals(emptyList(), ChatRound3.forwardTargets(MyRelationshipsDto(), emptyMap(), "me"))
    }

    @Test fun forwardNotices() {
        val t = ForwardTarget("c", "r", "Minghui", "Weekly chat")
        assertEquals("Forwarded the message to Minghui · Weekly chat.", ChatRound3.forwardedNotice(1, t))
        assertEquals("Forwarded 3 messages to Minghui.", ChatRound3.forwardedNotice(3, t.copy(sub = null)))
        assertEquals("The file is gone.", ChatRound3.forwardError("HTTP 410: {\"error\":\"The file is gone\"}"))
        assertEquals("That message was deleted.", ChatRound3.forwardError("HTTP 400: {\"error\": \"That message was deleted.\"}"))
        assertEquals("", ChatRound3.forwardError("HTTP 403: <html>"))
        assertEquals("", ChatRound3.forwardError(null))
    }

    @Test fun theQueueLineCountsWhatIsStillGoing() {
        val p = PendingBubble("a", "text", "你好", 1)
        assertNull(ChatRound3.queueLabel(emptyList(), true))
        assertEquals("🕓 1 message waiting for a connection", ChatRound3.queueLabel(listOf(p, p.copy(clientId = "b", failed = true)), false))
        assertEquals("🕓 Sending 2 messages…", ChatRound3.queueLabel(listOf(p, p.copy(clientId = "b", kind = "image"), p.copy(clientId = "c", delivered = true)), true))
    }

    private val me = ChatSenderDto("me", "Jerome")
    private val mh = ChatSenderDto("t1", "Minghui")

    @Test fun infoRowsLikeTheWeb() {
        val m = ChatMessageDto(
            "m", "c", "me", "  你好！😀 ", "2026-10-03T08:41:00.000Z", sender = me,
            edited_at = "2026-10-03T08:45:00.000Z", forwarded_from = "src", pinned_at = "2026-10-03T09:00:00.000Z",
            correction = ChatCorrectionDto("你好！", null, "t1", "2026-10-03T09:30:00.000Z"),
            reactions = listOf(ReactionDto("❤️", listOf(ReactionUserDto("t1", "Minghui"), ReactionUserDto("x", null)), 2)),
        )
        val rows = ChatRound3.infoRows(m, "me", "Minghui", "2026-10-03T08:50:00.000Z", ZoneOffset.UTC)
        assertEquals(
            listOf(
                "From" to "You", "Sent" to "Sat 3 Oct, 8:41 AM", "Edited" to "Sat 3 Oct, 8:45 AM", "Read by Minghui" to "Yes ✓✓",
                "Forwarded" to "Yes", "Pinned" to "Sat 3 Oct, 9:00 AM", "Corrected" to "Sat 3 Oct, 9:30 AM",
                "Characters" to "4", "Reactions" to "❤️ Minghui, ?",
            ),
            rows,
        )
        assertEquals("Not yet", ChatRound3.infoRows(m, "me", "Minghui", "2026-10-03T08:40:00.000Z", ZoneOffset.UTC).toMap()["Read by Minghui"])
        assertEquals("Not yet", ChatRound3.infoRows(m, "me", "Minghui", null, ZoneOffset.UTC).toMap()["Read by Minghui"])
    }

    @Test fun infoRowsForAttachments() {
        fun rows(a: ChatAttachmentDto) = ChatRound3.infoRows(ChatMessageDto("x", "c", "t1", "", "2026-10-03T08:41:00Z", sender = mh, attachment = a), "me", "Minghui", null, ZoneOffset.UTC)
        assertEquals(listOf("From" to "Minghui", "Sent" to "Sat 3 Oct, 8:41 AM", "Photo" to "1600 × 1200 · 313 KB"), rows(ChatAttachmentDto("image", width = 1600, height = 1200, bytes = 320_000)))
        assertEquals("0:06 · 52 KB · transcript done", rows(ChatAttachmentDto("voice", duration_ms = 6_400, bytes = 53_000, transcript_status = "done")).toMap()["Voice"])
        assertEquals("HSK3.pdf · 840 KB", rows(ChatAttachmentDto("file", name = "HSK3.pdf", bytes = 860_000)).toMap()["File"])
        assertEquals("0:12 · 3.2 MB", rows(ChatAttachmentDto("video", duration_ms = 12_400, bytes = (3.2 * 1024 * 1024).toLong())).toMap()["Video"])
        assertEquals("3.2 MB", rows(ChatAttachmentDto("video", bytes = (3.2 * 1024 * 1024).toLong())).toMap()["Video"], "no length when unknown")
    }

    @Test fun previewsMatchTheWorker() {
        val f = ChatMessageDto("f", attachment = ChatAttachmentDto("file", name = "HSK3.pdf"))
        assertEquals("📄 HSK3.pdf", previewOf(f))
        assertEquals("🎬 Video: 看这个", previewOf(ChatMessageDto("v", content = "看这个", attachment = ChatAttachmentDto("video"))))
        assertEquals("📄 HSK3.pdf", IncomingChat.fromMessage(f.copy(sender_id = "t1"), "r1").content, "notifications say the file's name")
    }

    @Test fun uploadPathsCarryTheFileNameAndTheVideoShape() {
        assertEquals(
            "/api/conversations/c1/media?kind=file&client_id=x&name=%E8%AF%BE%E6%96%87%201.pdf",
            chatMediaUploadPath("c1", "file", "x", name = "课文 1.pdf"),
        )
        assertEquals(
            "/api/conversations/c1/media?kind=video&client_id=x&reply_to_message_id=m1&duration_ms=12400&width=720&height=1280",
            chatMediaUploadPath("c1", "video", "x", replyTo = "m1", durationMs = 12_400, width = 720, height = 1280),
        )
        assertEquals("/api/conversations/c1/media?kind=video&client_id=x", chatMediaUploadPath("c1", "video", "x", width = 0, height = null))
    }

    @Test fun fileNamesAndExtensionsOnThePhone() {
        assertEquals("pdf", ChatMediaStore.extFor("file", "A.PDF", null))
        assertEquals("bin", ChatMediaStore.extFor("file", "README", null))
        assertEquals("bin", ChatMediaStore.extFor("file", "x.p/df", null))
        assertEquals("mov", ChatMediaStore.extFor("video", null, "video/quicktime"))
        assertEquals("mp4", ChatMediaStore.extFor("video", null, null))
        assertEquals("m4a", ChatMediaStore.extFor("voice", null, null))
        assertEquals("jpg", ChatMediaStore.extFor("image", null, null))
        assertEquals("notes.pdf", ChatMediaSizing.safeFileName("../../etc/notes.pdf"))
        assertEquals("ab.txt", ChatMediaSizing.safeFileName("a\u0000b?.txt"))
        assertEquals("file", ChatMediaSizing.safeFileName(".."))
        val long = "很".repeat(200) + ".docx"
        assertEquals(120, ChatMediaSizing.safeFileName(long).length)
        assertEquals(true, ChatMediaSizing.safeFileName(long).endsWith(".docx"))
    }

    @Test fun videoBubbleSizes() {
        assertEquals(260f to 146.25f, ChatMediaSizing.videoSize(1920, 1080))
        // Portrait 9:16: capped at 300 dp tall; 1:3 is clamped to 1:2 first.
        assertEquals(168.75f to 300f, ChatMediaSizing.videoSize(720, 1280))
        assertEquals(150f to 300f, ChatMediaSizing.videoSize(500, 1500))
        assertEquals(260f to 146.25f, ChatMediaSizing.videoSize(0, 0))
    }
}
