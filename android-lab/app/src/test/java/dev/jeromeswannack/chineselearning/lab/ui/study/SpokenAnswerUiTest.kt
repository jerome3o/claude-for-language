package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import androidx.compose.ui.test.onNodeWithContentDescription
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.robolectric.annotation.Config
import org.robolectric.Shadows.shadowOf

/**
 * Say the answer on a typing card, the card's side (CardStage): 🎤 in the typing row, the live
 * transcript in place of the box (confirmed + grey tail), ✕ Cancel, a spoken answer auto-checked —
 * a homophone is "Sounded right ✓ — written 由" — or only filled in (auto-submit off), the retry line
 * when both transcription paths failed, the offline hint. Screenshots: study-s*.png.
 */
class SpokenAnswerUiTest : LabScreenshotTest() {
    private val now = Js.parseDate("2026-09-27T09:30:00.000Z")
    private val note = Samples.note.copy(
        hanzi = "由", pinyin = "yóu", english = "from; by (the cause or agent)",
        funFacts = "**由** (yóu) from; by — marks who is responsible or where something starts.\n- 这件事由他负责。He is in charge of this.\n- Same sound as 油 (oil) and 游 (to swim): said aloud they can't be told apart.",
    )
    private val reveals = mutableListOf<AnswerKey.Verdict?>()
    private val checked = mutableListOf<AnswerKey.Verdict>()
    private val calls = mutableListOf<String>()

