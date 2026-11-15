package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckInput
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckResult
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import org.junit.Test
import kotlin.test.assertEquals

/**
 * A read card's take checked by Claude (core ReadTakeCheck; web ReadTakeCheck.test.tsx; docs/STUDY_SESSION.md
 * "You said"): Jerome's 我越学中文，越觉得英文很繁琐。 read as 我越学中文，越觉得英语很"繁琐"。 — "Checking…" (never the
 * bare ✗), then ≈ Close with Claude's reason; the recogniser's quotes are never shown; only the quotes differing is
 * a device ✓ Match with no call. Screenshots: read-take-*.png.
 */
class ReadTakeCheckUiTest : LabScreenshotTest() {
    private val now = Js.parseDate("2026-11-15T09:30:00.000Z")
    private val card = "我越学中文，越觉得英文很繁琐。"
    private val note = Samples.note.copy(
        id = "n1", hanzi = card, pinyin = "wǒ yuè xué Zhōngwén, yuè juéde Yīngwén hěn fánsuǒ.",
        english = "The more I study Chinese, the more I find English to be complicated.",
        funFacts = "越…越… (yuè… yuè…) = the more … the more …",
        sentenceClue = null, sentenceCluePinyin = null, sentenceClueTranslation = null,
    )
    private val close = AnswerCheck(
        verdict = "almost", headline = "You said 英语 — the card has 英文 (same meaning).", suggested = "missed_it",
    )

    private fun ui(said: String): StudyUi {
        val state = CardScheduler.initialCardState()
        val c = QueueCard("c1", note.id, "d1", CardTypes.HANZI_TO_MEANING, state)
        val view = CardView(c, note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "Core Homework", true, start = CardStartState(flipped = true))
        return StudyUi(
            StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = true, forcedOffline = false,
            extras = CardExtras(take = TakeUi(hasTake = true, transcription = TranscriptionUi.Done(Transcription.compare(said, card)))),
        )
    }

    private fun actions(check: suspend (AnswerCheckInput) -> AnswerCheckResult) =
        StudyActions(onYouSaidCoach = { _, _ -> }, onYouSaidPlay = {}, answerCheck = check)

    @Test fun englishForEnglishIsCheckingThenClose() {
        val gate = CompletableDeferred<AnswerCheckResult>()
        val asked = mutableListOf<AnswerCheckInput>()
        compose.setContent { LabTheme { StudyScreen(ui("我越学中文，越觉得英语很\"繁琐\"。"), playingKey = null, actions = actions { asked += it; gate.await() }, autoplay = false) } }
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithTag("$YOU_SAID_TAG-checking", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Checking…", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("我越学中文，越觉得英语很繁琐。", useUnmergedTree = true).assertIsDisplayed()
        assertEquals(1, asked.size)
        assertEquals("read_aloud", asked[0].exerciseType)
        assertEquals("spoken", asked[0].input)
        assertEquals(card, asked[0].modelAnswer)
        assertEquals("我越学中文，越觉得英语很繁琐。", asked[0].answer)
        gate.complete(AnswerCheckResult(close, cached = false))
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithTag("$YOU_SAID_TAG-close", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Close", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(YOU_SAID_REASON_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(close.headline, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test fun onlyTheQuotesDifferIsAMatchWithNoCall() {
        var calls = 0
        compose.setContent { LabTheme { StudyScreen(ui("我越学中文，越觉得英文很\"繁琐\"。"), playingKey = null, actions = actions { calls++; awaitCancellation() }, autoplay = false) } }
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithTag("$YOU_SAID_TAG-match", useUnmergedTree = true).assertIsDisplayed()
        // What he said, inside the box, without the recogniser's quotes (the card's own hanzi is above it).
        compose.onNode(hasText(card) and hasAnyAncestor(hasTestTag("$YOU_SAID_TAG-match")), useUnmergedTree = true).assertIsDisplayed()
        assertEquals(0, calls)
    }

    @Test fun shotQuotesMatch() = shoot("read-take-01-quotes-match", settleMs = 2_000) {
        StudyScreen(ui("我越学中文，越觉得英文很\"繁琐\"。"), playingKey = null, actions = actions { awaitCancellation() }, autoplay = false)
    }
    @Test fun shotChecking() = shoot("read-take-02-checking", settleMs = 2_000) {
        StudyScreen(ui("我越学中文，越觉得英语很\"繁琐\"。"), playingKey = null, actions = actions { awaitCancellation() }, autoplay = false)
    }
    @Test fun shotClose() = shoot("read-take-03-close", settleMs = 2_000) {
        StudyScreen(ui("我越学中文，越觉得英语很\"繁琐\"。"), playingKey = null, actions = actions { AnswerCheckResult(close, cached = true) }, autoplay = false)
    }
    @Test fun shotCloseDark() = shoot("read-take-04-close-dark", dark = true, settleMs = 2_000) {
        StudyScreen(ui("我越学中文，越觉得英语很\"繁琐\"。"), playingKey = null, actions = actions { AnswerCheckResult(close, cached = true) }, autoplay = false)
    }
}
