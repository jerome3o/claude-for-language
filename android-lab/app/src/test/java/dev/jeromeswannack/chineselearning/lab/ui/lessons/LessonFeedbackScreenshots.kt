package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheck
import dev.jeromeswannack.chineselearning.lab.core.CoachPractise
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.HardMode
import dev.jeromeswannack.chineselearning.lab.core.LessonFeedback
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.LessonWord
import dev.jeromeswannack.chineselearning.lab.core.SentenceFeedback
import dev.jeromeswannack.chineselearning.lab.core.SentenceMakingExercise
import dev.jeromeswannack.chineselearning.lab.core.TranslateExercise
import dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckResult
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.coach.PractiseUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.CompletableDeferred
import org.junit.Test
import kotlin.random.Random
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The answer screen's feedback (core LessonFeedback; Jerome's own examples): the model answer + his marked
 * answer at once with "Claude is checking…" BELOW the buttons, the verdict landing there without moving the
 * answer, an exact match felt once, 🎤 Say it again's result row, and sentence making's Claude fix with its
 * own practice row.
 */
class LessonFeedbackScreenshots : LabScreenshotTest() {
    private val brother = TranslateExercise(
        "How come your brother suddenly went back to London?", "你哥哥怎么突然回伦敦了？", "Nǐ gēge zěnme tūrán huí Lúndūn le?",
    )
    private val almost = AnswerCheck(
        verdict = "almost",
        headline = "Nearly — 了 marks the change: he has gone back.",
        corrected = "你哥哥怎么突然回伦敦了？",
        correctedPinyin = "nǐ gēge zěnme tūrán huí Lúndūn le?",
        suggested = "missed_it",
    )
    private val job = SentenceMakingExercise(
        words = listOf(LessonWord("怎么", "zěnme", "how come"), LessonWord("了", "le", "(change)")),
        task = "Structure ① — a friend has suddenly changed something (job, hair, city). Ask why, surprised.",
        example = LessonSentence("你怎么换工作了？", "Nǐ zěnme huàn gōngzuò le?", "How come you changed jobs?"),
    )

    private fun answerWith(text: String) {
        val typeButtons = compose.onAllNodesWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.TYPE)
        if (typeButtons.fetchSemanticsNodes().isNotEmpty()) {
            typeButtons.onFirst().performClick()
            compose.mainClock.advanceTimeBy(300)
        }
        compose.onNode(hasSetTextAction()).performTextInput(text)
        compose.mainClock.advanceTimeBy(300)
        compose.onAllNodesWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.SUBMIT).onLast().performClick()
        compose.mainClock.advanceTimeBy(400)
    }

    private fun exercise(content: @Composable () -> Unit) {
        compose.setContent { LabTheme { Column(Modifier.fillMaxWidth().padding(16.dp)) { content() } } }
        compose.mainClock.advanceTimeBy(800)
    }

    private fun top(text: String): Float =
        compose.onAllNodesWithText(text, substring = true).onFirst().fetchSemanticsNode().boundsInRoot.top

    @Test
    fun claudeLandsBelowWithoutMovingTheAnswer() {
        val reply = CompletableDeferred<AnswerCheckResult>()
        val env = ExerciseEnv(random = Random(7), answerCheck = { reply.await() })
        exercise { ExerciseView(brother, env, null) { _, _, _ -> } }
        answerWith("你哥哥怎么突然回伦敦？")
        compose.onAllNodesWithText(LessonFeedback.CLAUDE_CHECKING_LINE, substring = true).onFirst().assertExists()
        compose.onAllNodesWithTag("lesson-marked-answer").onFirst().assertExists()
        val refBefore = top("你哥哥怎么突然回伦敦了？ 🔊")
        val buttonsBefore = top("Missed it")
        compose.onRoot().captureRoboImage("screenshots/lesson-feedback-01-checking.png")
        reply.complete(AnswerCheckResult(almost, false))
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(refBefore, top("你哥哥怎么突然回伦敦了？ 🔊"))
        assertEquals(buttonsBefore, top("Missed it"))
        runCatching { compose.onAllNodesWithText(almost.headline, substring = true).onFirst().performScrollTo() }
        compose.mainClock.advanceTimeBy(500)
        compose.onRoot().captureRoboImage("screenshots/lesson-feedback-02-verdict-landed.png")
    }

    @Test
    fun exactMatchIsFeltOnce() {
        val feels = mutableListOf<String>()
        var answer: ExerciseAnswer? = null
        val env = ExerciseEnv(random = Random(7), feel = { feels += it })
        exercise { ExerciseView(brother, env, null) { _, a, _ -> answer = a } }
        answerWith("你哥哥怎么突然回伦敦了？")
        compose.mainClock.advanceTimeBy(1_000)
        assertEquals(listOf(HardMode.FEEL_SUCCESS), feels)
        compose.onAllNodesWithTag(LessonFeedbackTags.BURST).onFirst().assertExists()
        compose.onAllNodesWithTag(LessonFeedbackTags.sayAgain("answer")).onFirst().assertExists()
        compose.onRoot().captureRoboImage("screenshots/lesson-feedback-03-exact-felt.png")
        assertEquals(null, answer)
    }

    @Test
    fun sayItAgainResult() = shoot("lesson-feedback-04-say-again") {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Reference(LessonSentence(brother.referenceHanzi, brother.referencePinyin), ExerciseEnv())
            SayItAgainRow(brother.referenceHanzi, "translate", "answer", ExerciseEnv(), preview = PractiseUi(result = CoachPractise.practise("你哥哥怎么突然回伦敦了", brother.referenceHanzi)))
            SayItAgainRow(brother.referenceHanzi, "translate", "answer", ExerciseEnv(), preview = PractiseUi(result = CoachPractise.practise("你哥哥怎么突然回轮蹲了", brother.referenceHanzi)))
        }
    }

    @Test
    fun sentenceMakingFixGetsItsOwnPractice() {
        val env = ExerciseEnv(random = Random(7), sentenceFeedback = { _, _, _ ->
            SentenceFeedback("minor", true, LessonSentence("你怎么换工作了？", "Nǐ zěnme huàn gōngzuò le?", "How come you changed jobs?"), "变 is for things that change by themselves; you change a job: 换工作.")
        })
        var correct: Boolean? = null
        exercise { ExerciseView(job, env, null) { c, _, _ -> correct = c } }
        answerWith("你怎么变工作了？")
        compose.mainClock.advanceTimeBy(1_000)
        // The example equals Claude's fix here, so one practice row (the example) — no duplicate.
        assertTrue(compose.onAllNodesWithTag(LessonFeedbackTags.sayAgain("example")).fetchSemanticsNodes().isNotEmpty())
        assertTrue(compose.onAllNodesWithTag(LessonFeedbackTags.sayAgain("fix")).fetchSemanticsNodes().isEmpty())
        runCatching { compose.onAllNodesWithText("Almost", substring = true).onFirst().performScrollTo() }
        compose.mainClock.advanceTimeBy(500)
        compose.onRoot().captureRoboImage("screenshots/lesson-feedback-05-sentence-making.png")
        compose.onAllNodesWithText("Continue").onLast().performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(true, correct)
    }
}
