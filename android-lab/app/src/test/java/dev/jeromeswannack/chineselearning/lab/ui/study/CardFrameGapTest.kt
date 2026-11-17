package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import dev.jeromeswannack.chineselearning.lab.ui.theme.Spacing
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Nothing touches or overlaps the card frame (Jerome, Nov 2026: the multiple-choice grid's top row ran under the
 * frame's bottom border on a listening card): the controls under the card — the grid, Submit, the footer, the ratings
 * — start at least [Spacing.gapMin] below the frame, and the frame keeps the same gap from the screen's sides.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = LabScreenshotTest.PHONE, application = android.app.Application::class)
class CardFrameGapTest {
    @get:Rule val compose = createComposeRule()

    private val now = Js.parseDate("2026-11-17T09:30:00.000Z")
    private val note = Samples.note.copy(hanzi = "虾饺子", pinyin = "xiā jiǎo zi", english = "shrimp dumplings")
    private val sentences = listOf(
        SentenceEntity("s1", "n1", 0, "这家店的虾饺子很好吃。", "Zhè jiā diàn de xiā jiǎozi hěn hǎochī.", "The shrimp dumplings here are delicious.", null, "core", null),
    )
    private val rows = listOf(
        MultipleChoice.Row("虾", listOf("虾", "蛇", "蚊", "蛙", "蜗")),
        MultipleChoice.Row("饺", listOf("铰", "饺", "校", "绞", "皎")),
        MultipleChoice.Row("子", listOf("字", "了", "子", "孑", "孔")),
    )

    private fun show(type: String, start: CardStartState = CardStartState(), extras: CardExtras = CardExtras(mc = McUi(rows = rows, showing = true, cached = true, auto = true))) {
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", note.id, "d1", type, state)
        val view = CardView(card, note, sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "Core Homework", true)
        val ui = StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(), canUndo = true, online = true, forcedOffline = false, extras = extras)
        compose.setContent { LabTheme(dark = true) { StudyScreen(ui, playingKey = null, actions = StudyActions(), cardStart = start, autoplay = false) } }
        compose.mainClock.advanceTimeBy(2_000)
    }

    private fun assertGapBelowFrame() {
        val frame = compose.onNodeWithTag(CARD_FRAME_TAG, useUnmergedTree = true).getBoundsInRoot()
        val controls = compose.onNodeWithTag(CARD_CONTROLS_TAG, useUnmergedTree = true).getBoundsInRoot()
        assertTrue("controls top ${controls.top} must be ≥ frame bottom ${frame.bottom} + ${Spacing.gapMin}", controls.top >= frame.bottom + Spacing.gapMin - 0.5.dp)
        assertTrue("frame left ${frame.left} must keep the gutter", frame.left >= Spacing.gapMin - 0.5.dp)
    }

    @Test fun listeningCardGridStartsBelowTheFrame() {
        show(CardTypes.AUDIO_TO_HANZI)
        val grid = compose.onNodeWithTag(MC_ROWS_TAG, useUnmergedTree = true).getBoundsInRoot()
        val frame = compose.onNodeWithTag(CARD_FRAME_TAG, useUnmergedTree = true).getBoundsInRoot()
        assertTrue("grid top ${grid.top} must be ≥ frame bottom ${frame.bottom} + ${Spacing.gapMin}", grid.top >= frame.bottom + Spacing.gapMin - 0.5.dp)
        assertGapBelowFrame()
    }

    @Test fun meaningCardGridStartsBelowTheFrame() {
        show(CardTypes.MEANING_TO_HANZI)
        val grid = compose.onNodeWithTag(MC_ROWS_TAG, useUnmergedTree = true).getBoundsInRoot()
        val frame = compose.onNodeWithTag(CARD_FRAME_TAG, useUnmergedTree = true).getBoundsInRoot()
        assertTrue(grid.top >= frame.bottom + Spacing.gapMin - 0.5.dp)
    }

    @Test fun answerSideFooterStartsBelowTheFrame() {
        show(CardTypes.HANZI_TO_MEANING, CardStartState(flipped = true), CardExtras())
        assertGapBelowFrame()
    }
}
