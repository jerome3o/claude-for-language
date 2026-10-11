package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
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
 * "🎤 Say it" practice, the card's side (CardStage): after 👁 Show answer with nothing typed or said the
 * answer side has a 🎤 Say it pill; it runs the Say it again flow on the question side (no ✏️ Edit on
 * its review) and its result shows as "You said" only — the card's answer, verdict and rating are
 * untouched. Screenshots: study-practice*.png.
 */
class SayItPracticeUiTest : LabScreenshotTest() {
    private val now = Js.parseDate("2026-10-11T09:30:00.000Z")
    private val note = Samples.note.copy(
        hanzi = "由", pinyin = "yóu", english = "from; by (the cause or agent)",
        funFacts = "**由** (yóu) from; by — marks who is responsible or where something starts.\n- 这件事由他负责。He is in charge of this.",
    )
    private val reveals = mutableListOf<AnswerKey.Verdict?>()
    private val checked = mutableListOf<AnswerKey.Verdict>()
    private val calls = mutableListOf<String>()

    private fun view(start: CardStartState = CardStartState()): CardView {
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", note.id, "d1", CardTypes.MEANING_TO_HANZI, state)
        return CardView(card, note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3 · Words", true, start = start)
    }

    private fun ui(spoken: SpokenUi, v: CardView = view()) =
        StudyUi(StudyPhase.Showing(v), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = true, forcedOffline = false, extras = CardExtras(spoken = spoken))

    private val actions = StudyActions(
        onReveal = { reveals += it },
        onSpokenChecked = { v, _, _ -> checked += v },
        onRetakeSpoken = { calls += "retake" },
        onSubmitSpoken = { calls += "submit" },
        onEditSpoken = { calls += "edit" },
        onSayAgain = { calls += "sayAgain" },
        onSayPractice = { calls += "practice" },
        onStopSpoken = { calls += "stop" },
        onCancelSpoken = { calls += "cancel" },
    )

    private fun count(tag: String) =
        compose.onAllNodes(androidx.compose.ui.test.hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().size

    @Test fun showAnswerThenSayItShowsYouSaidAndLeavesTheAnswerAlone() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).grantPermissions(android.Manifest.permission.RECORD_AUDIO)
        var state by mutableStateOf(ui(SpokenUi()))
        compose.setContent { LabTheme { StudyScreen(state, playingKey = null, actions = actions, autoplay = false) } }
        compose.onNodeWithContentDescription(SHOW_ANSWER_LABEL).performClick()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(listOf<AnswerKey.Verdict?>(null), reveals) // nothing was answered
        assertEquals(0, count(SAY_AGAIN_TAG))
        compose.onNodeWithTag(SAY_PRACTICE_TAG).assertTextContains("🎤 Say it").performClick()
        assertEquals(listOf("practice"), calls)

        // Listening: the question side with the live box, like Say it again.
        state = ui(SpokenUi(phase = SpokenPhase.LISTENING, partialText = "这件事", again = true, practice = true))
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag(SAY_AGAIN_FRONT_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(SPOKEN_LIVE_TAG, useUnmergedTree = true).assertIsDisplayed()

        // Its review: Retry and Submit, no ✏️ Edit (it is shown as said).
        state = ui(SpokenUi(phase = SpokenPhase.REVIEW, finalText = "这件事由他负责", again = true, practice = true))
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(0, count(SPOKEN_REVIEW_EDIT_TAG))
        compose.onNodeWithTag(SPOKEN_REVIEW_RETRY_TAG).performClick()
        compose.onNodeWithTag(SPOKEN_REVIEW_SUBMIT_TAG).performClick()
        assertEquals(listOf("practice", "retake", "submit"), calls)

        // The result: "You said" with the orange "Answer found in your sentence", nothing else changes.
        state = ui(SpokenUi(result = SpokenResult("这件事由他负责", submit = true, seq = 1, again = true, reviewed = true, practice = true)))
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag(PRACTICE_YOU_SAID_TAG, useUnmergedTree = true).assertIsDisplayed()
        assertEquals(1, count("$YOU_SAID_TAG-contains"))
        assertEquals(listOf<AnswerKey.Verdict?>(null), reveals) // no new verdict: practice is not an answer
        assertEquals(emptyList<AnswerKey.Verdict>(), checked)
        compose.onNodeWithTag(SAY_PRACTICE_TAG).assertTextContains("🎤 Say it again")
    }

    @Test fun aSpokenAnswerHasSayItAgainNotPractice() {
        val state = ui(SpokenUi(result = SpokenResult("由", submit = true, seq = 1)))
        compose.setContent { LabTheme { StudyScreen(state, playingKey = null, actions = actions, autoplay = false) } }
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(1, count(SAY_AGAIN_TAG))
        assertEquals(0, count(SAY_PRACTICE_TAG))
    }

    // ---------------- screenshots ----------------

    /** Revealed with no attempt (Show answer), then [then]. */
    @Composable
    private fun Sequence(then: SpokenUi?) {
        val revealed = remember { view(CardStartState(flipped = true)) }
        var state by remember { mutableStateOf(ui(SpokenUi(), revealed)) }
        LaunchedEffect(Unit) {
            delay(1_200)
            if (then != null) state = ui(then, revealed)
        }
        StudyScreen(state, playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotBackPill() = shoot("study-practice01-back-pill", settleMs = 3_000) { Sequence(null) }

    @Test fun shotListening() = shoot("study-practice02-listening", settleMs = 3_000) {
        Sequence(SpokenUi(phase = SpokenPhase.LISTENING, finalText = "这件事由", partialText = "他", again = true, practice = true))
    }

    @Test fun shotReview() = shoot("study-practice03-review", settleMs = 3_000) {
        Sequence(SpokenUi(phase = SpokenPhase.REVIEW, finalText = "这件事由他负责", again = true, practice = true))
    }

    @Test fun shotYouSaid() = shoot("study-practice04-you-said", settleMs = 4_000) {
        Sequence(SpokenUi(result = SpokenResult("这件事由他负责", submit = true, seq = 1, again = true, reviewed = true, practice = true)))
    }

    @Test fun shotYouSaidDark() = shoot("study-practice05-you-said-dark", dark = true, settleMs = 4_000) {
        Sequence(SpokenUi(result = SpokenResult("这件事由他负责", submit = true, seq = 1, again = true, reviewed = true, practice = true)))
    }
}
