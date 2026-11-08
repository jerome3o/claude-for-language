package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckAlternative
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckInput
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckTip
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.HardMode
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.RetryBars
import dev.jeromeswannack.chineselearning.lab.core.SentenceAnswerCheck
import dev.jeromeswannack.chineselearning.lab.data.SentenceEntity
import dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckResult
import dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckUnavailable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.CompletableDeferred
import org.junit.Test
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import kotlin.test.assertEquals

/**
 * Sentence answers checked by Claude (docs/STUDY_SESSION.md; core SentenceAnswerCheck; web
 * SentenceAnswerCheck.test.tsx): Jerome's homework card — Hard mode, "Second angle · English → Chinese",
 * answer 我早上喝咖啡是为了上班不困。, said 我早上喝咖啡，因为工作不困。. Checked by Claude ON THE QUESTION:
 * almost → ≈ Nearly with the fix, tips and an alternative, 🔁 Try again keeps the question and the new answer
 * is checked afresh; acceptable → right (held with You said vs the card, Got it suggested, no give-up); no check
 * → the device's ✗ Not quite. Screenshots: sentence-check-*.png.
 */
class SentenceAnswerCheckUiTest : LabScreenshotTest() {
    private val model = "我早上喝咖啡是为了上班不困。"
    private val said = "我早上喝咖啡，因为工作不困。"
    private val note = Samples.note.copy(
        id = "n1", hanzi = model, pinyin = "Wǒ zǎoshang hē kāfēi shì wèile shàngbān bú kùn.",
        english = "I drink coffee in the morning so I'm not sleepy at work.",
        funFacts = "是为了 (shì wèile) = in order to — the purpose comes after it.",
        sentenceClue = null, sentenceCluePinyin = null, sentenceClueTranslation = null,
    )
    private val sentences = listOf(
        SentenceEntity("s1", "n1", 0, "我学中文是为了跟朋友聊天。", "Wǒ xué Zhōngwén shì wèile gēn péngyou liáotiān.", "I learn Chinese so I can chat with friends.", null, "core", null),
        SentenceEntity("s2", "n1", 1, "他早起是为了锻炼身体。", "Tā zǎoqǐ shì wèile duànliàn shēntǐ.", "He gets up early to exercise.", null, "core", null),
    )
    private val almost = AnswerCheck(
        verdict = "almost",
        headline = "Clear meaning — but 因为 gives a reason, not a purpose.",
        corrected = "我早上喝咖啡，是为了上班不困。",
        correctedPinyin = "Wǒ zǎoshang hē kāfēi, shì wèile shàngbān bú kùn.",
        tips = listOf(
            AnswerCheckTip("Use 是为了 for “so that / in order to” — 因为 means “because”.", quote = "因为"),
            AnswerCheckTip("上班 is “being at work”; 工作 is the job itself.", quote = "工作"),
        ),
        alternative = AnswerCheckAlternative("我早上喝咖啡，这样上班就不困了。", "Wǒ zǎoshang hē kāfēi, zhèyàng shàngbān jiù bú kùn le.", "I drink coffee in the morning, so I'm not sleepy at work."),
        suggested = "missed_it",
    )
    private val acceptable = AnswerCheck(
        verdict = "acceptable",
        headline = "Natural and right — 为了 says the purpose just as well.",
        corrected = "", correctedPinyin = "", tips = emptyList(), suggested = "got_it",
    )

    private fun view(): CardView {
        val state = CardScheduler.initialCardState()
        return CardView(QueueCard("c1", "n1", "d1", CardTypes.MEANING_TO_HANZI, state), note, sentences, CardScheduler.intervalPreviews(state, 0L), emptyList(), 1, "语法句型 · 怎么…了等")
    }

    private fun pass() = PassCardUi(
        assignmentId = "a1", noteId = "n1", attempt = 0, title = "语法句型 · 怎么…了等", part = null,
        due = Homework.dueLabel("2026-11-08", "2026-11-06"), done = 4, total = 12, retrying = 1, canUndo = true,
        bar = RetryBars.retryBar(answered = 7, fresh = 14, retries = 1, itemsDone = 4, items = 12),
        cardType = CardTypes.MEANING_TO_HANZI, angle = 2, hardMode = HardMode.ALL, hardApplies = true,
    )

    private val asked = mutableListOf<AnswerCheckInput>()
    private val passAnswers = mutableListOf<Pair<Boolean, String?>>()

    private fun card(online: Boolean = true, dark: Boolean = false, reply: suspend (AnswerCheckInput) -> AnswerCheckResult) {
        val actions = StudyActions(
            answerCheck = { input -> asked += input; reply(input) },
            onPassAnswer = { right, _, suggested, _ -> passAnswers += right to suggested },
        )
        compose.setContent {
            LabTheme(dark = dark) {
                StudyScreen(
                    StudyUi(StudyPhase.Showing(view()), QueueCounts(0, 0, 0, 0), online = online),
                    playingKey = null, actions = actions,
                    cardStart = CardStartState(feedbackOpen = true, answer = said, spokenText = said),
                    autoplay = false, pass = pass(),
                )
            }
        }
        compose.mainClock.advanceTimeBy(800)
    }

