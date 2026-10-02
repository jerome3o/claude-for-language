package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatConversationDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionUserDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import org.junit.Test
import org.robolectric.annotation.Config
import java.time.Instant

/** docs/CHAT.md PR 2 in the Lab app: photos, voice + transcript, typing + Seen, pins, search, unread, sending states. */
class ChatRichScreenshots : LabScreenshotTest() {
    companion object {
        private val now = Instant.now()
        private fun at(minAgo: Long) = now.minusSeconds(minAgo * 60).toString()
        val mh = ChatSenderDto("t1", "Minghui")
        val me = ChatSenderDto("me", "Jerome")
        private fun msg(id: String, from: ChatSenderDto, content: String, minAgo: Long) = ChatMessageDto(id, conversation_id = "c1", sender_id = from.id, sender = from, content = content, created_at = at(minAgo))

        val photo = msg("p1", me, "我家的猫在晒太阳 ☀️", 50).copy(
            attachment = ChatAttachmentDto("image", 1600, 1200, 210_000, "image/jpeg"), media_url = "/api/chat-media/p1",
            reactions = listOf(ReactionDto("😍", listOf(ReactionUserDto("t1", "Minghui")), 1)),
        )
        val voice = msg("v1", mh, "", 44).copy(
            attachment = ChatAttachmentDto("voice", duration_ms = 7_400, mime = "audio/mp4", transcript_status = "done", transcript = "好可爱！它叫什么名字？", translation = "So cute! What's its name?"),
            media_url = "/api/chat-media/v1",
        )
        val voicePending = msg("v2", me, "", 40).copy(attachment = ChatAttachmentDto("voice", duration_ms = 3_100, mime = "audio/mp4", transcript_status = "pending"), media_url = "/api/chat-media/v2")
        val thread = listOf(
            msg("m1", mh, "下周二的课改到三点，可以吗？", 60 * 25).copy(pinned_at = at(60 * 24)),
            msg("m2", me, "可以，三点见！", 60 * 25 - 2).copy(edited_at = at(60 * 25 - 1)),
            photo, voice, voicePending,
            msg("m3", me, "它叫馒头 🐱", 39),
            msg("m4", mh, "", 38).copy(deleted_at = at(37)),
            msg("m5", mh, "馒头这个名字太有意思了！", 36),
            msg("m6", me, "因为它又白又胖 😂", 35),
        )
        val base = ChatUi(
            loading = false, otherName = "Minghui", myId = "me", viewerRole = "student",
            conversation = ChatConversationDto("c1", "rel1", "Weekly chat"),
            messages = thread,
        )

        fun picture(w: Int, h: Int): ImageBitmap {
            val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(b)
            c.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), 0xFFFFC371.toInt(), 0xFFFF5F6D.toInt(), Shader.TileMode.CLAMP) })
            c.drawCircle(w * 0.72f, h * 0.3f, h * 0.16f, Paint().apply { color = 0xFFFFF4C2.toInt(); isAntiAlias = true })
            c.drawRect(0f, h * 0.72f, w.toFloat(), h.toFloat(), Paint().apply { color = 0xFF7A4E2D.toInt() })
            c.drawOval(w * 0.25f, h * 0.52f, w * 0.55f, h * 0.78f, Paint().apply { color = 0xFFF6F1EA.toInt(); isAntiAlias = true })
            c.drawCircle(w * 0.52f, h * 0.55f, h * 0.09f, Paint().apply { color = 0xFFF6F1EA.toInt(); isAntiAlias = true })
            return b.asImageBitmap()
        }

        val actions = ChatActions(
            loadImage = { _, _ -> picture(640, 480) },
            loadLocalImage = { _, _ -> picture(640, 480) },
        )
    }

    @Test fun photoAndVoice() = shoot("chat-live-01-photo-voice") {
        ChatScreen(base.copy(otherReadAt = at(34), translationsShown = setOf("v1"), voice = VoicePlayback("v1", 2_900, 7_400, playing = true), scrollTo = ScrollRequest("p1", 1, animate = false)), actions)
    }

    @Test fun typingAndSeen() = shoot("chat-live-02-typing-seen") {
        ChatScreen(base.copy(otherReadAt = at(34), typing = true), actions)
    }

    @Test fun pinnedBar() = shoot("chat-live-03-pinned") {
        ChatScreen(base.copy(otherReadAt = at(34), highlightId = "m1", scrollTo = ScrollRequest("m1", 1, animate = false)), actions)
    }

    @Test fun search() = shoot("chat-live-04-search") {
        val q = "馒头"
        val results = dev.jeromeswannack.chineselearning.lab.core.ChatSearch.search(thread.map(ChatRich::searchable), q)
        ChatScreen(base.copy(search = ChatSearchUi(q, results, 1), highlightId = results[1], scrollTo = ScrollRequest(results[1], 1, animate = false)), actions)
    }

    @Test fun unreadDividerAndPill() = shoot("chat-live-05-unread") {
        ChatScreen(base.copy(unreadId = "v1", newBelow = 3, scrollTo = ScrollRequest("v1", 1, animate = false)), actions)
    }

    @Test fun sendingStates() = shoot("chat-live-06-sending") {
        val pending = listOf(
            PendingBubble("a", "text", "明天我带馒头的照片给你看", 1, failed = true),
            PendingBubble("b", "image", "", 2, filePath = "/x.jpg", width = 1200, height = 1600),
            PendingBubble("c", "text", "在路上～", 3),
        )
        ChatScreen(base.copy(pending = pending, online = false), actions)
    }

    @Test fun recording() = shoot("chat-live-07-recording") {
        ChatScreen(base.copy(otherReadAt = at(34), recorder = RecorderUi.Recording(7_400, locked = true, level = 0.6f)), actions)
    }

    @Test fun voicePreview() = shoot("chat-live-08-voice-preview") {
        ChatScreen(base.copy(otherReadAt = at(34), recorder = RecorderUi.Preview("/x.m4a", 5_200)), actions)
    }

    @Test fun editing() = shoot("chat-live-09-editing", dark = true) {
        ChatScreen(base.copy(otherReadAt = at(34), editing = thread.last(), draft = "因为它又白又胖，像馒头 😂"), actions)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("chat-live-10-unfolded") {
        ChatScreen(base.copy(otherReadAt = at(34), typing = true, translationsShown = setOf("v1"), scrollTo = ScrollRequest("p1", 1, animate = false)), actions)
    }

    @Test fun conversationList() = shoot("chat-live-11-conversation-list") {
        dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen("Minghui") {
            item {
                dev.jeromeswannack.chineselearning.lab.ui.connections.ConversationList(
                    listOf(
                        ChatConversationDto("c1", "rel1", "Weekly chat", last_message_at = at(2), unread = 3,
                            last_message = dev.jeromeswannack.chineselearning.lab.data.api.MessageDto("x", content = "", attachment_kind = "voice")),
                        ChatConversationDto("c2", "rel1", "Homework photos", last_message_at = at(60 * 30),
                            last_message = dev.jeromeswannack.chineselearning.lab.data.api.MessageDto("y", content = "第三题", attachment_kind = "image")),
                        ChatConversationDto("c3", "rel1", null, last_message_at = at(60 * 80),
                            last_message = dev.jeromeswannack.chineselearning.lab.data.api.MessageDto("z", content = "", deleted_at = at(60 * 80))),
                    ),
                ) {}
            }
        }
    }
}
