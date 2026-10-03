package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import androidx.compose.ui.test.onRoot
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.NoteAudio
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Auto-audio on the card: the Play buttons while a clip is being made ("Generating audio…",
 * the tap waits for it), offline ("Audio will be made when you're online", Play falls back to
 * the device voice) and after a failure ("Couldn't make audio — retry"). Also the screenshots
 * `study-audio-*`.
 */
class CardAudioTest : LabScreenshotTest() {
    private var played = 0
    private var retried = 0

    private fun screen(type: String, audio: CardAudio, flipped: Boolean = false, online: Boolean = true, shot: String? = null) {
        val now = Js.parseDate("2026-09-30T09:30:00.000Z")
        val state = CardScheduler.initialCardState()
        val note = Samples.note.copy(audioUrl = null, sentenceClueAudioUrl = null)
        val card = QueueCard("c1", note.id, "d1", type, state)
        val view = CardView(card, note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3", true)
        val ui = StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(), online = online, cardAudio = audio)
        val actions = StudyActions(onPlayWord = { played++ }, onRetryAudio = { retried++ })
        compose.setContent { LabTheme { StudyScreen(ui, playingKey = null, actions = actions, cardStart = CardStartState(flipped = flipped), autoplay = false) } }
        if (shot != null) {
            compose.mainClock.advanceTimeBy(1_500)
            compose.onRoot().captureRoboImage("screenshots/$shot.png")
        }
    }

    @Test fun rulesMapTheRequestStatusToEachClip() {
        val missingBoth = setOf(NoteAudio.Clip.WORD, NoteAudio.Clip.SENTENCE)
        assertEquals(CardAudio(), CardAudioRules.of(emptySet(), NoteAudio.Status.Generating, online = true))
        assertEquals(CardAudio(ClipState.GENERATING, ClipState.READY), CardAudioRules.of(setOf(NoteAudio.Clip.WORD), NoteAudio.Status.Generating, online = true))
        assertEquals(CardAudio(ClipState.GENERATING, ClipState.GENERATING), CardAudioRules.of(missingBoth, null, online = true))
        assertEquals(CardAudio(ClipState.WAITING_FOR_CONNECTION, ClipState.WAITING_FOR_CONNECTION), CardAudioRules.of(missingBoth, null, online = false))
        assertEquals(CardAudio(ClipState.WAITING_FOR_CONNECTION, ClipState.WAITING_FOR_CONNECTION), CardAudioRules.of(missingBoth, NoteAudio.Status.WaitingForConnection, online = true))
        assertEquals(CardAudio(ClipState.FAILED, ClipState.FAILED), CardAudioRules.of(missingBoth, NoteAudio.Status.Failed(1, 0), online = true))
        // Queued on the server: "coming", also while it is asked about again — but offline the device voice is the last resort.
        assertEquals(CardAudio(ClipState.COMING, ClipState.READY), CardAudioRules.of(setOf(NoteAudio.Clip.WORD), NoteAudio.Status.Coming(1, 0), online = true))
        assertEquals(CardAudio(ClipState.COMING, ClipState.COMING), CardAudioRules.of(missingBoth, NoteAudio.Status.Coming(2, 0, asking = true), online = true))
        assertEquals(CardAudio(ClipState.WAITING_FOR_CONNECTION, ClipState.READY), CardAudioRules.of(setOf(NoteAudio.Clip.WORD), NoteAudio.Status.Coming(1, 0), online = false))
        // The clip landed (no longer missing): ready, whatever the status still says.
        assertEquals(CardAudio(), CardAudioRules.of(emptySet(), NoteAudio.Status.Coming(1, 0), online = true))
    }

    @Test fun comingOnTheBack() {
        screen(CardTypes.HANZI_TO_MEANING, CardAudio(ClipState.COMING, ClipState.READY), flipped = true, shot = "study-audio-05-coming-back")
        compose.onNodeWithText(CardAudioRules.COMING).assertExists()
        compose.onNodeWithText(CardAudioRules.GENERATING).assertDoesNotExist()
        compose.onNodeWithText(CardAudioRules.FAILED).assertDoesNotExist()
        // Play is a normal Play (the device voice meanwhile), not a spinner.
        compose.onNodeWithText("Play").performClick()
        assertEquals(1, played)
    }

    @Test fun comingOnTheListeningCardFront() {
        screen(CardTypes.AUDIO_TO_HANZI, CardAudio(ClipState.COMING, ClipState.READY), shot = "study-audio-06-coming-front")
        compose.onNodeWithText(CardAudioRules.COMING_FRONT).assertExists()
        compose.onNodeWithContentDescription(CardAudioRules.GENERATING).assertDoesNotExist()
        compose.onNodeWithTag(PLAY_WORD_TAG).performClick()
        assertEquals(1, played)
    }

    @Test fun generatingOnTheListeningCardFront() {
        screen(CardTypes.AUDIO_TO_HANZI, CardAudio(ClipState.GENERATING, ClipState.READY), shot = "study-audio-01-generating-front")
        compose.onNodeWithText(CardAudioRules.GENERATING).assertExists()
        compose.onNodeWithContentDescription(CardAudioRules.GENERATING).assertExists()
        // The speaker still takes the tap: the session plays the clip the moment it lands.
        compose.onNodeWithTag(PLAY_WORD_TAG).performClick()
        assertEquals(1, played)
    }

    @Test fun generatingOnTheBack() {
        screen(CardTypes.HANZI_TO_MEANING, CardAudio(ClipState.GENERATING, ClipState.GENERATING), flipped = true, shot = "study-audio-02-generating-back")
        compose.onNodeWithTag(PLAY_WORD_TAG).assertExists()
        compose.onNodeWithText(CardAudioRules.GENERATING).assertExists()
        // The card's own sentence (row 1) shows a spinner instead of its play button.
        compose.onNodeWithTag(SENTENCE_AUDIO_BUSY_TAG).assertExists()
    }

    @Test fun offlineSaysItWillBeMadeLater() {
        screen(CardTypes.AUDIO_TO_HANZI, CardAudio(ClipState.WAITING_FOR_CONNECTION, ClipState.WAITING_FOR_CONNECTION), online = false, shot = "study-audio-03-offline")
        compose.onNodeWithText(CardAudioRules.WAITING).assertExists()
        compose.onNodeWithText(CardAudioRules.GENERATING).assertDoesNotExist()
        // Play still answers (the device voice) while it waits.
        compose.onNodeWithTag(PLAY_WORD_TAG).performClick()
        assertEquals(1, played)
    }

    @Test fun failureOffersARetry() {
        screen(CardTypes.HANZI_TO_MEANING, CardAudio(ClipState.FAILED, ClipState.FAILED), flipped = true, shot = "study-audio-04-failed")
        compose.onNodeWithText(CardAudioRules.FAILED).performClick()
        assertEquals(1, retried)
        compose.onNodeWithText("Play").assertExists()
    }

    @Test fun typingCardSentenceButtonWaitsForItsClip() {
        screen(CardTypes.MEANING_TO_HANZI, CardAudio(ClipState.READY, ClipState.GENERATING))
        compose.onNodeWithText(CardAudioRules.GENERATING).assertIsNotEnabled()
        compose.onNodeWithText(CardAudioRules.WAITING).assertDoesNotExist()
    }

    @Test fun readyShowsNothingExtra() {
        screen(CardTypes.AUDIO_TO_HANZI, CardAudio())
        compose.onNodeWithTag(AUDIO_STATUS_TAG).assertDoesNotExist()
        compose.onNodeWithContentDescription("Play").assertExists()
    }
}
