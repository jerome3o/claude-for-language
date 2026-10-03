package dev.jeromeswannack.chineselearning.lab.ui.chat

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
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListLastMessage
import dev.jeromeswannack.chineselearning.lab.data.api.ChatAttachmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ChatSenderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningRowDto
import dev.jeromeswannack.chineselearning.lab.data.api.ListeningStateDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsActions
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsSamples
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsScreen
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.ShellFrame
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Test
import org.robolectric.annotation.Config
import java.time.Instant

/** Sample chat in listening mode (real hanzi): Minghui's new messages arrive hidden. */
object ListeningSamples {
    private val now = Instant.now()
    private fun at(minAgo: Long) = now.minusSeconds(minAgo * 60).toString()
    val mh = ChatSenderDto("t1", "Minghui")
    val me = ChatSenderDto("me", "Jerome")
    private fun msg(id: String, from: ChatSenderDto, content: String, minAgo: Long) =
        ChatMessageDto(id, conversation_id = "c1", sender_id = from.id, sender = from, content = content, created_at = at(minAgo))

    val old1 = msg("o1", mh, "你今天去哪儿了？", 90).copy(translation = "Where did you go today?")
    val old2 = msg("o2", me, "我去图书馆了，看了一下午的书。", 85)
    /** When listening mode was turned on: everything after this hides. */
    val since = at(80)
    val h1 = msg("h1", mh, "图书馆人多吗？", 20)
    val h2 = msg("h2", mh, "周末我们一起去爬山吧，天气预报说星期六是晴天。", 19)
    val photo = msg("p1", mh, "山上的风景", 18).copy(attachment = ChatAttachmentDto("image", width = 640, height = 480), media_url = "/api/chat-media/p1")
    val mine = msg("x1", me, "好啊！几点出发？", 10)
    val h3 = msg("h3", mh, "早上八点，在地铁站见。", 4)
    val thread = listOf(old1, old2, h1, h2, photo, mine, h3)

    val ui = ChatLearningSamples.student.copy(
        messages = thread,
        aids = ChatLearning.Aids(),
        known = emptySet(),
        otherReadAt = at(9),
        listening = ListeningUi(setting = ChatListening.Setting(true, since), durations = mapOf("h1" to 2.4, "h2" to 7.6)),
    )
}

/**
 * Listening mode (docs/CHAT.md "Listening mode"): hidden bubbles (🎧 + bars + duration + hint, 👁
 * beside), one playing at 0.75×, one revealed, the ⋯ menu with the toggle, dark, unfolded, the
 * inbox's "🎧 New message" and Settings → Chat.
 */
class ChatListeningScreenshots : LabScreenshotTest() {
    private val s = ListeningSamples
    private val actions = ChatActions(
        loadImage = { _, _ -> ChatRichScreenshots.picture(640, 480) },
    )

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

    @Test fun hidden() = shoot("chat-listening-01-hidden") { ChatScreen(s.ui, actions) }

    @Test fun playing() = shoot("chat-listening-02-playing-slow") {
        ChatScreen(s.ui.copy(listening = s.ui.listening.copy(playing = "h2", slow = true, playNonce = 1)), actions)
    }

    @Test fun revealed() = shoot("chat-listening-03-revealed") {
        ChatScreen(s.ui.copy(listening = s.ui.listening.copy(revealed = setOf("h2"), justRevealed = setOf("h2"))), actions)
    }

    /** Mid-reveal: the un-blur (blur 8 dp → 0, 260 ms) caught half way. */
    @Test fun revealing() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme {
                ChatScreen(s.ui.copy(listening = s.ui.listening.copy(revealed = setOf("h2"), justRevealed = setOf("h2"))), actions)
            }
        }
        compose.mainClock.advanceTimeBy(110)
        compose.onRoot().captureRoboImage("screenshots/chat-listening-04-revealing.png")
    }

    @Test fun menu() = shoot("chat-listening-05-menu-toggle") {
        SheetOver({ ChatScreen(s.ui, actions) }) { ConversationMenuContent(s.ui, ChatSheetActions()) }
    }

    @Test fun menuOff() = shoot("chat-listening-06-menu-off") {
        val off = s.ui.copy(listening = ListeningUi(setting = ChatListening.Setting(false, s.since)))
        SheetOver({ ChatScreen(off, actions) }) { ConversationMenuContent(off, ChatSheetActions()) }
    }

    @Test fun dark() = shoot("chat-listening-07-dark", dark = true) { ChatScreen(s.ui.copy(listening = s.ui.listening.copy(playing = "h3")), actions) }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() = shoot("chat-listening-08-unfolded") { ChatScreen(s.ui, actions) }

    @Test fun inbox() = shoot("chat-listening-09-inbox") {
        val rows = ChatsSamples.rows.map {
            when (it.conversationId) {
                "c-hw" -> it.copy(myReadAt = "2026-10-03T09:00:00Z")
                // A photo stays as it is in listening mode.
                "c-wei" -> it.copy(lastMessage = it.lastMessage!!.copy(attachmentKind = "image"))
                else -> it
            }
        }
        val state = ListeningStateDto(default_on = false, conversations = listOf(ListeningRowDto("c-hw", true, "2026-10-02T00:00:00.000Z"), ListeningRowDto("c-wei", true, "2026-10-01T00:00:00.000Z")))
        val tabs = NavRules.tabsFor(NavRole(hasTutor = true, loaded = true))
        ShellFrame(tabs, TabId.CHATS, showBar = true, onSelect = {}, badges = mapOf(TabId.CHATS to 2)) {
            ChatsScreen(ChatsSamples.loaded.copy(rows = rows, listening = state), ChatsActions())
        }
    }

    @Test fun settings() = shoot("chat-listening-10-settings") {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) {
            ChatListeningSection(on = true) {}
        }
    }
}
