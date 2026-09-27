package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Multiple choice on the study card: ONE tap flips the card with whatever is picked, and the
 * rating carries it as the review's user_answer (StudyPage.tsx / e2e study-multiple-choice.spec.ts).
 */
class McOneTapTest : LabScreenshotTest() {
    private val rows = listOf(
        MultipleChoice.Row("打", listOf("找", "打", "灯", "扛")),
        MultipleChoice.Row("算", listOf("笔", "蒜", "算", "篮")),
        MultipleChoice.Row("。", listOf("。")),
    )

    private fun studyScreen(onRate: (Int, Long, String?) -> Unit) {
        val now = Js.parseDate("2026-09-27T09:30:00.000Z")
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", Samples.note.id, "d1", CardTypes.MEANING_TO_HANZI, state)
        val view = CardView(card, Samples.note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3", true)
        val ui = StudyUi(
            StudyPhase.Showing(view), Samples.counts, SessionStats(), canUndo = false, online = true, forcedOffline = false,
            extras = CardExtras(mc = McUi(rows = rows, showing = true, cached = true)),
        )
        compose.setContent { LabTheme { StudyScreen(ui, playingKey = null, actions = StudyActions(onRate = onRate), autoplay = false) } }
    }

    @Test fun partialAnswerFlipsAtOnceAndIsTheUserAnswer() {
        var rated: Triple<Int, Long, String?>? = null
        studyScreen { r, ms, a -> rated = Triple(r, ms, a) }
        compose.onNodeWithText("Show answer").assertIsDisplayed()
        compose.onNodeWithText("蒜").performClick()
        compose.onNodeWithText("Submit").performClick()
        compose.mainClock.advanceTimeBy(1_500)
        // Straight to the back: the per-row result, then the ratings — no Check / Continue.
        compose.onNodeWithText("1 of 2 left blank").assertIsDisplayed()
        compose.onNodeWithText("Hard").performClick()
        assertEquals(1, rated!!.first)
        // Picks in row order, the skipped row left out, the pre-selected 。 kept.
        assertEquals("蒜。", rated!!.third)
    }

    @Test fun nothingPickedShowsTheAnswerWithNoUserAnswer() {
        var rated: Triple<Int, Long, String?>? = null
        studyScreen { r, ms, a -> rated = Triple(r, ms, a) }
        compose.onNodeWithText("Show answer").performClick()
        compose.mainClock.advanceTimeBy(1_500)
        compose.onNodeWithText("Again").performClick()
        assertEquals(0, rated!!.first)
        assertNull(rated!!.third)
    }

    @Test fun gridHandsOverAnswerAndSlots() {
        var got: Pair<String, List<MultipleChoice.Slot>>? = null
        compose.setContent {
            LabTheme {
                McGrid(rows, aiAvailable = true, regenerating = false, onSubmit = { a, s -> got = a to s }, onTypeInstead = {}, onRegenerate = {})
            }
        }
        compose.onNodeWithText("打").performClick()
        compose.onNodeWithText("笔").performClick()
        compose.onNodeWithText("Submit").performClick()
        assertEquals("打笔。", got!!.first)
        assertEquals(
            listOf(MultipleChoice.SlotStatus.RIGHT, MultipleChoice.SlotStatus.WRONG, MultipleChoice.SlotStatus.GIVEN),
            got!!.second.map { it.status },
        )
    }
}
