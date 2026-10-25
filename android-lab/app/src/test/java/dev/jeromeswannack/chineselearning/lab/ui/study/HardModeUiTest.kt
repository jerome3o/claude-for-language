package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.HardMode
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.SentenceRound
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Test
import kotlin.test.assertEquals

/**
 * Hard mode (docs/STUDY_SESSION.md "Hard mode"; core HardMode): the question's own answer checked on the
 * question — wrong → Not quite + Try again / Show answer, right → "Next: harder questions" then the round;
 * Show answer before a right answer = a miss (Good / Easy locked); Red cards only leaves a new card alone;
 * the round's sentences outlined on top of the answer side; the header chip. Screenshots of each state.
 */
class HardModeUiTest : LabScreenshotTest() {
    private val note = Samples.note.copy(
        id = "n1", hanzi = "院子", pinyin = "yuànzi", english = "courtyard; yard",
        funFacts = "院 (yuàn) courtyard + 子 (zi) noun suffix.",
        sentenceClue = "孩子们在院子里玩。", sentenceCluePinyin = "Háizimen zài yuànzi li wán.", sentenceClueTranslation = "The children are playing in the yard.",
    )
    private val set = listOf(
        SentenceEntity("s1", "n1", 0, "我家有一个小院子。", "Wǒ jiā yǒu yí gè xiǎo yuànzi.", "My home has a small yard.", null, "core", null),
        SentenceEntity("s2", "n1", 1, "院子里种了很多花。", "Yuànzi li zhòngle hěn duō huā.", "Lots of flowers are planted in the yard.", null, "core", null),
        SentenceEntity("s3", "n1", 2, "奶奶每天早上在院子里打太极拳。", "Nǎinai měi tiān zǎoshang zài yuànzi li dǎ tàijíquán.", "Grandma does tai chi in the yard every morning.", null, "complex", null),
    )
    private val clueKey = clueRowKey("n1")
    private val prefs get() = StudyPrefs.get(ApplicationProvider.getApplicationContext())

    @After fun off() = prefs.setHardMode(HardMode.OFF)

    /** [learning]: a card rated before (red); else a new card. */
    private fun view(type: String = CardTypes.HANZI_TO_MEANING, learning: Boolean = true, sentences: List<SentenceEntity> = set): CardView {
        val now = Js.parseDate("2026-10-24T08:00:00.000Z")
        var state = CardScheduler.initialCardState()
        if (learning) state = CardScheduler.applyReview(state, 0, "2026-10-24T07:50:00.000Z")
        return CardView(QueueCard("c1", "n1", "d1", type, state), note, sentences, CardScheduler.intervalPreviews(state, now), emptyList(), 1, "HSK 3", true)
    }

    private fun ui(v: CardView, take: TakeUi = TakeUi()) =
        StudyUi(StudyPhase.Showing(v), Samples.counts, SessionStats(reviews = 5, correct = 4), canUndo = true, online = true, extras = CardExtras(take = take))

    private fun heard(text: String, match: Boolean) =
        TakeUi(hasTake = true, transcription = TranscriptionUi.Done(TranscriptionComparison(text, "", match, false)))

    private fun card(
        mode: String = HardMode.ALL,
        start: CardStartState = CardStartState(),
        take: TakeUi = TakeUi(),
        learning: Boolean = true,
        type: String = CardTypes.HANZI_TO_MEANING,
        sentences: List<SentenceEntity> = set,
        practise: SentencePractiseState = previewSentencePractise(),
        actions: StudyActions = StudyActions(),
        dark: Boolean = false,
    ) {
        prefs.setHardMode(mode)
        compose.setContent {
            LabTheme(dark = dark) {
                StudyScreen(ui(view(type, learning, sentences), take), playingKey = null, actions = actions, cardStart = start, autoplay = false, sentencePractisePreview = practise)
            }
        }
        compose.mainClock.advanceTimeBy(600)
    }

    private fun count(tag: String) = compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size

