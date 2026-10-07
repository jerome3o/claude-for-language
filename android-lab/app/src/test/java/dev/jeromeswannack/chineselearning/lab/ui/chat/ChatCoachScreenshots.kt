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
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatCoachSamples as C

/** "Open in Coach" (docs/CHAT.md "Chat ↔ Coach"): the chip under my photo's caption, the menu, the sheet. */
class ChatCoachScreenshots : LabScreenshotTest() {
    private val actions = ChatActions()

    @Composable
    private fun SheetOver(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize()) {
            ChatScreen(C.ui, actions)
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 800.dp).clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)
                    .verticalScroll(rememberScrollState()).padding(top = 20.dp, bottom = 16.dp),
            ) { content() }
        }
    }

    @Test fun photoChip() = shoot("chat-coach-01-photo-chip") { ChatScreen(C.ui, actions) }

    @Test fun menu() = shoot("chat-coach-02-menu") {
        SheetOver { MessageMenuContent(C.photo, C.ui.menu(C.photo), online = true, recent = emptyList(), mine = true, onReact = {}, onAction = {}) }
    }

    @Test fun sheet() = shoot("chat-coach-03-sheet") {
        val v = SayBetterView.of(C.photo, "me", "Minghui")!!
        SheetOver { SayBetterContent(v, online = true, playing = false, cards = SentenceActions(), onPlay = {}, onAsk = {}, onClose = {}, onOpenCoach = {}) }
    }
}
