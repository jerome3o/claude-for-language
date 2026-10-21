package dev.jeromeswannack.chineselearning.lab.ui.study

import android.Manifest
import android.app.Application
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.robolectric.Shadows.shadowOf

/**
 * The study card's 📚 deck pill (web: components/study/DeckPill.tsx): never on the question side
 * (the deck name could hint the answer), a small quiet line under the meaning once revealed. A
 * long deck name is cut to one line; a tap shows the FULL name (with "(from tutor)") and Open
 * deck →, never peeks back at the question; a second tap / back closes it.
 */
class DeckPillTest : LabScreenshotTest() {
    private val long = "课堂生词 Lesson words – 12 Oct (from tutor)"
    private val reveals = mutableListOf<Any?>()
    private val peeks = mutableListOf<Unit>()
    private val pill = mutableListOf<String>()
    private val opened = mutableListOf<String>()

    @Before fun grantMic() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.RECORD_AUDIO)
    }

    private fun studyScreen(cardType: String = CardTypes.HANZI_TO_MEANING, dark: Boolean = false, bumped: Boolean = false, revealed: Boolean = true) {
        val now = Js.parseDate("2026-10-16T09:30:00.000Z")
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", Samples.note.id, "deck-42", cardType, state)
        val view = CardView(card, Samples.note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, long, true, bumped = bumped, bumpedBy = if (bumped) "Minghui" else null)
        val ui = StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(), canUndo = false, online = true, forcedOffline = false)
        val actions = StudyActions(
            onReveal = { reveals += it },
            onPeek = { peeks += Unit },
            onDeckPill = { pill += it },
            onOpenDeck = { opened += it },
        )
        val start = if (revealed) CardStartState(flipped = true) else null
        compose.setContent { LabTheme(dark = dark) { StudyScreen(ui, playingKey = null, actions = actions, cardStart = start, autoplay = false) } }
        compose.mainClock.advanceTimeBy(1_500)
    }

    @Test fun neverOnTheQuestionSideThenSmallUnderTheMeaningOnceRevealed() {
        studyScreen(bumped = true, revealed = false)
        compose.onNodeWithText("Read · 读").assertIsDisplayed()
        compose.onNodeWithTag(DECK_PILL_TAG).assertDoesNotExist()
        compose.onRoot().captureRoboImage("screenshots/study-deck-pill-01-question-none.png")

        compose.onNodeWithText("Show answer").performClick()
        compose.mainClock.advanceTimeBy(1_500)
        assertEquals(1, reveals.size)
        compose.onNodeWithTag(DECK_PILL_TAG).assertIsDisplayed().assertContentDescriptionEquals("Deck: $long")
        val label = compose.onNodeWithTag(DECK_PILL_LABEL_TAG, useUnmergedTree = true).getBoundsInRoot()
        assertTrue("the label is cut inside the pill", label.right - label.left < DECK_PILL_MAX_WIDTH)
        assertTrue("caption-size: one small line", label.bottom - label.top < 20.dp)
        // Under the meaning, above Play.
        val meaning = compose.onNodeWithText(Samples.note.english).getBoundsInRoot()
        val play = compose.onNodeWithTag(PLAY_WORD_TAG).getBoundsInRoot()
        assertTrue("under the meaning", label.top > meaning.bottom)
        assertTrue("above Play", label.bottom < play.top)
        compose.onNodeWithTag(DECK_PILL_FULL_TAG).assertDoesNotExist()
        compose.onRoot().captureRoboImage("screenshots/study-deck-pill-02-answer.png")
    }

    @Test fun aTapShowsTheFullNameAndNeverPeeks() {
        studyScreen()
        compose.onNodeWithTag(DECK_PILL_TAG).performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithTag(DECK_PILL_FULL_TAG).assertIsDisplayed()
        compose.onNodeWithTag(DECK_PILL_NAME_TAG, useUnmergedTree = true).assertIsDisplayed().assertTextEquals(long)
        compose.onNodeWithText("Open deck →").assertIsDisplayed()
        assertTrue("never peeked back at the question", peeks.isEmpty())
        assertEquals(listOf("expand"), pill)
        captureScreenRoboImage("screenshots/study-deck-pill-03-expanded.png")

        compose.onNodeWithTag(DECK_PILL_OPEN_TAG).performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(listOf("deck-42"), opened)
        assertEquals(listOf("expand", "open_deck"), pill)
        compose.onNodeWithTag(DECK_PILL_FULL_TAG).assertDoesNotExist()
        assertTrue(peeks.isEmpty())
    }

    @Test fun aSecondTapClosesIt() {
        studyScreen(CardTypes.MEANING_TO_HANZI)
        compose.onNodeWithTag(DECK_PILL_TAG).performClick()
        compose.mainClock.advanceTimeBy(300)
        compose.onNodeWithTag(DECK_PILL_FULL_TAG).assertIsDisplayed()
        compose.onNodeWithTag(DECK_PILL_TAG).performClick()
        compose.mainClock.advanceTimeBy(300)
        compose.onNodeWithTag(DECK_PILL_FULL_TAG).assertDoesNotExist()
        assertTrue(peeks.isEmpty())
    }

    @Test fun noPillOnTheMeaningQuestion() {
        studyScreen(CardTypes.MEANING_TO_HANZI, revealed = false)
        compose.onNodeWithTag(DECK_PILL_TAG).assertDoesNotExist()
    }

    @Test fun noPillOnTheListenQuestion() {
        studyScreen(CardTypes.AUDIO_TO_HANZI, revealed = false)
        compose.onNodeWithTag(DECK_PILL_TAG).assertDoesNotExist()
    }

    @Test fun expandedDark() {
        studyScreen(CardTypes.AUDIO_TO_HANZI, dark = true)
        compose.onNodeWithTag(DECK_PILL_TAG).performClick()
        compose.mainClock.advanceTimeBy(500)
        captureScreenRoboImage("screenshots/study-deck-pill-04-expanded-dark.png")
    }
}
