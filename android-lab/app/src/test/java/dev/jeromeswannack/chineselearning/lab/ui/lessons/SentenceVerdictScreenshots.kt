package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.foundation.background
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.LessonWord
import dev.jeromeswannack.chineselearning.lab.core.SentenceFeedback
import dev.jeromeswannack.chineselearning.lab.core.SentenceFix
import dev.jeromeswannack.chineselearning.lab.core.SentenceMakingExercise
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.random.Random
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * sentence_making's honest grade (core SentenceCheck; docs/STUDY_SESSION.md "Sentence making: an honest verdict"):
 * Jerome's 本来…要 sentence is ≈ needs work (orange), not ✓; ✨ Show a fixed version on tap; 🎤 Try again → right.
 * The first grade is the one that counts.
 */
class SentenceVerdictScreenshots : LabScreenshotTest() {
    private val benlai = SentenceMakingExercise(
        words = listOf(LessonWord("本来", "běnlái", "originally"), LessonWord("要", "yào", "going to")),
        task = "Say what you were going to do — and what happened instead.",
        example = LessonSentence("我本来要买那件衣服，后来觉得太贵了。", "Wǒ běnlái yào mǎi nà jiàn yīfu, hòulái juéde tài guì le.", "I was going to buy that piece of clothing, but then I thought it was too expensive."),
    )
    private val said = "我本来要去健身馆，但是我学中文。"
    /** What the old check said, word for word: a ✓ over a correction — the guard makes it needs work. */
    private val oldCheck = SentenceFeedback(
        "correct", true, null,
        "Good use of 本来…要 to set up the original plan; but the second clause just states another plan rather than an actual interrupting event, so it should show what really happened, e.g. with 结果 or 可是…了. Also 健身馆 is usually 健身房.",
    )
    private val needsWork = SentenceFeedback(
        verdict = "minor", usesAllWords = true, comment = "", grade = "needs_work",
        headline = "本来…要 used right — the second half doesn’t follow",
        reason = "但是我学中文 states another plan; say what actually happened instead.",
        more = "健身馆 is usually 健身房.", fixable = true,
    )
    private val right = SentenceFeedback(verdict = "correct", usesAllWords = true, comment = "", grade = "right", headline = "Natural and correct", reason = "可是后来下雨了 says what got in the way.", fixable = false)
    private val fix = SentenceFix("我本来要去健身房，可是后来去学中文了。", "Wǒ běnlái yào qù jiànshēnfáng, kěshì hòulái qù xué Zhōngwén le.", "I was going to go to the gym, but then I went to study Chinese.")

    private fun screen(content: @Composable () -> Unit) {
        compose.setContent {
            LabTheme(dark = true) {
                Column(Modifier.fillMaxSize().background(Lab.colors.background).verticalScroll(rememberScrollState()).padding(16.dp)) { content() }
            }
        }
        compose.mainClock.advanceTimeBy(1_500)
    }

