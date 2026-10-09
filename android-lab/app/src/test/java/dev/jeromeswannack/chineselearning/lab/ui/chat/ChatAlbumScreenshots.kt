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
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReactionUserDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import java.time.Instant
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/**
 * Photo albums (docs/CHAT.md "Photo albums"): 2 side by side, 3 = one big + two small with a
 * caption, 5 = 2 × 2 with "+1", 4 still sending, in light and dark; the album viewer at "2 / 5";
 * the album's long-press menu (Forward all / Delete all).
 */
class ChatAlbumScreenshots : LabScreenshotTest() {
    companion object {
        private val now = Instant.now()
        private fun at(secAgo: Long) = now.minusSeconds(secAgo).toString()

        private fun photo(id: String, from: ChatSenderDto, secAgo: Long, album: String, index: Int, caption: String = "", w: Int = 1600, h: Int = 1200) =
            ChatMessageDto(
                id, conversation_id = "c1", sender_id = from.id, sender = from, content = caption, created_at = at(secAgo),
                attachment = ChatAttachmentDto("image", width = w, height = h, bytes = 320_000, mime = "image/jpeg"), media_url = "/api/chat-media/$id",
                album_id = album, album_index = index,
            )

        private fun text(id: String, from: ChatSenderDto, content: String, secAgo: Long) =
            ChatMessageDto(id, conversation_id = "c1", sender_id = from.id, sender = from, content = content, created_at = at(secAgo))

        val ask = text("q", S.mh, "周末去哪儿玩了？发几张照片给我看看！", 900)
        val two = listOf(photo("a0", S.me, 840, "al-two", 0), photo("a1", S.me, 839, "al-two", 1, w = 1200, h = 1600))
        val three = listOf(
            photo("b0", S.me, 838, "al-three", 0, caption = "我们去了北京，坐高铁回来的。"),
            photo("b1", S.me, 837, "al-three", 1, w = 1200, h = 1600),
            photo("b2", S.me, 836, "al-three", 2).copy(reactions = listOf(ReactionDto("❤️", listOf(ReactionUserDto("t1", "Minghui")), 1))),
        )
        val wow = text("w", S.mh, "哇，太漂亮了！还有吗？", 600)
        val five = (0 until 5).map { photo("c$it", S.mh, 500L - it, "al-five", it, caption = if (it == 0) "这是我上个月拍的" else "") }
        val messages = listOf(ask) + two + three + wow + five

        fun scene(seed: Char, w: Int = 640, h: Int = 480): ImageBitmap {
            val palettes = listOf(
                0xFF7FB3E8 to 0xFFF3D9B1, 0xFFFFA48A to 0xFFFFE0B2, 0xFF243B6B to 0xFF8E6BB0, 0xFF9AD0C2 to 0xFFE8F3D6,
                0xFFF6C1D9 to 0xFFB83B6E, 0xFFFDE68A to 0xFFF59E0B, 0xFFD1FAE5 to 0xFF065F46,
            )
            val (top, bottom) = palettes[seed.code % palettes.size]
            val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(b)
            c.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, 0f, h.toFloat(), top.toInt(), bottom.toInt(), Shader.TileMode.CLAMP) })
            c.drawCircle(w * (0.3f + (seed.code % 5) * 0.1f), h * 0.3f, minOf(w, h) * 0.12f, Paint().apply { color = 0xFFFFF4C2.toInt(); isAntiAlias = true })
            c.drawRect(0f, h * 0.72f, w.toFloat(), h.toFloat(), Paint().apply { color = 0xFF2E5E4E.toInt() })
            c.drawOval(w * 0.15f, h * 0.6f, w * 0.65f, h * 0.88f, Paint().apply { color = 0xFF3F7D5F.toInt(); isAntiAlias = true })
            return b.asImageBitmap()
        }

        val actions = ChatActions(
            loadImage = { m, _ -> scene(m.id.last()) },
            loadLocalImage = { path, _ -> scene(path.last()) },
        )

        val ui = S.student.copy(messages = messages, otherReadAt = at(830), aids = ChatLearning.Aids())
        val sending = ui.copy(
            messages = listOf(wow) + five,
            pending = (0 until 4).map { i ->
                PendingBubble("s$i", "image", "", now.toEpochMilli() - 4_000 + i * 1_000, delivered = i == 0, filePath = "/staged/$i", width = 1600, height = 1200, albumId = "al-four")
            },
        )
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

    @Test fun albums() = shoot("chat-album-01-thread") { ChatScreen(ui, actions) }

    @Test fun albumsDark() = shoot("chat-album-02-thread-dark", dark = true) { ChatScreen(ui, actions) }

    @Test fun sending() = shoot("chat-album-03-sending") { ChatScreen(sending, actions) }

    @Test fun sendingDark() = shoot("chat-album-04-sending-dark", dark = true) { ChatScreen(sending, actions) }

    @Test fun viewer() = shoot("chat-album-05-viewer") {
        AlbumViewerContent(five.map { AlbumPhoto(it, null) }, 1, ui, actions) {}
    }

    @Test fun menu() = shoot("chat-album-06-menu") {
        val head = three[0]
        SheetOver({ ChatScreen(ui, actions) }) {
            MessageMenuContent(
                head, MessageMenu.albumMenu(ui.menu(head), 3), online = true, recent = emptyList(), mine = true, onReact = {}, onAction = {},
                preview = "📷 3 photos: ${head.content}",
            )
        }
    }
}
