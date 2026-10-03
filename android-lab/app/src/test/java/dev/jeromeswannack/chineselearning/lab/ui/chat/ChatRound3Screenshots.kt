package dev.jeromeswannack.chineselearning.lab.ui.chat

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatReplyToDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionUserDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import java.time.Instant
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/**
 * Chat round 2 — PR 3 (docs/CHAT.md "Round 2 — PR 3"): files + "↪ Forwarded", a video clip, the
 * attach sheet with Video / File, several photos at once, the message menu's Forward / Info,
 * "Forward to…", Message info, the offline queue line with a kept draft, selection with Forward.
 */
class ChatRound3Screenshots : LabScreenshotTest() {
    companion object {
        private val now = Instant.now()
        private fun at(minAgo: Long) = now.minusSeconds(minAgo * 60).toString()
        private fun msg(id: String, from: dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto, content: String, minAgo: Long) =
            ChatMessageDto(id, conversation_id = "c1", sender_id = from.id, sender = from, content = content, created_at = at(minAgo))

        val ask = msg("a1", S.me, "第三课的生词表你有吗？", 50)
        val pdf = msg("f1", S.mh, "", 48).copy(attachment = ChatAttachmentDto("file", bytes = 860_000, mime = "application/pdf", name = "HSK3 第三课 生词表.pdf"), media_url = "/api/chat-media/f1")
        val docx = msg("f2", S.mh, "作业在这里，周五前做完就好。", 47).copy(
            attachment = ChatAttachmentDto("file", bytes = 2_400_000, mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name = "作业 · 把字句练习.docx"),
            media_url = "/api/chat-media/f2",
        )
        val thanks = msg("t1", S.me, "收到，谢谢老师！", 45).copy(reactions = listOf(ReactionDto("❤️", listOf(ReactionUserDto("t1", "Minghui")), 1)))
        val fwd = msg("w1", S.me, "我朋友说这个公园周末人很多，我们早点去吧。", 20).copy(forwarded_from = "x9")
        val fwdFile = msg("w2", S.me, "", 19).copy(forwarded_from = "x10", attachment = ChatAttachmentDto("file", bytes = 54_000, mime = "text/csv", name = "我的生词.csv"), media_url = "/api/chat-media/w2")
        val reply = msg("r1", S.mh, "好主意！九点在门口见。", 15).copy(reply_to = ChatReplyToDto("w1", fwd.content, S.me))
        val files = listOf(ask, pdf, docx, thanks, fwd, fwdFile, reply)

        val video = msg("v1", S.mh, "上周去西湖拍的 🌊", 30).copy(
            attachment = ChatAttachmentDto("video", width = 1920, height = 1080, bytes = 6_800_000, mime = "video/mp4", duration_ms = 12_400), media_url = "/api/chat-media/v1",
        )
        val portrait = msg("v2", S.me, "", 25).copy(
            attachment = ChatAttachmentDto("video", width = 720, height = 1280, bytes = 3_100_000, mime = "video/mp4", duration_ms = 7_000), media_url = "/api/chat-media/v2",
            reply_to = ChatReplyToDto("v1", video.content, S.mh),
        )
        val wow = msg("w", S.mh, "哇，好漂亮！", 24)

        fun scene(w: Int, h: Int, top: Long, bottom: Long, sun: Long = 0xFFFFF4C2): ImageBitmap {
            val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(b)
            c.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, 0f, h.toFloat(), top.toInt(), bottom.toInt(), Shader.TileMode.CLAMP) })
            c.drawCircle(w * 0.7f, h * 0.32f, minOf(w, h) * 0.12f, Paint().apply { color = sun.toInt(); isAntiAlias = true })
            c.drawRect(0f, h * 0.7f, w.toFloat(), h.toFloat(), Paint().apply { color = 0xFF2E5E4E.toInt() })
            c.drawOval(w * 0.1f, h * 0.6f, w * 0.6f, h * 0.85f, Paint().apply { color = 0xFF3F7D5F.toInt(); isAntiAlias = true })
            return b.asImageBitmap()
        }

        private val posterFile = java.io.File.createTempFile("poster", ".mp4")

        val actions = ChatActions(
            loadImage = { _, _ -> ChatRichScreenshots.picture(640, 480) },
            loadLocalImage = { path, _ ->
                when (path.last()) {
                    '0' -> scene(640, 480, 0xFF7FB3E8, 0xFFF3D9B1)
                    '1' -> scene(480, 640, 0xFFFFA48A, 0xFFFFE0B2)
                    '2' -> scene(640, 480, 0xFF243B6B, 0xFF8E6BB0, sun = 0xFFFFFFFF)
                    else -> scene(640, 640, 0xFF9AD0C2, 0xFFE8F3D6)
                }
            },
            loadVideo = { posterFile },
            loadPoster = { _, key, _ -> if (key == "v2") scene(360, 640, 0xFFFFB37A, 0xFFFFE7C7) else scene(640, 360, 0xFF6FA8DC, 0xFFCFE4F7) },
        )

        val ui = S.student.copy(messages = files, otherReadAt = at(14), aids = ChatLearning.Aids())
    }

    /** The chat dimmed with a bottom sheet over it (the dialog window itself isn't captured). */
    @Composable
    private fun SheetOver(under: @Composable () -> Unit, content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize()) {
            under()
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 760.dp).clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)
                    .verticalScroll(rememberScrollState()).padding(top = 20.dp, bottom = 16.dp),
            ) { content() }
        }
    }

    @Test fun filesAndForwarded() = shoot("chat-r3-01-files-forwarded") { ChatScreen(ui, actions) }

    @Test fun filesDark() = shoot("chat-r3-02-files-dark", dark = true) { ChatScreen(ui.copy(fileErrors = setOf("f1")), actions) }

    @Test fun videoClips() = shoot("chat-r3-03-video") {
        ChatScreen(ui.copy(messages = listOf(thanks, video, portrait, wow), otherReadAt = at(24)), actions)
    }

    @Test fun attachMenu() = shoot("chat-r3-04-attach-menu") {
        SheetOver({ ChatScreen(ui, actions) }) { AttachContent(ui, ChatSheetActions()) }
    }

    @Test fun severalPhotos() = shoot("chat-r3-05-several-photos") {
        SheetOver({ ChatScreen(ui, actions) }) {
            PhotosComposeContent(List(4) { StagedPhoto("/staged/photo-$it", 1600, 1200) }, online = true, loadLocalImage = actions.loadLocalImage, onRemove = {}, onSend = {}, onCancel = {})
        }
    }

    @Test fun menuForwardInfo() = shoot("chat-r3-06-menu-forward-info") {
        SheetOver({ ChatScreen(ui, actions) }) {
            MessageMenuContent(docx, ui.menu(docx), online = true, recent = emptyList(), mine = false, onReact = {}, onAction = {})
        }
    }

    @Test fun forwardTo() = shoot("chat-r3-07-forward-to") {
        SheetOver({ ChatScreen(ui.copy(selection = SelectionUi(setOf("w1", "r1"))), actions) }) {
            ForwardContent(
                ForwardUi(
                    listOf("w1", "r1"),
                    listOf(
                        ForwardTarget("c1", "rel1", "Minghui", "Weekly chat"),
                        ForwardTarget("c3", "rel3", "Anna Schmidt", null),
                        ForwardTarget("c4", "rel1", "Minghui", "HSK 3 grammar"),
                        ForwardTarget("c5", "rel4", "王小明", "Pronunciation"),
                    ),
                ),
                currentConversationId = "c1",
            ) {}
        }
    }

    @Test fun messageInfo() = shoot("chat-r3-08-message-info") {
        val mine = fwd.copy(edited_at = at(18), pinned_at = at(10), reactions = listOf(ReactionDto("👍", listOf(ReactionUserDto("t1", "Minghui")), 1)))
        SheetOver({ ChatScreen(ui, actions) }) { MessageInfoContent(mine, ChatRound3.infoRows(mine, "me", "Minghui", at(14))) }
    }

    @Test fun fileInfo() = shoot("chat-r3-09-file-info", dark = true) {
        SheetOver({ ChatScreen(ui, actions) }) { MessageInfoContent(pdf, ChatRound3.infoRows(pdf, "me", "Minghui", at(14))) }
    }

    @Test fun offlineQueue() = shoot("chat-r3-10-offline-queue") {
        val t0 = System.currentTimeMillis()
        ChatScreen(
            ui.copy(
                messages = files.take(4),
                online = false,
                pending = listOf(
                    PendingBubble("p1", "text", "我在火车上，网不好 🚄", t0 - 120_000),
                    PendingBubble("p2", "file", "", t0 - 60_000, name = "我的作业.pdf", bytes = 410_000, filePath = "/staged/x"),
                ),
                draft = "等我到了再给你",
            ),
            actions,
        )
    }

    @Test fun selectionForward() = shoot("chat-r3-11-selection-forward") {
        ChatScreen(ui.copy(selection = SelectionUi(setOf("w1", "r1"))), actions)
    }
}
