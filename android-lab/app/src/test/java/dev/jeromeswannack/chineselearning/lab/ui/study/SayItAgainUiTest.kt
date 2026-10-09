package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.delay
import org.junit.Assert.assertEquals
import org.junit.Test
import org.robolectric.Shadows.shadowOf

/**
 * "🎤 Say it again", the card's side (CardStage): the pill beside Play once the answer was spoken;
 * while a say-again is under way the card shows the question with the live transcript (the old
 * verdict out of sight), ⏹ / a tap stops, ✕ cancels; its answer is checked anew as the card turns
 * back. Screenshots: study-say*.png.
 */
class SayItAgainUiTest : LabScreenshotTest() {
    private val now = Js.parseDate("2026-09-27T09:30:00.000Z")
    private val note = Samples.note.copy(
        hanzi = "由", pinyin = "yóu", english = "from; by (the cause or agent)",
        funFacts = "**由** (yóu) from; by — marks who is responsible or where something starts.\n- 这件事由他负责。He is in charge of this.\n- Same sound as 油 (oil) and 游 (to swim): said aloud they can't be told apart.",
    )
    private val reveals = mutableListOf<AnswerKey.Verdict?>()
    private val checked = mutableListOf<Pair<AnswerKey.Verdict, Boolean>>()
    private val calls = mutableListOf<String>()

    private fun view(): CardView {
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", note.id, "d1", CardTypes.MEANING_TO_HANZI, state)
        return CardView(card, note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3 · Words", true)
    }
    private val theView = view()

    private fun ui(spoken: SpokenUi, online: Boolean = true) =
        StudyUi(StudyPhase.Showing(theView), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = online, forcedOffline = false, extras = CardExtras(spoken = spoken))

    private val actions = StudyActions(
        onReveal = { reveals += it },
        onSpokenChecked = { v, retry -> checked += v to retry },
        onSayAgain = { calls += "sayAgain" },
        onStopSpoken = { calls += "stop" },
        onCancelSpoken = { calls += "cancel" },
        onRetrySpoken = { calls += "retry" },
    )

    private val first = SpokenResult("油", submit = true, seq = 1)
    private val answered = SpokenUi(result = first)

    // ---------------- behaviour ----------------

    @Test fun sayItAgainFlipsToTheQuestionAndChecksTheNewAnswer() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).grantPermissions(android.Manifest.permission.RECORD_AUDIO)
        var state by mutableStateOf(ui(answered))
        compose.setContent { LabTheme { StudyScreen(state, playingKey = null, actions = actions, autoplay = false) } }
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithText("Sounded right ✓ — written 由").assertIsDisplayed()
        compose.onNodeWithTag(SAY_AGAIN_TAG).performClick()
        assertEquals(listOf("sayAgain"), calls)

        // Listening: the question with the live box, the old verdict out of sight.
        state = ui(SpokenUi(phase = SpokenPhase.LISTENING, partialText = "由", result = first, again = true))
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag(SAY_AGAIN_FRONT_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(SPOKEN_LIVE_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Tap anywhere to stop").assertIsDisplayed()
        compose.onNodeWithText("Sounded right ✓ — written 由").assertDoesNotExist() // the hidden answer side is silent
        compose.onNodeWithTag(SPOKEN_MIC_TAG).performClick()
        compose.onNodeWithText("✕ Cancel").performClick()
        assertEquals(listOf("sayAgain", "stop", "cancel"), calls)

        // The new answer lands: checked anew (exact now), the answer side back, no panel.
        state = ui(SpokenUi(result = SpokenResult("由", submit = true, seq = 2, again = true)))
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(listOf(AnswerKey.Verdict.SOUND, AnswerKey.Verdict.EXACT), reveals)
        assertEquals(listOf(AnswerKey.Verdict.SOUND to false, AnswerKey.Verdict.EXACT to true), checked)
        assertEquals(0, compose.onAllNodesWithTagCount(SAY_AGAIN_FRONT_TAG))
        assertEquals(0, compose.onAllNodesWithTagCount(SPOKEN_SOUND_TAG))
        compose.onNodeWithTag(SAY_AGAIN_TAG).assertIsDisplayed()
    }

    @Test fun aCancelledSayItAgainShowsThePreviousResult() {
        var state by mutableStateOf(ui(answered))
        compose.setContent { LabTheme { StudyScreen(state, playingKey = null, actions = actions, autoplay = false) } }
        compose.mainClock.advanceTimeBy(1_000)
        state = ui(SpokenUi(phase = SpokenPhase.LISTENING, result = first, again = true))
        compose.mainClock.advanceTimeBy(1_000)
        state = ui(SpokenUi(result = first)) // the ViewModel's cancel
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithText("Sounded right ✓ — written 由").assertIsDisplayed()
        assertEquals(1, checked.size)
    }

    @Test fun aTypedAnswerHasNoSayItAgain() {
        compose.setContent { LabTheme { StudyScreen(ui(SpokenUi()), playingKey = null, actions = actions, autoplay = false) } }
        compose.onNodeWithText("Show answer").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(0, compose.onAllNodesWithTagCount(SAY_AGAIN_TAG))
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTagCount(tag: String) =
        onAllNodes(androidx.compose.ui.test.hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().size

    // ---------------- screenshots ----------------

    /** The card answered by speaking, then [then] after the reveal has settled. */
    @Composable
    private fun Sequence(then: SpokenUi?, online: Boolean = true) {
        var state by remember { mutableStateOf(ui(answered, online)) }
        LaunchedEffect(Unit) {
            delay(1_200)
            if (then != null) state = ui(then, online)
        }
        StudyScreen(state, playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotBackPill() = shoot("study-say01-back-pill", settleMs = 3_000) { Sequence(null) }

    @Test fun shotListening() = shoot("study-say02-listening", settleMs = 3_000) {
        Sequence(SpokenUi(phase = SpokenPhase.LISTENING, finalText = "由", partialText = "", result = first, again = true))
    }

    @Test fun shotListeningDark() = shoot("study-say03-listening-dark", dark = true, settleMs = 3_000) {
        Sequence(SpokenUi(phase = SpokenPhase.LISTENING, finalText = "由", partialText = "", result = first, again = true))
    }

    @Test fun shotNewVerdict() = shoot("study-say04-new-verdict", settleMs = 4_000) {
        Sequence(SpokenUi(result = SpokenResult("由", submit = true, seq = 2, again = true)))
    }

    @Test fun shotNewVerdictDark() = shoot("study-say05-new-verdict-dark", dark = true, settleMs = 4_000) {
        Sequence(SpokenUi(result = SpokenResult("由", submit = true, seq = 2, again = true)))
    }

    @Test fun shotFailed() = shoot("study-say06-failed", settleMs = 3_000) {
        Sequence(SpokenUi(phase = SpokenPhase.FAILED, failure = SpokenFailure.FAILED, result = first, again = true))
    }
}
