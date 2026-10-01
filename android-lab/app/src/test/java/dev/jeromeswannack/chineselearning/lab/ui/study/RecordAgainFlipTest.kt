package dev.jeromeswannack.chineselearning.lab.ui.study

import android.Manifest
import android.app.Application
import androidx.activity.OnBackPressedDispatcher
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.click
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
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
import org.junit.Before
import org.junit.Test
import org.robolectric.Shadows.shadowOf

/**
 * Record again on the answer side: the card turns to the question while the new take records
 * (he reads it from the hanzi alone); a tap anywhere on the card — or Stop — stops it and turns
 * back to the answer, where the new take is transcribed. Back / Cancel drops the new take and
 * the answer comes back with the previous one and its "You said". Nothing is rated or re-revealed.
 * The first (front-side) Record flow is unchanged.
 */
class RecordAgainFlipTest : LabScreenshotTest() {
    private val said = TranscriptionComparison("打算", "dǎ suàn", isMatch = true, containsExpected = false)
    private val previous = TakeUi(hasTake = true, transcription = TranscriptionUi.Done(said))
    private var ui by mutableStateOf<StudyUi?>(null)
    private val calls = mutableListOf<String>()
    private val reveals = mutableListOf<Any?>()
    private val rated = mutableListOf<Int>()
    private var exits = 0
    private lateinit var back: OnBackPressedDispatcher