    private fun count(tag: String) = compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size

    @Test fun checkingThenAlmostShowsTheAdviceOnTheQuestionAndTryAgainChecksTheNewAnswer() {
        val first = CompletableDeferred<AnswerCheckResult>()
        val replies = ArrayDeque(listOf(
            suspend { first.await() },
            suspend { AnswerCheckResult(acceptable.copy(verdict = "correct", headline = "Spot on."), cached = false) },
        ))
        card { replies.removeFirst()() }
        // No waiting: the card's answer (hanzi, pinyin, English) and "You said" against it at once, a slim
        // "Checking your sentence…" row under them — never a spinner in their place.
        compose.onNodeWithTag(HardModeTags.ANSWER_FIRST, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(SentenceAnswerCheck.ANSWER.uppercase(), useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(DifferenceTags.MODEL, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(note.pinyin!!, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(DifferenceTags.MODEL_ENGLISH, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(DifferenceTags.SAID, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(HardModeTags.SENTENCE_CHECKING, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(SentenceAnswerCheck.CHECKING, useUnmergedTree = true).assertExists()
        assertEquals(0, count(HardModeTags.TRY_AGAIN))
        // 🎤 Read it again from the start, under "You said".
        compose.onNodeWithTag(ReadAgainTags.MIC, useUnmergedTree = true).assertExists()
        assertEquals(1, asked.size)
        assertEquals("translate", asked[0].exerciseType)
        assertEquals("spoken", asked[0].input)
        assertEquals(said, asked[0].answer)
        assertEquals(model, asked[0].modelAnswer)
        assertEquals(note.english, asked[0].promptEn)
        first.complete(AnswerCheckResult(almost, cached = false))
        compose.mainClock.advanceTimeBy(800)
        // ≈ Nearly on the question: the check, the fix, the tips, the alternative; never the card's back.
        compose.onNodeWithTag(HardModeTags.SENTENCE_CHECK, useUnmergedTree = true).assertExists()
        compose.onNodeWithText("~ Almost", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(almost.headline, useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Also natural: ", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(SentenceAnswerCheck.MOVE_ON_NOTE, useUnmergedTree = true).assertExists()
        // The card's answer stays THE answer; Claude's fix (the card's sentence again) isn't shown as a second answer.
        compose.onNodeWithTag(DifferenceTags.MODEL, useUnmergedTree = true).assertExists()
        assertEquals(0, count(HardModeTags.SENTENCE_YOUR_FIX))
        assertEquals(0, count(HardModeTags.SENTENCE_CHECKING))
        // A miss: still there to read the answer aloud (practice only).
        compose.onNodeWithTag(ReadAgainTags.BLOCK, useUnmergedTree = true).assertExists()
        assertEquals(0, count(CARD_BACK_TAG))
        compose.onNodeWithTag(HardModeTags.TYPE_INSTEAD, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(HardModeTags.SHOW_ANSWER, useUnmergedTree = true).assertExists()
        // 🔁 Try again: still the question; a new answer (typed here) replaces the old one and is checked afresh.
        compose.onNodeWithTag(HardModeTags.TRY_AGAIN, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(400)
        assertEquals(0, count(HardModeTags.FEEDBACK))
        assertEquals(0, count(CARD_BACK_TAG))
        compose.onNode(hasSetTextAction()).performTextInput("我早上喝咖啡是为了工作不困。")
        compose.onNodeWithText("Check", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(800)
        assertEquals(2, asked.size)
        assertEquals("我早上喝咖啡是为了工作不困。", asked[1].answer)
        assertEquals("typed", asked[1].input)
        compose.onNodeWithText("✓ Correct", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(HardModeTags.NEXT, useUnmergedTree = true).assertExists()
        assertEquals(0, count(HardModeTags.TRY_AGAIN))
    }

    @Test fun acceptableCountsAsRightAndGotItIsSuggested() {
        card { AnswerCheckResult(acceptable, cached = true) }
        compose.onNodeWithText("✓ Also right", useUnmergedTree = true).assertExists()
        // Right per Claude: no reading-again practice.
        assertEquals(0, count(ReadAgainTags.BLOCK))
        // Held (right but other words): You said vs the card, then Next — never Try again, never a give-up.
        compose.onNodeWithTag(DifferenceTags.SAID, useUnmergedTree = true).assertExists()
        assertEquals(0, count(HardModeTags.TRY_AGAIN))
        compose.onNodeWithTag(HardModeTags.NEXT, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(800)
        compose.onNodeWithTag(SentenceRoundTags.ROUND, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(SentenceRoundTags.SKIP, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(300)
        compose.onNodeWithText(dev.jeromeswannack.chineselearning.lab.core.SentenceRound.SKIP_CONFIRM_YES).performClick()
        compose.mainClock.advanceTimeBy(1_000)
        // The answer side: no "you looked" line, Claude's verdict kept, Got it suggested.
        compose.onNodeWithText(dev.jeromeswannack.chineselearning.lab.core.PassAngles.GAVE_UP_LINE, useUnmergedTree = true).assertDoesNotExist()
        assertEquals(1, count(SENTENCE_CHECK_BACK_TAG))
        compose.onNodeWithText("✓ suggested", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Got it", useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals<List<Pair<Boolean, String?>>>(listOf(true to "right"), passAnswers)
        assertEquals(1, asked.size)
    }

    @Test fun noCheckToBeHadIsTheDevicesVerdict() {
        val fail: suspend (AnswerCheckInput) -> AnswerCheckResult = { throw AnswerCheckUnavailable("HTTP 502") }
        card(reply = fail)
        compose.onNodeWithText("✗ Not quite", useUnmergedTree = true).assertExists()
        // The answer and the diff stay.
        compose.onNodeWithTag(DifferenceTags.MODEL, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(DifferenceTags.SAID, useUnmergedTree = true).assertExists()
        assertEquals(0, count(HardModeTags.SENTENCE_CHECK))
        assertEquals(0, count(HardModeTags.TYPE_INSTEAD))
    }

    @Test fun aFixOfHisOwnWordingIsASmallLabelledLine() {
        val fix = "我早上喝咖啡，所以上班不困。"
        card { AnswerCheckResult(almost.copy(corrected = fix), cached = false) }
        compose.onNodeWithTag(HardModeTags.SENTENCE_YOUR_FIX, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(SentenceAnswerCheck.YOUR_FIX, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(DifferenceTags.MODEL, useUnmergedTree = true).assertExists()
    }

    @Test fun movingOnFromAMissGoesStraightOnAsAGiveUp() {
        card { AnswerCheckResult(almost, cached = false) }
        compose.onNodeWithTag(HardModeTags.SHOW_ANSWER, useUnmergedTree = true).performClick()
        compose.mainClock.advanceTimeBy(800)
        // Straight to the round (the answer was on screen already) — no second "The answer" panel.
        assertEquals(0, count(HardModeTags.REVEALED_ANSWER))
        compose.onNodeWithTag(SentenceRoundTags.ROUND, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test fun offlineNeverAsks() {
        card(online = false) { AnswerCheckResult(almost, cached = false) }
        compose.onNodeWithText("✗ Not quite", useUnmergedTree = true).assertExists()
        assertEquals(0, asked.size)
    }

    @Test fun shotCheckingLight() {
        card { CompletableDeferred<AnswerCheckResult>().await() }
        compose.mainClock.advanceTimeBy(600)
        compose.onRoot().captureRoboImage("screenshots/sentence-check-00-checking-light.png")
    }

    /** The answer-first panel with a read-again take judged right (drawn from its state: no microphone). */
    @Test fun shotReadAgainUnderTheAnswer() {
        compose.setContent {
            LabTheme {
                androidx.compose.foundation.layout.Box(
                    androidx.compose.ui.Modifier.fillMaxSize().padding(16.dp),
                    contentAlignment = androidx.compose.ui.Alignment.BottomCenter,
                ) {
                    HardModeFeedbackPanel(
                        result = "close", said = said, spoken = true, roundFollows = true,
                        onTryAgain = {}, onShowAnswer = {}, onNext = {},
                        answer = Triple(model, note.pinyin, note.english), onPlayAnswer = {},
                        check = almost, onPlay = {},
                        sentenceView = SentenceAnswerCheck.view(true, false, "almost", said, model, almost.corrected),
                        onMoveOn = {}, moveOnLabel = HardMode.revealedNextLabel(true),
                        readAgainPreview = {
                            ReadAgainContent(
                                dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi(), ReadAgainTake(model, "right", dev.jeromeswannack.chineselearning.lab.core.AnswerKey.Verdict.EXACT),
                                1, model, onMic = {}, onRetry = {},
                            )
                        },
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithTag("${ReadAgainTags.RESULT}-right", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(HardMode.READ_AGAIN_PRACTICE, useUnmergedTree = true).assertExists()
        compose.onRoot().captureRoboImage("screenshots/sentence-check-04-read-again-light.png")
    }

    @Test fun shotAlmostDark() {
        card(dark = true) { AnswerCheckResult(almost, cached = false) }
        compose.mainClock.advanceTimeBy(1_500)
        compose.onRoot().captureRoboImage("screenshots/sentence-check-01-almost-dark.png")
    }

    @Test fun shotAcceptableDark() {
        card(dark = true) { AnswerCheckResult(acceptable, cached = false) }
        compose.mainClock.advanceTimeBy(1_500)
        compose.onRoot().captureRoboImage("screenshots/sentence-check-02-acceptable-right-dark.png")
    }

    @Test fun shotAlmostLight() {
        card { AnswerCheckResult(almost, cached = false) }
        compose.mainClock.advanceTimeBy(1_500)
        compose.onRoot().captureRoboImage("screenshots/sentence-check-03-almost-light.png")
    }
}