    @Test
    fun jeromesSentenceIsNeedsWorkThenIterates() {
        val checks = ArrayDeque(listOf(oldCheck, right))
        var fixes = 0
        val env = ExerciseEnv(
            random = Random(7),
            sentenceFeedback = { _, _, _, _ -> checks.removeFirst() },
            sentenceFix = { _, _, _, _ -> fixes++; fix },
        )
        var correct: Boolean? = null
        screen { ExerciseView(benlai, env, null) { c, _, _ -> correct = c } }
        val typeButtons = compose.onAllNodesWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.TYPE)
        if (typeButtons.fetchSemanticsNodes().isNotEmpty()) { typeButtons.onFirst().performClick(); compose.mainClock.advanceTimeBy(300) }
        compose.onNode(hasSetTextAction()).performTextInput(said)
        compose.mainClock.advanceTimeBy(300)
        compose.onAllNodesWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.SUBMIT).onLast().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        // ≈ needs work, the old ✓ never shown; the self-check line gone; the unrelated example folded.
        assertTrue(compose.onAllNodesWithText("≈ 本来 and 要 used right — one thing to fix").fetchSemanticsNodes().isNotEmpty())
        assertTrue(compose.onAllNodesWithText("Is your sentence grammatical", substring = true).fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodesWithTag(SentenceCheckTags.EXAMPLE_TOGGLE).fetchSemanticsNodes().isNotEmpty())
        // ✨ Show a fixed version — only on tap.
        assertEquals(0, fixes)
        compose.onAllNodesWithTag(SentenceCheckTags.SHOW_FIX).onFirst().performClick()
        compose.mainClock.advanceTimeBy(800)
        assertEquals(1, fixes)
        assertTrue(compose.onAllNodesWithTag(SentenceCheckTags.FIX).fetchSemanticsNodes().isNotEmpty())
        assertTrue(compose.onAllNodesWithTag(LessonFeedbackTags.sayAgain("fix")).fetchSemanticsNodes().isNotEmpty())
        // 🎤 Try again → right (practice only).
        compose.onAllNodesWithTag(SentenceCheckTags.TRY_AGAIN).onFirst().performClick()
        compose.mainClock.advanceTimeBy(500)
        val types = compose.onAllNodesWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.TYPE)
        if (types.fetchSemanticsNodes().isNotEmpty()) { types.onLast().performClick(); compose.mainClock.advanceTimeBy(300) }
        compose.onAllNodes(hasSetTextAction()).onLast().performTextInput("我本来要去健身房，可是后来下雨了。")
        compose.mainClock.advanceTimeBy(300)
        compose.onAllNodesWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.SUBMIT).onLast().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        assertTrue(compose.onAllNodesWithTag(SentenceCheckTags.RETRY_VERDICT).fetchSemanticsNodes().isNotEmpty())
        assertTrue(compose.onAllNodesWithTag(SentenceCheckTags.TRY_AGAIN).fetchSemanticsNodes().isEmpty())
        compose.onAllNodesWithText("Continue").onLast().performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(false, correct) // the first grade counts: needs work is not right first time
    }

    @Test fun needsWork() {
        screen { SentenceMakingView(benlai, ExerciseEnv(), { _, _ -> }, SentenceMakingPreview(said, source = "typed", feedback = needsWork)) }
        compose.onRoot().captureRoboImage("screenshots/sentence-verdict-01-needs-work-dark.png")
    }

    @Test fun fixShown() {
        screen {
            SentenceMakingView(benlai, ExerciseEnv(), { _, _ -> }, SentenceMakingPreview(said, source = "typed", feedback = needsWork, panel = SentenceCheckPreview(fix = SentenceFixState(said, "done", fix))))
        }
        compose.onRoot().captureRoboImage("screenshots/sentence-verdict-02-fix-dark.png")
    }

    @Test fun tryAgainRight() {
        screen {
            SentenceMakingView(
                benlai, ExerciseEnv(), { _, _ -> },
                SentenceMakingPreview(said, source = "typed", feedback = needsWork, panel = SentenceCheckPreview(retries = listOf(SentenceRetry("我本来要去健身房，可是后来下雨了。", "spoken", "done", right)))),
            )
        }
        compose.onRoot().captureRoboImage("screenshots/sentence-verdict-03-try-again-right-dark.png")
    }

    @Test fun pausedTakeReadAsOneUtterance() {
        val ex = SentenceMakingExercise(words = listOf(LessonWord("不知道", "bù zhīdào", "don't know"), LessonWord("有没有", "yǒu méiyǒu", "whether … has")), task = "Say something you don't know about a family member.")
        val fb = SentenceFeedback(verdict = "minor", usesAllWords = true, comment = "", grade = "needs_work", headline = "不知道 used right — 有没有 came out as 有不有", reason = "The yes-no question with 有 is 有没有, never 有不有.", fixable = true)
        screen { SentenceMakingView(ex, ExerciseEnv(), { _, _ -> }, SentenceMakingPreview("我不知道我妹妹有不有新电脑", feedback = fb)) }
        compose.onRoot().captureRoboImage("screenshots/sentence-verdict-04-paused-take-dark.png")
    }
}
