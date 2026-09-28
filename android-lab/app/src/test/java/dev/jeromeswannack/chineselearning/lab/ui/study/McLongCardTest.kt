package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.robolectric.annotation.Config

/**
 * The long multiple-choice card from Jerome's screenshot (2026-09-28): a whole sentence with a
 * comma — 14 rows to pick — on the folded Fold, dark, font scale 1.3. The rows scroll, the
 * question stays on screen above them and Submit / Show answer is always reachable.
 */
class McLongCardTest : LabScreenshotTest() {
    /** As stored on the note — including the pinyin "xi" the model once offered for 习. */
    private val raw = """
        [{"correct":"我","options":["或","找","成","我","战"]},
         {"correct":"们","options":["们","间","闷","问","门"]},
         {"correct":"一","options":["一","二","七","十","丁"]},
         {"correct":"边","options":["连","过","边","远","进"]},
         {"correct":"吃","options":["吓","吃","叫","吹","喝"]},
         {"correct":"晚","options":["晓","晨","晴","晚","免"]},
         {"correct":"饭","options":["馆","饮","饿","饭","饱"]},
         {"correct":"，","options":["，"]},
         {"correct":"一","options":["一","二","丁","七","十"]},
         {"correct":"边","options":["连","过","边","进","远"]},
         {"correct":"练","options":["连","链","练","炼"]},
         {"correct":"习","options":["学","刁","习","xi","羽"]},
         {"correct":"说","options":["诉","读","话","说","讲"]},
         {"correct":"中","options":["中","申","种","钟","仲"]},
         {"correct":"文","options":["文","闻","纹","交","又"]},
         {"correct":"。","options":["。"]}]
    """.trimIndent()
    private val rows = MultipleChoice.parse(raw)!!
    private val note = Samples.note.copy(
        id = "n-long", hanzi = "我们一边吃晚饭，一边练习说中文。", pinyin = "Wǒmen yībiān chī wǎnfàn, yībiān liànxí shuō Zhōngwén.",
        english = "We practise speaking Chinese while we eat dinner.", sentenceClue = null,
    )

    private fun ui(type: String = CardTypes.MEANING_TO_HANZI): StudyUi {
        val now = Js.parseDate("2026-09-28T19:55:00.000Z")
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c-long", note.id, "d1", type, state)
        val view = CardView(card, note, emptyList(), CardScheduler.intervalPreviews(state, now), emptyList(), 1, "Tutor homework", true)
        return StudyUi(
            StudyPhase.Showing(view), Samples.counts, SessionStats(), canUndo = true, online = true, forcedOffline = false,
            extras = CardExtras(mc = McUi(rows = rows, showing = true, cached = true, auto = true)),
        )
    }

    @Composable
    private fun FontScale(scale: Float, content: @Composable () -> Unit) {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, scale)) { content() }
    }

    private fun show(type: String = CardTypes.MEANING_TO_HANZI, dark: Boolean = true, onRate: (Int, Long, String?) -> Unit = { _, _, _ -> }) {
        compose.setContent {
            LabTheme(dark = dark) {
                FontScale(1.3f) { StudyScreen(ui(type), playingKey = null, actions = StudyActions(onRate = onRate), autoplay = false) }
            }
        }
        compose.mainClock.advanceTimeBy(2_000)
    }

    private fun capture(name: String) = compose.onRoot().captureRoboImage("screenshots/$name.png")

    private fun scrollRowsToBottom() {
        repeat(4) { compose.onNodeWithTag(MC_ROWS_TAG).performTouchInput { swipeUp() } }
        compose.mainClock.advanceTimeBy(1_000)
    }

    @Test fun pinyinDistractorIsDropped() {
        val xiRow = rows.first { it.correct == "习" }
        assertEquals(listOf("学", "刁", "习", "羽"), xiRow.options)
        assertTrue(MultipleChoice.isCompact(rows))
    }

    @Test fun collapsed() {
        show()
        // The question and the button are both on screen with 14 rows to pick.
        compose.onNodeWithText(note.english).assertIsDisplayed()
        compose.onNodeWithTag(MC_SUBMIT_TAG).assertIsDisplayed()
        capture("study-e01-mc-long-folded-font130")
    }

    @Test fun scrolledToBottom() {
        show()
        scrollRowsToBottom()
        compose.onNodeWithText("仲").assertIsDisplayed()
        compose.onNodeWithTag(MC_SUBMIT_TAG).assertIsDisplayed()
        compose.onNodeWithText(note.english).assertIsDisplayed()
        capture("study-e02-mc-long-scrolled-bottom")
    }

    @Test fun listenCardLight() {
        show(CardTypes.AUDIO_TO_HANZI, dark = false)
        compose.onNodeWithTag(MC_SUBMIT_TAG).assertIsDisplayed()
        capture("study-e03-mc-long-listen-light")
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun unfolded() {
        show()
        compose.onNodeWithText(note.english).assertIsDisplayed()
        compose.onNodeWithTag(MC_SUBMIT_TAG).assertIsDisplayed()
        capture("study-e04-mc-long-unfolded-font130")
    }

    /** Pick in the first row and the last one (after scrolling), then Submit — the card flips and rates. */
    @Test fun scrollPickAndSubmit() {
        var rated: Triple<Int, Long, String?>? = null
        show { r, ms, a -> rated = Triple(r, ms, a) }
        compose.onNodeWithText("我").performClick()
        compose.mainClock.advanceTimeBy(600)
        scrollRowsToBottom()
        compose.onNodeWithText("文").assertIsDisplayed().performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithTag(MC_SUBMIT_TAG).assertIsDisplayed().assertTextEquals("Submit").performClick()
        compose.mainClock.advanceTimeBy(1_500)
        compose.onNodeWithText("12 of 14 left blank").assertIsDisplayed()
        compose.onNodeWithText("Good").performClick()
        assertNotNull(rated)
        assertEquals(2, rated!!.first)
        // Picks in row order, blanks left out, the given ，and 。 kept.
        assertEquals("我，文。", rated!!.third)
    }

    /** A pick scrolls the next unanswered row into view: picking down the grid never needs a manual scroll. */
    @Test fun pickScrollsNextRowIntoView() {
        show()
        val answers = listOf("我", "们", "一", "边", "吃", "晚", "饭")
        for (a in answers) {
            compose.onAllNodesWithText(a)[0].performClick()
            compose.mainClock.advanceTimeBy(700)
        }
        // Row 9 (一 again, after the comma) is now on screen, and so is the button.
        compose.onNodeWithTag(MC_SUBMIT_TAG).assertIsDisplayed()
        compose.onAllNodesWithText("丁")[1].assertIsDisplayed()
    }
}
