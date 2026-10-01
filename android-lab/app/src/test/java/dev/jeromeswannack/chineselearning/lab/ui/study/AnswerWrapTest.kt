package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * Jerome's screenshot (2026-10-01): a long typed sentence answered wrong. The correct answer
 * under the "↓" was one clipped Row, so it ended "…聊了两个小" — the 时。 fell off the card.
 * It must wrap, keep every character and stay inside the screen, folded and unfolded, at
 * font scale 1.0 and 1.3.
 */
class AnswerWrapTest : LabScreenshotTest() {
    private val note = Samples.note.copy(
        id = "n-chat", hanzi = "周天我和我妹妹吃早饭、聊天了，聊了两个小时。",
        pinyin = "zhōu tiān wǒ hé wǒ mèi mei chī zǎo fàn, liáo tiān le, liáo le liǎng gè xiǎo shí。",
        english = "On Sunday I ate breakfast and chatted with my younger sister; we chatted for two hours.",
        funFacts = "周天 (zhōutiān) Sunday · 早饭 (zǎofàn) breakfast · 聊天 (liáotiān) to chat · 两个小时 (liǎng gè xiǎoshí) two hours\n聊了两个小时: verb + 了 + duration — how long the chatting lasted.",
        sentenceClue = null,
    )

    /** What he typed: 聊天儿 for 聊天了, and 两小时 for 两个小时 (so two characters short). */
    private val typed = "周天我和我妹妹吃早饭，聊天儿，聊了两小时"

    private fun ui(): StudyUi {
        val now = Js.parseDate("2026-10-01T09:07:00.000Z")
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c-chat", note.id, "d1", CardTypes.MEANING_TO_HANZI, state)
        val view = CardView(card, note, emptyList(), CardScheduler.intervalPreviews(state, now), emptyList(), 1, "Tutor homework", true)
        return StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(), canUndo = true, online = false, forcedOffline = false)
    }

    @Composable
    private fun FontScale(scale: Float, content: @Composable () -> Unit) {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, scale)) { content() }
    }

    private fun showBack(fontScale: Float, dark: Boolean = true) {
        compose.setContent {
            LabTheme(dark = dark) {
                FontScale(fontScale) {
                    StudyScreen(ui(), playingKey = null, actions = StudyActions(), cardStart = CardStartState(flipped = true, answer = typed), autoplay = false)
                }
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
    }

    /** Every character of the correct-answer line, in order, and none of them clipped by the screen edge. */
    private fun assertFullAnswerShown(wraps: Boolean = true) {
        val rootWidth = compose.onRoot().fetchSemanticsNode().boundsInRoot.width
        val nodes = compose.onAllNodesWithTag(EXPECTED_CHAR_TAG, useUnmergedTree = true).fetchSemanticsNodes()
        val rendered = nodes.joinToString("") { n -> n.config.getOrNull(SemanticsProperties.Text).orEmpty().joinToString("") { it.text } }
        assertEquals(note.hanzi, rendered)
        assertTrue("the answer ends with 小时。", rendered.endsWith("小时。"))
        for (n in nodes) {
            val b = n.boundsInRoot
            assertTrue("character clipped: $b", b.width > 0f && b.left >= 0f && b.right <= rootWidth + 0.5f)
        }
        // No line starts with punctuation: each mark sits on its predecessor's line.
        val texts = nodes.map { n -> n.config.getOrNull(SemanticsProperties.Text).orEmpty().joinToString("") { it.text } }
        for (i in 1 until nodes.size) if (texts[i] in setOf("，", "、", "。")) assertEquals(nodes[i - 1].boundsInRoot.top, nodes[i].boundsInRoot.top, 0.5f)
        // On the folded screen it takes more than one line.
        if (wraps) assertTrue(nodes.map { it.boundsInRoot.top }.distinct().size > 1)
    }

    private fun capture(name: String) = compose.onRoot().captureRoboImage("screenshots/$name.png")

    @Test fun foldedDarkFont130() {
        showBack(1.3f)
        assertFullAnswerShown()
        capture("study-f01-long-answer-wraps-folded-dark-font130")
    }

    @Test fun foldedDarkFont100() {
        showBack(1.0f)
        assertFullAnswerShown()
        capture("study-f02-long-answer-wraps-folded-dark-font100")
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfoldedFont130() {
        showBack(1.3f)
        assertFullAnswerShown(wraps = false)
        capture("study-f03-long-answer-wraps-unfolded-font130")
    }
}
