package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.click
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeUp
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Peek: on the answer side a tap on empty space turns the card back to the question, and a tap
 * on the question turns it to the answer again — a view-only flip. Nothing is re-checked or
 * recorded, the typed answer is kept, and buttons / scrolls / long presses never flip it.
 */
class PeekFlipTest : LabScreenshotTest() {
    private val reveals = mutableListOf<AnswerKey.Verdict?>()
    private val rated = mutableListOf<Triple<Int, Long, String?>>()
    private var peeks = 0
    private var played = 0

    private fun studyScreen(type: String) {
        val now = Js.parseDate("2026-09-27T09:30:00.000Z")
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", Samples.note.id, "d1", type, state)
        val view = CardView(card, Samples.note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3", true)
        val ui = StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(), canUndo = false, online = true, forcedOffline = false)
        val actions = StudyActions(
            onReveal = { reveals += it },
            onRate = { r, ms, a -> rated += Triple(r, ms, a) },
            onPeek = { peeks++ },
            onPlayWord = { played++ },
        )
        compose.setContent { LabTheme { StudyScreen(ui, playingKey = null, actions = actions, autoplay = false) } }
    }

    /** A tap in the answer side's top padding: empty space. */
    private fun tapEmptyBack() = compose.onNodeWithTag(CARD_BACK_TAG).performTouchInput { click(Offset(centerX, 12f)) }

    private fun assertAnswerSide() {
        compose.onNodeWithText(Samples.note.pinyin).assertExists()
        compose.onNodeWithText(PEEK_HINT).assertDoesNotExist()
    }

    private fun assertQuestionSide() {
        compose.onNodeWithText(PEEK_HINT).assertIsDisplayed()
        compose.onNodeWithText(Samples.note.pinyin).assertDoesNotExist()
    }

    @Test fun emptySpacePeeksAtTheQuestionAndBackWithoutRecording() {
        studyScreen(CardTypes.HANZI_TO_MEANING)
        compose.onNodeWithText("Show answer").performClick()
        assertAnswerSide()
        assertEquals(1, reveals.size)

        tapEmptyBack()
        assertQuestionSide()
        // The ratings stay up while peeking; the question's own controls don't come back.
        compose.onNodeWithText("Good").assertIsDisplayed()
        compose.onNodeWithText("🎤  Record").assertDoesNotExist()

        compose.onNodeWithText(PEEK_HINT).performClick()
        assertAnswerSide()

        assertEquals("peeking never re-reveals", 1, reveals.size)
        assertEquals(2, peeks)
        assertTrue("nothing recorded by a peek", rated.isEmpty())

        compose.onNodeWithText("Good").performClick()
        assertEquals(1, rated.size)
        assertEquals(2, rated.single().first)
    }

    @Test fun typedAnswerIsKeptThroughAPeek() {
        studyScreen(CardTypes.MEANING_TO_HANZI)
        compose.onNode(hasSetTextAction()).performTextInput("打蒜")
        compose.onNodeWithText("Check").performClick()
        assertEquals(listOf<AnswerKey.Verdict?>(AnswerKey.Verdict.WRONG), reveals)
        compose.onNodeWithContentDescription("蒜, wrong", useUnmergedTree = true).assertExists() // the answer diff

        tapEmptyBack()
        assertQuestionSide()
        compose.onNodeWithText(PEEK_HINT).performClick()
        assertAnswerSide()
        compose.onNodeWithContentDescription("蒜, wrong", useUnmergedTree = true).assertExists()

        assertEquals("no re-check", 1, reveals.size)
        compose.onNodeWithText("Hard").performClick()
        assertEquals("打蒜", rated.single().third)
    }

    @Test fun buttonsOnTheAnswerSideDontFlip() {
        studyScreen(CardTypes.HANZI_TO_MEANING)
        compose.onNodeWithText("Show answer").performClick()
        compose.onNodeWithText("Play").performClick()
        assertEquals(1, played)
        assertAnswerSide()
        // The answer itself (tappable characters) and the explanation keep their taps too.
        compose.onNodeWithText("算").performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(0, peeks)
    }

    @Test fun scrollAndLongPressDontFlip() {
        studyScreen(CardTypes.HANZI_TO_MEANING)
        compose.onNodeWithText("Show answer").performClick()
        compose.onNodeWithTag(CARD_BACK_TAG).performTouchInput { swipeUp() }
        compose.onNodeWithTag(CARD_BACK_TAG).performTouchInput { swipeDown() }
        assertAnswerSide()
        compose.onNodeWithTag(CARD_BACK_TAG).performTouchInput { longClick(Offset(centerX, 12f)) }
        assertAnswerSide()
        assertEquals(0, peeks)
    }

    @Test fun frontTapOnAnUnrevealedCardStillReveals() {
        studyScreen(CardTypes.HANZI_TO_MEANING)
        compose.onNodeWithText(Samples.note.hanzi).performClick()
        assertAnswerSide()
        assertEquals(1, reveals.size)
        assertEquals(0, peeks)
    }

    @Test fun frontTapOnAnUnrevealedTypingCardDoesNothing() {
        studyScreen(CardTypes.MEANING_TO_HANZI)
        compose.onNodeWithText(Samples.note.english).performClick()
        compose.onNodeWithText("Show").assertIsDisplayed()
        assertTrue(reveals.isEmpty())
    }

    private companion object {
        const val PEEK_HINT = "Tap to see the answer"
    }
}
