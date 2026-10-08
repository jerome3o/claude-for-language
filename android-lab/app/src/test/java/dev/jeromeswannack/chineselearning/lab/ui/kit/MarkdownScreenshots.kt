package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.api.AskAnswer
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.study.AskActions
import dev.jeromeswannack.chineselearning.lab.ui.study.AskClaudeBody
import dev.jeromeswannack.chineselearning.lab.ui.study.AskUi
import dev.jeromeswannack.chineselearning.lab.ui.study.CardView
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test

/** The shared Markdown renderer (`./gradlew :app:recordRoborazziDebug` → app/screenshots/markdown-*.png). */
class MarkdownScreenshots : LabScreenshotTest() {
    private val view: CardView = run {
        val state = CardScheduler.initialCardState()
        CardView(
            QueueCard("c1", Samples.note.id, "d1", CardTypes.HANZI_TO_MEANING, state), Samples.note, Samples.sentences,
            CardScheduler.intervalPreviews(state, Js.parseDate("2026-09-27T09:30:00.000Z")), emptyList(), 1, "HSK 3 · Plans & time", true,
        )
    }

    private val ask = AskUi(
        conversation = listOf(AskAnswer(id = "q1", question = "打算 vs 计划 — when do I use which?", answer = MarkdownSamples.askClaudeAnswer)),
    )

    /** The Ask Claude sheet, drawn full height so the whole answer is in the shot. */
    @Composable
    private fun sheet() {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).verticalScroll(rememberScrollState()).padding(top = 18.dp, bottom = 20.dp)) {
            AskClaudeBody(view, ask, "en", null, true, AskActions())
        }
    }

    @Test fun askClaude() = shoot("markdown-01-ask-claude") { sheet() }
    @Test fun askClaudeDark() = shoot("markdown-02-ask-claude-dark", dark = true) { sheet() }

    @Composable
    private fun GalleryPage() {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).verticalScroll(rememberScrollState()).padding(16.dp)) {
            MarkdownText(
                MarkdownSamples.gallery,
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).padding(14.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(16.dp))
        }
    }

    @Test fun gallery() = shoot("markdown-03-gallery") { GalleryPage() }
    @Test fun galleryDark() = shoot("markdown-04-gallery-dark", dark = true) { GalleryPage() }
}