    @Test fun wrongOffersTryAgainAndShowAnswer() {
        var cleared = 0
        card(start = CardStartState(feedbackOpen = true), take = heard("圆子", match = false), actions = StudyActions(onClearRecording = { cleared++ }))
        compose.onNodeWithTag(HardModeTags.FEEDBACK, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("✗ Not quite", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("You said: 圆子", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(HardMode.MISS_NOTE, useUnmergedTree = true).assertExists()
        assertEquals(0, count(CARD_BACK_TAG))
        assertEquals(0, count(SentenceRoundTags.ROUND))
        compose.onNodeWithTag(HardModeTags.TRY_AGAIN, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(1, cleared)
        assertEquals(0, count(HardModeTags.FEEDBACK))
    }

    @Test fun showAnswerAfterAMissLocksGoodAndEasy() {
        val rated = mutableListOf<Int>()
        card(start = CardStartState(feedbackOpen = true), take = heard("圆子", match = false), actions = StudyActions(onRate = { r, _, _ -> rated += r }))
        compose.onNodeWithTag(HardModeTags.SHOW_ANSWER, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(0, count(SentenceRoundTags.ROUND))
        compose.onNodeWithText(HardMode.GAVE_UP_LINE, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("rating-good", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(emptyList(), rated)
        compose.onNodeWithText(HardMode.GAVE_UP_BLOCKED, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("rating-hard", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(listOf(1), rated)
    }

    @Test fun rightGoesOnToTheRound() {
        card(start = CardStartState(feedbackOpen = true), take = heard("院子", match = true))
        compose.onNodeWithText("✓ Right", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Next: harder questions →", useUnmergedTree = true).assertExists()
        compose.mainClock.advanceTimeBy(HardMode.RIGHT_BEAT_MS + 500)
        compose.onNodeWithTag(SentenceRoundTags.ROUND, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test fun redCardsOnlyLeavesANewCardAlone() {
        card(mode = HardMode.RED, learning = false)
        compose.onNodeWithText("Show answer", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag(CARD_BACK_TAG, useUnmergedTree = true).assertExists()
        assertEquals(0, count(HardModeTags.GAVE_UP))
        assertEquals(0, count(SentencePractiseTags.GATE))
    }

    @Test fun redCardsOnlyTakesALearningCard() {
        card(mode = HardMode.RED, learning = true)
        compose.onNodeWithText("Show answer", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithTag(HardModeTags.GAVE_UP, useUnmergedTree = true).assertExists()
    }

    @Test fun twoSentencesGiveARoundOfTwo() {
        card(start = CardStartState(roundOpen = true), sentences = set.take(1))
        val modes = (0 until 2).map { i -> listOf("read", "translate").first { m -> count("${SentenceRoundTags.EXERCISE}-$i-$m-open") > 0 } }
        assertEquals(listOf("read", "translate"), modes)
        assertEquals(0, count("${SentenceRoundTags.EXERCISE}-2-read-open") + count("${SentenceRoundTags.EXERCISE}-2-translate-open"))
        compose.onNodeWithText("Get any 2 of these 2 right", useUnmergedTree = true).assertExists()
    }

    @Test fun roundSentencesLeadTheAnswerSide() {
        val log = listOf(SentenceRound.LogEntry("read:$clueKey", "right"), SentenceRound.LogEntry("translate:s1", "wrong"), SentenceRound.LogEntry("read:s2"), SentenceRound.LogEntry("translate:s3"))
        card(start = CardStartState(flipped = true, roundLog = log, sentencesRight = listOf("read:$clueKey")), practise = previewSentencePractise(rightKeys = listOf("read:$clueKey")))
        compose.onNodeWithText("Example sentences").performScrollTo()
        compose.mainClock.advanceTimeBy(500)
        assertEquals(1, count("sentence-round-row-right"))
        assertEquals(1, count("sentence-round-row-wrong"))
        assertEquals(2, count("sentence-round-row-untried"))
        compose.onNodeWithText("In the round · ✓ Right", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("In the round · ✗ Not quite", useUnmergedTree = true).assertExists()
        // Opened: the English is up without a tap.
        compose.onNodeWithText("My home has a small yard.", useUnmergedTree = true).assertExists()
    }

    // ---- screenshots

    private fun shot(name: String) = compose.onRoot().captureRoboImage("screenshots/$name.png")

    @Test fun shotChipStates() = shoot("hard-mode-01-chip-states") {
        Column(Modifier.padding(16.dp)) {
            for (m in HardMode.MODES) Box(Modifier.padding(vertical = 6.dp)) { HardModeChip(m, onChange = {}) }
        }
    }

    @Test fun shotChipMenu() = shoot("hard-mode-02-chip-menu") {
        Box(Modifier.fillMaxSize().padding(16.dp), contentAlignment = Alignment.TopEnd) { HardModeChip(HardMode.RED, onChange = {}, startOpen = true) }
    }

    @Test fun shotWrong() {
        card(start = CardStartState(feedbackOpen = true), take = heard("圆子", match = false))
        shot("hard-mode-03-wrong-try-again")
    }

    @Test fun shotRight() {
        card(start = CardStartState(feedbackOpen = true), take = heard("院子", match = true))
        shot("hard-mode-04-right-next")
    }

    @Test fun shotRoundOfTwo() {
        card(start = CardStartState(roundOpen = true), sentences = set.take(1))
        shot("hard-mode-05-round-of-two")
    }

    @Test fun shotGaveUp() {
        card(start = CardStartState(flipped = true, gaveUp = true))
        shot("hard-mode-06-gave-up")
    }

    @Test fun shotAnswerSideRound() {
        val log = listOf(SentenceRound.LogEntry("read:$clueKey", "right"), SentenceRound.LogEntry("translate:s1", "wrong"), SentenceRound.LogEntry("read:s2"), SentenceRound.LogEntry("translate:s3"))
        card(start = CardStartState(flipped = true, roundLog = log, sentencesRight = listOf("read:$clueKey")), practise = previewSentencePractise(rightKeys = listOf("read:$clueKey")))
        compose.onNodeWithText("Example sentences").performScrollTo()
        compose.mainClock.advanceTimeBy(800)
        shot("hard-mode-07-answer-round-sentences")
    }
}
