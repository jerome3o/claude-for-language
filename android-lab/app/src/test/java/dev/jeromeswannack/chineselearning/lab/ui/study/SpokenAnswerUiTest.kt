package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
import org.junit.Assert.assertEquals
import org.junit.Test
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
        onSpokenChecked = { checked += it },
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
        compose.onNodeWithText("✕ Cancel").assertIsDisplayed()
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
        compose.onNodeWithText("Show").assertIsDisplayed() // the box stays, empty and editable
    }

    @Test fun theMicStartsWithThePermissionAndOfflineSaysWhy() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).grantPermissions(android.Manifest.permission.RECORD_AUDIO)
        compose.setContent { LabTheme { StudyScreen(ui(SpokenUi()), playingKey = null, actions = actions, autoplay = false) } }
        compose.onNodeWithTag(SPOKEN_MIC_TAG).performClick()
        assertEquals(listOf("start"), calls)
    }

    // ---------------- screenshots ----------------

    @Test fun shotFront() = shoot("study-s01-typed-mic") { StudyScreen(ui(SpokenUi()), playingKey = null, actions = StudyActions(), autoplay = false) }

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

    @Test fun shotSettings() = shoot("study-s08-settings-auto-submit") {
        SpokenAnswerSection(on = true) {}
    }
}