    @Before fun grantMic() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.RECORD_AUDIO)
    }

    private fun baseUi(take: TakeUi): StudyUi {
        val now = Js.parseDate("2026-09-27T09:30:00.000Z")
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", Samples.note.id, "d1", CardTypes.HANZI_TO_MEANING, state)
        val view = CardView(card, Samples.note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3", true)
        return StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(), canUndo = false, online = true, forcedOffline = false, extras = CardExtras(take = take))
    }

    private fun setTake(change: (TakeUi) -> TakeUi) {
        val u = ui!!
        ui = u.copy(extras = u.extras.copy(take = change(u.extras.take)))
    }

    /** A fake session: the same take transitions StudyViewModel makes. */
    private fun studyScreen(take: TakeUi, start: CardStartState) {
        ui = baseUi(take)
        val actions = StudyActions(
            onReveal = { reveals += it },
            onRate = { r, _, _ -> rated += r },
            onStartRecording = { skip ->
                calls += "start(skip=$skip)"
                setTake { if (it.hasTake) it.copy(recording = true) else TakeUi(recording = true, starting = !skip) }
            },
            onStopRecording = { calls += "stop"; setTake { TakeUi(hasTake = true, transcription = TranscriptionUi.Working) } },
            onCancelRecording = { calls += "cancel"; setTake { it.copy(recording = false, starting = false) } },
        )
        compose.setContent {
            back = LocalOnBackPressedDispatcherOwner.current!!.onBackPressedDispatcher
            LabTheme {
                androidx.activity.compose.BackHandler { exits++ } // StudyScreen's own "back leaves Study"
                StudyScreen(ui!!, playingKey = null, actions = actions, cardStart = start, autoplay = false)
            }
        }
    }

    private fun assertAnswerSide() {
        compose.onNodeWithText(Samples.note.pinyin).assertExists()
        compose.onNodeWithTag(RECORD_AGAIN_FRONT_TAG, useUnmergedTree = true).assertDoesNotExist()
    }

    private fun assertRecordingOnTheQuestion() {
        compose.onNodeWithTag(RECORD_AGAIN_FRONT_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Tap anywhere to stop").assertIsDisplayed()
        compose.onNodeWithText(Samples.note.hanzi).assertIsDisplayed()
        // Read from the hanzi alone: no pinyin, no English, no "You said".
        compose.onNodeWithText(Samples.note.pinyin).assertDoesNotExist()
        compose.onNodeWithText("You said", substring = true).assertDoesNotExist()
        // The ratings stay up, like a peek.
        compose.onNodeWithText("Good").assertIsDisplayed()
    }

    @Test fun recordAgainFlipsToTheQuestionAndATapStopsAndTurnsBack() {
        studyScreen(previous, CardStartState(flipped = true))
        assertAnswerSide()
        compose.onNodeWithText("You said", substring = true).assertIsDisplayed()

        compose.onNodeWithText("🎤 Record again").performClick()
        compose.mainClock.advanceTimeBy(800)
        assertEquals(listOf("start(skip=true)"), calls)
        assertRecordingOnTheQuestion()
        compose.onRoot().captureRoboImage("screenshots/study-b11-record-again-question.png")

        // A tap on the card's empty space (top padding) stops it and turns back to the answer.
        compose.onNodeWithTag(CARD_FRONT_TAG).performTouchInput { click(Offset(centerX, 12f)) }
        compose.mainClock.advanceTimeBy(800)
        assertEquals(listOf("start(skip=true)", "stop"), calls)
        assertAnswerSide()
        compose.onNodeWithText("Transcribing…").assertIsDisplayed()
        compose.onNodeWithText("🎤 Record again").assertIsDisplayed()
        compose.onRoot().captureRoboImage("screenshots/study-b12-record-again-transcribing.png")

        assertTrue("nothing re-revealed", reveals.isEmpty())
        assertTrue("nothing rated", rated.isEmpty())
    }

    @Test fun theStopButtonStopsToo() {
        studyScreen(previous, CardStartState(flipped = true))
        compose.onNodeWithText("🎤 Record again").performClick()
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithText("⏹  Stop").performClick()
        compose.mainClock.advanceTimeBy(800)
        assertEquals(listOf("start(skip=true)", "stop"), calls)
        assertAnswerSide()
        compose.onNodeWithText("Transcribing…").assertIsDisplayed()
    }

    @Test fun backCancelsAndKeepsThePreviousTake() {
        studyScreen(previous, CardStartState(flipped = true))
        compose.onNodeWithText("🎤 Record again").performClick()
        compose.mainClock.advanceTimeBy(800)
        assertRecordingOnTheQuestion()

        compose.runOnUiThread { back.onBackPressed() }
        compose.mainClock.advanceTimeBy(800)
        assertEquals(listOf("start(skip=true)", "cancel"), calls)
        assertEquals("back cancels the take, it doesn't leave Study", 0, exits)
        assertAnswerSide()
        // The previous take and its result are untouched.
        compose.onNodeWithText("You said", substring = true).assertIsDisplayed()

        // Back again (not recording) leaves Study as before.
        compose.runOnUiThread { back.onBackPressed() }
        assertEquals(1, exits)
    }

    @Test fun cancelButtonKeepsThePreviousTake() {
        studyScreen(previous, CardStartState(flipped = true))
        compose.onNodeWithText("🎤 Record again").performClick()
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithText("Cancel").performClick()
        compose.mainClock.advanceTimeBy(800)
        assertEquals(listOf("start(skip=true)", "cancel"), calls)
        assertAnswerSide()
        compose.onNodeWithText("You said", substring = true).assertIsDisplayed()
    }

    @Test fun theFirstRecordOnTheFrontIsUnchanged() {
        studyScreen(TakeUi(), CardStartState())
        compose.onNodeWithText("🎤  Record").performClick()
        compose.mainClock.advanceTimeBy(800)
        assertEquals(listOf("start(skip=false)"), calls)
        // The usual front controls (no Record-again panel, no flip), Stop at the bottom.
        compose.onNodeWithTag(RECORD_AGAIN_FRONT_TAG, useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag(CARD_BACK_TAG).assertDoesNotExist()
        compose.onNodeWithText("Recording…").assertIsDisplayed()
        setTake { it.copy(starting = false) }
        compose.mainClock.advanceTimeBy(300)
        compose.onNodeWithText("⏹  Stop recording").performClick()
        compose.mainClock.advanceTimeBy(800)
        assertEquals(listOf("start(skip=false)", "stop"), calls)
        // Still the question: the take waits for "Check answer".
        compose.onNodeWithTag(CARD_BACK_TAG).assertDoesNotExist()
        compose.onNodeWithText("Check answer").assertIsDisplayed()
        assertTrue(reveals.isEmpty())
    }
}
