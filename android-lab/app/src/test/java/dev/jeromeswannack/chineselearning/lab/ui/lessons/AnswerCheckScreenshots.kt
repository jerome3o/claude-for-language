package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckAlternative
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckInput
import dev.jeromeswannack.chineselearning.lab.core.AnswerCheckTip
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.TranslateExercise
import dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckResult
import dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckUnavailable
import dev.jeromeswannack.chineselearning.lab.data.api.AskTurnDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.awaitCancellation
import org.junit.Test
import kotlin.random.Random
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * Claude's check of a lesson answer (AnswerCheckViews.kt) on Jerome's real answers: Checking…,
 * ✓ Correct with the idiomatic alternative, ~ Almost with the red-pen fix and quoted tips (the
 * suggested button ringed), offline (the self-assessment as before) and the 💬 sheet. Also proves
 * 🔁 Try again keeps the first try in the attempt data.
 */
class AnswerCheckScreenshots : LabScreenshotTest() {
    private val worry = TranslateExercise("Even if you don't remember these words, don't worry — just practise more.", "即使你不记得这些词，也别着急，多练习就好了。", "Jíshǐ nǐ bú jìde zhèxiē cí, yě bié zháojí, duō liànxí jiù hǎo le.")
    private val cheap = TranslateExercise("Even if it's cheap, I won't buy it.", "即使很便宜，我也不买。", "Jíshǐ hěn piányi, wǒ yě bù mǎi.")

    private val almost = AnswerCheck(
        verdict = "almost",
        headline = "The 即使…也 is right — make \"don't worry\" a command.",
        corrected = "即使你不记得这些词，也别着急，你就多练习吧。",
        correctedPinyin = "jíshǐ nǐ bú jìde zhèxiē cí, yě bié zháojí, nǐ jiù duō liànxí ba.",
        tips = listOf(
            AnswerCheckTip("也不着急 is a statement (\"you're also not anxious\"); a command needs 别 or 不要 → 也别着急.", "也不着急"),
            AnswerCheckTip("Bare 就多练习 sounds clipped — add a subject and 吧: 你就多练习吧.", "就多练习"),
        ),
        alternative = AnswerCheckAlternative("多练习就好了。", "duō liànxí jiù hǎo le.", "Just practise more and it'll be fine."),
        suggested = "missed_it",
    )
    private val correct = AnswerCheck(
        verdict = "correct",
        headline = "Correct and natural — 很 is optional here.",
        tips = listOf(AnswerCheckTip("很 is optional inside a 即使 clause; 即使再便宜 (\"however cheap\") is an idiomatic way to stress it.", "即使便宜")),
        alternative = AnswerCheckAlternative("即使再便宜，我也不买。", "jíshǐ zài piányi, wǒ yě bù mǎi.", "However cheap it is, I won't buy it."),
        suggested = "got_it",
    )

    private fun env(check: suspend (AnswerCheckInput) -> AnswerCheckResult) = ExerciseEnv(random = Random(7), answerCheck = check)

    private fun player(ex: TranslateExercise, env: ExerciseEnv, onDone: (ExerciseAnswer?) -> Unit = {}): @Composable () -> Unit = {
        LessonPlayer("即使…也 — even if", "🧱", LessonSamples.lesson(ex), env, PlayerContext.Homework, ItemScheduleSamples.previews, {}, {})
    }

    private fun answerWith(text: String) {
        val typeButtons = compose.onAllNodesWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.TYPE)
        if (typeButtons.fetchSemanticsNodes().isNotEmpty()) {
            typeButtons.onFirst().performClick()
            compose.mainClock.advanceTimeBy(300)
        }
        compose.onNode(hasSetTextAction()).performTextInput(text)
        compose.mainClock.advanceTimeBy(300)
        compose.onAllNodesWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.SUBMIT).onLast().performClick()
        compose.mainClock.advanceTimeBy(1_500)
    }

    private fun shootAnswered(name: String, ex: TranslateExercise, answer: String, env: ExerciseEnv, scrollTo: String? = null) {
        compose.setContent { LabTheme { player(ex, env)() } }
        compose.mainClock.advanceTimeBy(1_500)
        answerWith(answer)
        scrollTo?.let { runCatching { compose.onAllNodesWithText(it, substring = true).onFirst().performScrollTo() } }
        compose.mainClock.advanceTimeBy(1_000)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun checking() = shootAnswered("answer-check-01-checking", worry, "即使你不记得这些词，也不着急，就多练习。", env { awaitCancellation() })

    @Test fun almostWithFix() = shootAnswered("answer-check-02-almost", worry, "即使你不记得这些词，也不着急，就多练习。", env { AnswerCheckResult(almost, false) })

    @Test fun almostButtons() = shootAnswered("answer-check-03-almost-buttons", worry, "即使你不记得这些词，也不着急，就多练习。", env { AnswerCheckResult(almost, false) }, scrollTo = "Missed it")

    @Test fun correctAlternative() = shootAnswered("answer-check-04-correct", cheap, "即使便宜，我也不买。", env { AnswerCheckResult(correct, true) })

    @Test fun offline() = shootAnswered("answer-check-05-offline", cheap, "即使便宜，我也不买。", env { throw AnswerCheckUnavailable("offline", offline = true) })

    @Test fun askSheet() = shoot("answer-check-06-ask") {
        Column(Modifier.fillMaxSize().background(Lab.colors.card).padding(top = 24.dp)) {
            AskAboutAnswerContent(
                AnswerCheckInput(worry.english, worry.referenceHanzi, null, "即使你不记得这些词，也不着急，就多练习。", "translate", "spoken"),
                almost,
                listOf(
                    AskTurnDto("user", "Why 别 and not 不?"),
                    AskTurnDto("assistant", "别 makes it a command (\"don't…\"); 不 only describes. So 也别着急 tells them not to worry, while 也不着急 says they aren't worried."),
                ),
                busy = false, error = null, draft = "", onDraft = {}, onSend = {},
            )
        }
    }

    @Test fun tryAgainKeepsTheFirstTry() {
        var answer: ExerciseAnswer? = null
        var n = 0
        val e = env { i -> n++; AnswerCheckResult(if (i.answer.contains("和")) almost.copy(corrected = "医生让我吃药，好好休息。", tips = emptyList(), alternative = null) else correct.copy(alternative = null, tips = emptyList()), false) }
        val doctor = TranslateExercise("The doctor told me to take medicine and rest well.", "医生让我吃药，好好休息。")
        compose.setContent {
            LabTheme {
                Column { ExerciseView(doctor, e, null) { _, a, _ -> answer = a } }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
        answerWith("医生让我吃药和好好休息。")
        compose.onAllNodesWithText("🔁 Try again").onFirst().performClick()
        compose.mainClock.advanceTimeBy(500)
        answerWith("医生让我吃药，好好休息。")
        compose.onAllNodesWithText("✓ Got it").onLast().performClick()
        compose.mainClock.advanceTimeBy(500)
        val a = assertNotNull(answer)
        assertEquals(2, n)
        assertEquals("correct", a.check?.verdict)
        assertEquals(listOf("医生让我吃药和好好休息。"), a.tries?.map { it.text })
        assertEquals("almost", a.tries?.first()?.check?.verdict)
    }
}

private object ItemScheduleSamples {
    val previews = dev.jeromeswannack.chineselearning.lab.core.ItemSchedule.previews(dev.jeromeswannack.chineselearning.lab.core.RevisitState.INITIAL)
}
