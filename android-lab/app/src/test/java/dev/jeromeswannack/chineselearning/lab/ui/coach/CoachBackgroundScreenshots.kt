package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachBackgroundSamples as B

/** docs/CHAT.md "Chat ↔ Coach": replies that keep going in the background, and the new-words quick actions. */
class CoachBackgroundScreenshots : LabScreenshotTest() {
    @Test fun pendingAnalysis() = shoot("coach-bg-01-pending-analysis", settleMs = 600) {
        CoachChatScreen(CoachChatUi(thread = Loadable(B.pendingAnalysis), decks = CoachSamples.decks, deckId = "d1"), CoachChatActions())
    }

    @Test fun pendingReply() = shoot("coach-bg-02-thinking", settleMs = 600) {
        CoachChatScreen(CoachChatUi(thread = Loadable(B.pendingReply), decks = CoachSamples.decks, deckId = "d1"), CoachChatActions())
    }

    @Test fun failedReply() = shoot("coach-bg-03-failed-retry") {
        CoachChatScreen(CoachChatUi(thread = Loadable(B.failedReply), decks = CoachSamples.decks, deckId = "d1"), CoachChatActions())
    }

    @Test fun listThinking() = shoot("coach-bg-04-list-thinking", settleMs = 300) {
        CoachHomeScreen(CoachHomeUi(conversations = Loadable(B.conversations)), CoachHomeActions(onBack = {}))
    }

    @Test fun quickActions() = shoot("coach-bg-05-quick-actions") { CoachChatScreen(B.quickActions, CoachChatActions()) }

    /** The picker over the conversation (the dialog window itself isn't captured). */
    @Composable
    private fun SheetOver(ui: NewWordsSheetUi) {
        Box(Modifier.fillMaxSize()) {
            CoachChatScreen(B.quickActions, CoachChatActions())
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 620.dp).clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)
                    .padding(top = 20.dp, bottom = 16.dp),
            ) { CoachNewWordsForm(ui, NewWordsActions()) }
        }
    }

    @Test fun pickerNothingTicked() = shoot("coach-bg-06-new-words-none") { SheetOver(B.sheet) }

    @Test fun pickerTwoTicked() = shoot("coach-bg-07-new-words-two") { SheetOver(B.sheet.copy(picked = setOf("商店", "东西"))) }

    @Test fun pickerDone() = shoot("coach-bg-08-new-words-done") {
        SheetOver(
            B.sheet.copy(
                picked = setOf("商店", "东西"),
                result = NewWordsResult(listOf("商店"), "HSK 3 · Plans & time", listOf(dev.jeromeswannack.chineselearning.lab.data.api.BatchExistingDto(1, "东西", "n7", "Everyday words")), emptyList()),
            ),
        )
    }
}