    private fun view(type: String = CardTypes.MEANING_TO_HANZI): CardView {
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", note.id, "d1", type, state)
        return CardView(card, note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3 · Words", true)
    }

    private fun ui(spoken: SpokenUi, online: Boolean = true, type: String = CardTypes.MEANING_TO_HANZI) =
        StudyUi(StudyPhase.Showing(view(type)), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = online, forcedOffline = false, extras = CardExtras(spoken = spoken))

    private val actions = StudyActions(
        onReveal = { reveals += it },
        onSpokenChecked = { v, retry -> checked += v; if (retry) calls += "checked-again" },
        onStartSpoken = { calls += "start" },
        onStopSpoken = { calls += "stop" },
        onCancelSpoken = { calls += "cancel" },
        onRetrySpoken = { calls += "retry" },
    )

    // ---------------- behaviour ----------------

    @Test fun aSpokenHomophoneIsSubmittedAndRightBySound() {
        var state by mutableStateOf(ui(SpokenUi(phase = SpokenPhase.LISTENING, finalText = "", partialText = "油")))
        compose.setContent { LabTheme { StudyScreen(state, playingKey = null, actions = actions, autoplay = false) } }
        compose.onNodeWithTag(SPOKEN_LIVE_TAG).assertIsDisplayed()
        // The row turns into ✕ Cancel + ⏹ Stop (one Cancel only); Type / Show answer are gone meanwhile.
        compose.onNodeWithText("✕ Cancel").assertIsDisplayed()
        compose.onNodeWithText("⏹  Stop").assertIsDisplayed()
        assertEquals(0, compose.onAllNodes(hasTestTag(SPOKEN_TYPE_TAG)).fetchSemanticsNodes().size)
        compose.onNodeWithTag(SPOKEN_MIC_TAG).performClick()
        assertEquals(listOf("stop"), calls)

        state = ui(SpokenUi(result = SpokenResult("油", submit = true, seq = 1)))
        compose.waitForIdle()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(listOf(AnswerKey.Verdict.SOUND), reveals)
        assertEquals(listOf(AnswerKey.Verdict.SOUND), checked)
        compose.onNodeWithTag(SPOKEN_SOUND_TAG).assertExists()
        compose.onNodeWithText("Sounded right ✓ — written 由").assertExists()
        compose.onNodeWithText("You said: 油").assertExists()
    }

    @Test fun autoSubmitOffFillsTheBoxOnly() {
        var state by mutableStateOf(ui(SpokenUi(phase = SpokenPhase.FINISHING, finalText = "油")))
        compose.setContent { LabTheme { StudyScreen(state, playingKey = null, actions = actions, autoplay = false) } }
        state = ui(SpokenUi(result = SpokenResult("油", submit = false, seq = 1)))
        compose.waitForIdle()
        assertEquals(emptyList<AnswerKey.Verdict?>(), reveals)
        compose.onNodeWithText("油").assertExists()
        compose.onNodeWithText("Check").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(listOf(AnswerKey.Verdict.SOUND), reveals)
    }

    @Test fun bothFailingShowsTheRetryAndSubmitsNothing() {
        compose.setContent { LabTheme { StudyScreen(ui(SpokenUi(phase = SpokenPhase.FAILED, failure = SpokenFailure.FAILED)), playingKey = null, actions = actions, autoplay = false) } }
        compose.onNodeWithTag(SPOKEN_RETRY_TAG).performClick()
        assertEquals(listOf("retry"), calls)
        assertEquals(emptyList<AnswerKey.Verdict?>(), reveals)
        // Voice first stays up: typing is one tap away, and the box opens empty.
        compose.onNodeWithTag(SPOKEN_TYPE_TAG).performClick()
        compose.onNodeWithText("Show").assertIsDisplayed()
    }

    @Test fun voiceFirstShowsOneRowAndNoBoxUntilType() {
        compose.setContent { LabTheme { StudyScreen(ui(SpokenUi()), playingKey = null, actions = actions, autoplay = false) } }
        compose.onNodeWithTag(VOICE_FIRST_TAG).assertIsDisplayed()
        // One row of the read card's pills: ✏️ Type and 👁 Show answer small on the left, the wide 🎤 Say it on the right.
        val say = compose.onNodeWithContentDescription(SAY_IT_LABEL).assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val type = compose.onNodeWithContentDescription(TYPE_ANSWER_LABEL).assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        val show = compose.onNodeWithContentDescription(SHOW_ANSWER_LABEL).assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        compose.onNodeWithText("🎤  Say it").assertIsDisplayed()
        assertTrue("Type left of Show answer", type.right <= show.left)
        assertTrue("Show answer left of Say it", show.right <= say.left)
        assertTrue("Say it is the widest", say.width > show.width && say.width > type.width)
        assertEquals("one row", say.top, type.top, 0.5f)
        assertEquals("same height", say.height, show.height, 0.5f)
        assertEquals(0, compose.onAllNodes(hasSetTextAction()).fetchSemanticsNodes().size)
        compose.onNodeWithContentDescription(SHOW_ANSWER_LABEL).performClick()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(listOf<AnswerKey.Verdict?>(null), reveals)
    }

    @Test fun typeOpensTheFocusedBoxWithTheSmallMic() {
        compose.setContent { LabTheme { StudyScreen(ui(SpokenUi()), playingKey = null, actions = actions, autoplay = false) } }
        compose.onNodeWithTag(SPOKEN_TYPE_TAG).performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNode(hasSetTextAction()).assertIsFocused()
        compose.onNodeWithTag(SPOKEN_MIC_TAG).assertIsDisplayed()
        assertEquals(0, compose.onAllNodes(hasTestTag(VOICE_FIRST_TAG)).fetchSemanticsNodes().size)
    }

    @Test fun offlineTheBoxComesFirst() {
        compose.setContent { LabTheme { StudyScreen(ui(SpokenUi(), online = false), playingKey = null, actions = actions, autoplay = false) } }
        compose.onNode(hasSetTextAction()).assertIsDisplayed()
        assertEquals(0, compose.onAllNodes(hasTestTag(VOICE_FIRST_TAG)).fetchSemanticsNodes().size)
    }

    @Test fun theMicStartsWithThePermissionAndOfflineSaysWhy() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).grantPermissions(android.Manifest.permission.RECORD_AUDIO)
        compose.setContent { LabTheme { StudyScreen(ui(SpokenUi()), playingKey = null, actions = actions, autoplay = false) } }
        compose.onNodeWithTag(SPOKEN_MIC_TAG).performClick()
        assertEquals(listOf("start"), calls)
    }

    // ---------------- screenshots ----------------

    @Test fun shotFront() = shoot("study-s01-voice-first") { StudyScreen(ui(SpokenUi()), playingKey = null, actions = StudyActions(), autoplay = false) }

    @Test fun shotFrontDark() = shoot("study-s01b-voice-first-dark", dark = true) { StudyScreen(ui(SpokenUi(), type = CardTypes.AUDIO_TO_HANZI), playingKey = null, actions = StudyActions(), autoplay = false) }

    @Test fun shotTypingMode() {
        compose.setContent { LabTheme { StudyScreen(ui(SpokenUi()), playingKey = null, actions = StudyActions(), autoplay = false) } }
        compose.onNodeWithTag(SPOKEN_TYPE_TAG).performClick()
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/study-s09-typing-mode.png")
    }

    @Test fun shotListening() = shoot("study-s02-listening-live") {
        StudyScreen(ui(SpokenUi(phase = SpokenPhase.LISTENING, finalText = "我", partialText = "由")), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotSound() = shoot("study-s03-sounded-right", settleMs = 3_000) {
        StudyScreen(ui(SpokenUi(result = SpokenResult("油", submit = true, seq = 1))), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotClose() = shoot("study-s04-close-tones", settleMs = 3_000) {
        StudyScreen(ui(SpokenUi(result = SpokenResult("有", submit = true, seq = 1))), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotFailed() = shoot("study-s05-transcribe-failed") {
        StudyScreen(ui(SpokenUi(phase = SpokenPhase.FAILED, failure = SpokenFailure.FAILED)), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotOffline() = shoot("study-s06-offline-hint") {
        StudyScreen(ui(SpokenUi(offlineHint = true), online = false, type = CardTypes.AUDIO_TO_HANZI), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotDarkListening() = shoot("study-s07-listening-dark", dark = true) {
        StudyScreen(ui(SpokenUi(phase = SpokenPhase.LISTENING, finalText = "由", partialText = "于")), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotFrontAudioLight() = shoot("study-s01c-voice-first-listen") { StudyScreen(ui(SpokenUi(), type = CardTypes.AUDIO_TO_HANZI), playingKey = null, actions = StudyActions(), autoplay = false) }

    @Test fun shotDarkMeaning() = shoot("study-s01d-voice-first-meaning-dark", dark = true) { StudyScreen(ui(SpokenUi()), playingKey = null, actions = StudyActions(), autoplay = false) }

    @Test fun shotFinishing() = shoot("study-s02b-finishing") {
        StudyScreen(ui(SpokenUi(phase = SpokenPhase.FINISHING, finalText = "由")), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun shotFrontUnfolded() = shoot("study-s01e-voice-first-unfolded") { StudyScreen(ui(SpokenUi()), playingKey = null, actions = StudyActions(), autoplay = false) }

    @Test fun shotSettings() = shoot("study-s08-settings-auto-submit") {
        SpokenAnswerSection(on = true) {}
    }
}
