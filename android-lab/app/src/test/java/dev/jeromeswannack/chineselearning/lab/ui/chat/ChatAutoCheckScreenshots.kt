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
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatAutoCheckSamples as A

/** "Check my Chinese automatically" (docs/CHAT.md "Auto-check"): the ✎, the menu, the sheet, the add-card step. */
class ChatAutoCheckScreenshots : LabScreenshotTest() {
    private val actions = ChatActions()
    private val view = SayBetterView.of(A.ac, "me", "Minghui")!!
    private val cards = SentenceActions(decks = { ChatLearningSamples.decks.map { it.id to it.name } })

    /** The chat dimmed with a bottom sheet over it (the dialog window itself isn't captured). */
    @Composable
    private fun SheetOver(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize()) {
            ChatScreen(A.ui, actions)
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 800.dp).clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)
                    .verticalScroll(rememberScrollState()).padding(top = 20.dp, bottom = 16.dp),
            ) { content() }
        }
    }

    @Test fun indicator() = shoot("chat-autocheck-01-indicator") { ChatScreen(A.ui, actions) }

    @Test fun menu() = shoot("chat-autocheck-02-menu") {
        SheetOver { MessageMenuContent(A.ac, A.ui.menu(A.ac), online = true, recent = emptyList(), mine = true, onReact = {}, onAction = {}) }
    }

    @Test fun sheet() = shoot("chat-autocheck-03-sheet") {
        SheetOver { SayBetterContent(view, online = true, playing = false, cards = cards, onPlay = {}, onAsk = {}, onClose = {}) }
    }

    @Test fun addCard() = shoot("chat-autocheck-04-add-card") {
        SheetOver { SayBetterContent(view, online = true, playing = false, cards = cards, onPlay = {}, onAsk = {}, onClose = {}, initialAdding = view.card) }
    }

    @Test fun sheetDark() = shoot("chat-autocheck-05-sheet-dark", dark = true) {
        SheetOver { SayBetterContent(view, online = false, playing = false, cards = cards, onPlay = {}, onAsk = {}, onClose = {}) }
    }

    @Test fun settings() = shoot("chat-autocheck-06-settings") {
        Column(Modifier.padding(16.dp)) { ChatAutoCheckSection(on = true, note = null, onChange = {}) }
    }
}
