package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The round ✎ (Check in Coach) on the orange "You said · Contains the answer" box (read cards and spoken
 * answers on the typing cards): the hanzi said opens in the Sentence Coach's Check my sentence. Only the
 * orange (contains) box has it; a read card's box also has ▶ (its take). Screenshots: study-yousaid-coach*.png.
 */
class YouSaidCoachUiTest : LabScreenshotTest() {
    private val now = Js.parseDate("2026-10-11T09:30:00.000Z")
    private val note = Samples.note.copy(
        hanzi = "由", pinyin = "yóu", english = "from; by (the cause or agent)",
        funFacts = "**由** (yóu) from; by — marks who is responsible or where something starts.\n- 这件事由他负责。He is in charge of this.",
    )
    private val sentence = "它的作业由我写的。"
    private val opened = mutableListOf<Pair<String, String>>()

    private fun ui(type: String, take: TakeUi = TakeUi(), spoken: SpokenUi = SpokenUi(), start: CardStartState = CardStartState(flipped = true)): StudyUi {
        val state = CardScheduler.initialCardState()
        val card = QueueCard("c1", note.id, "d1", type, state)
        val view = CardView(card, note, Samples.sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3 · Words", true, start = start)
        return StudyUi(StudyPhase.Showing(view), Samples.counts, SessionStats(reviews = 14, correct = 12), canUndo = true, online = true, forcedOffline = false, extras = CardExtras(take = take, spoken = spoken))
    }

    private var plays = 0
    private val actions = StudyActions(onYouSaidCoach = { text, source -> opened += text to source }, onYouSaidPlay = { plays++ })

    private fun readTake(text: String) = TakeUi(hasTake = true, transcription = TranscriptionUi.Done(Transcription.compare(text, note.hanzi)))

    private fun count(tag: String) =
        compose.onAllNodes(androidx.compose.ui.test.hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().size

    @Test fun aReadCardsSentenceOpensInTheCoach() {
        compose.setContent { LabTheme { StudyScreen(ui(CardTypes.HANZI_TO_MEANING, take = readTake(sentence)), playingKey = null, actions = actions, autoplay = false) } }
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag("$YOU_SAID_TAG-contains", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(YOU_SAID_COACH_TAG, useUnmergedTree = true).assertContentDescriptionEquals(YOU_SAID_COACH_LABEL)
        compose.onNodeWithTag(YOU_SAID_COACH_TAG, useUnmergedTree = true).performClick()
        // As shown: a word card drops the recogniser's trailing 。 (AnswerKey.tidySpokenTranscript).
        assertEquals(listOf("它的作业由我写的" to "read"), opened)
        // ▶ plays the take it was transcribed from.
        compose.onNodeWithTag(YOU_SAID_PLAY_TAG, useUnmergedTree = true).performClick()
        assertEquals(1, plays)
    }

    @Test fun onlyTheOrangeBoxHasIt() {
        compose.setContent { LabTheme { StudyScreen(ui(CardTypes.HANZI_TO_MEANING, take = readTake("由")), playingKey = null, actions = actions, autoplay = false) } }
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(1, count("$YOU_SAID_TAG-match"))
        assertEquals(0, count(YOU_SAID_COACH_TAG))
        assertEquals(1, count(YOU_SAID_PLAY_TAG))
    }

    @Test fun aSpokenAnswerSaidInASentenceOpensInTheCoach() {
        val spoken = SpokenUi(result = SpokenResult(sentence, submit = true, seq = 1))
        compose.setContent { LabTheme { StudyScreen(ui(CardTypes.MEANING_TO_HANZI, spoken = spoken, start = CardStartState()), playingKey = null, actions = actions, autoplay = false) } }
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag(YOU_SAID_COACH_TAG, useUnmergedTree = true).performClick()
        assertEquals(listOf(sentence to "spoken"), opened)
    }

    @Test fun aSpokenAnswerComesBackFromTheCoachStillSpoken() {
        // Back from the coach the card starts from what it reported (StudyViewModel.onCardSpoken).
        val start = CardStartState(flipped = true, answer = sentence, spokenText = sentence, spokenReviewed = true)
        compose.setContent { LabTheme { StudyScreen(ui(CardTypes.MEANING_TO_HANZI, start = start), playingKey = null, actions = actions, autoplay = false) } }
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag("$SPOKEN_RESULT_TAG-contains", useUnmergedTree = true).assertIsDisplayed()
        assertEquals(1, count(SAY_AGAIN_TAG))
    }

    @Test fun theBoxsWords() {
        assertEquals("Match", youSaidVerdictLabel("match"))
        assertEquals("Contains the answer", youSaidVerdictLabel("contains"))
        assertEquals("Didn’t match", youSaidVerdictLabel("miss"))
        assertEquals("céng jīng。", tidyYouSaidPinyin("céng jīng 。"))
        assertEquals("shì", tidyYouSaidPinyin("shì"))
    }

    @Test fun theCoachRouteCarriesTheAction() {
        val route = Routes.coach(text = sentence, action = "check")
        assertTrue(route, route.startsWith("/coach?") && "action=check" in route && "text=" in route)
    }

    @Test fun shotReadCard() = shoot("study-yousaid-coach01-read", settleMs = 2_000) {
        StudyScreen(ui(CardTypes.HANZI_TO_MEANING, take = readTake(sentence)), playingKey = null, actions = StudyActions(), autoplay = false)
    }

    @Test fun shotReadCardDark() = shoot("study-yousaid-coach02-read-dark", dark = true, settleMs = 2_000) {
        StudyScreen(ui(CardTypes.HANZI_TO_MEANING, take = readTake(sentence)), playingKey = null, actions = StudyActions(), autoplay = false)
    }
}
