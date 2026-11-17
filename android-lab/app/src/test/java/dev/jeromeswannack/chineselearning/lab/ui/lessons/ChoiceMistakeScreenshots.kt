package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.ChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ChoiceMistake
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.data.api.AnswerCheckUnavailable
import dev.jeromeswannack.chineselearning.lab.data.api.ChoiceCorrectionReply
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import org.robolectric.annotation.Config
import kotlin.random.Random
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * "Which sentence is wrong?" choices (core ChoiceMistake): the wrong sentence is never spoken — the reveal shows it
 * struck and plays its correction (the spec's, else one fetched for an older lesson); offline with none, no ▶ for it.
 */
class ChoiceMistakeScreenshots : LabScreenshotTest() {
    private val wrong = "他了去北京。"
    private val fixed = LessonSentence("他去北京了。", "Tā qù Běijīng le.", "He went to Beijing.")
    private val base = ChoiceExercise(
        question = "Which sentence is wrong?",
        options = listOf(
            LessonSentence("我昨天买了一本书。", "Wǒ zuótiān mǎi le yì běn shū.", "I bought a book yesterday."),
            LessonSentence(wrong, english = "He went to Beijing."),
            LessonSentence("我吃了饭。", "Wǒ chī le fàn.", "I've eaten."),
        ),
        correct = 1,
        explanation = "了 goes after the verb or at the end, never before the verb.",
    )
    private val spoken = mutableListOf<String>()

    private fun env(correction: suspend (ChoiceMistake.Input) -> ChoiceCorrectionReply) =
        ExerciseEnv(random = Random(7), speak = { spoken += it }, playClip = { _, _, _ -> true }, choiceCorrection = correction)

    private fun player(ex: ChoiceExercise, env: ExerciseEnv): @Composable () -> Unit = {
        LessonPlayer("Where does 了 go?", "⚖️", CustomLessonSpec("Where does 了 go?", "⚖️", null, listOf(LessonSection(null, listOf(ex)))), env, PlayerContext.Lesson(), {}, {})
    }

    private fun pickWrongAndShoot(name: String, ex: ChoiceExercise, env: ExerciseEnv, dark: Boolean = true) {
        compose.setContent { LabTheme(dark = dark) { player(ex, env)() } }
        compose.mainClock.advanceTimeBy(1_500)
        val node = compose.onAllNodesWithText(wrong)[0]
        runCatching { node.performScrollTo() }
        node.performClick()
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Config(qualifiers = "w412dp-h1200dp-xxhdpi")
    @Test fun withCorrection() {
        pickWrongAndShoot("lessons-60-choice-wrong-correction", base.copy(correction = fixed), env { error("never asked") })
        assertEquals(listOf(fixed.hanzi), spoken, "the correction is spoken, never the mistake")
        compose.onNodeWithText("✓ Correct:").assertExists()
        compose.onNodeWithText("✗ This sentence has the mistake").assertExists()
    }

    @Config(qualifiers = "w412dp-h1200dp-xxhdpi")
    @Test fun olderLessonFetched() {
        pickWrongAndShoot("lessons-61-choice-wrong-fetched", base, env { ChoiceCorrectionReply(ChoiceMistake.Result(fixed, unchanged = false), cached = false) })
        assertEquals(listOf(fixed.hanzi), spoken)
    }

    @Config(qualifiers = "w412dp-h1200dp-xxhdpi")
    @Test fun olderLessonOffline() {
        pickWrongAndShoot("lessons-62-choice-wrong-offline", base, env { throw AnswerCheckUnavailable("offline", offline = true) })
        assertTrue(spoken.none { it == wrong }, "the mistake is never spoken")
        assertTrue(spoken.isEmpty())
        compose.onNodeWithText("The correct version needs a connection.").assertExists()
    }

    @Test fun ordinaryChoiceStillSpeaksThePick() {
        val ordinary = base.copy(question = "Your friend looks tired. What do you say?")
        pickWrongAndShoot("lessons-63-choice-ordinary", ordinary, env { error("never asked") }, dark = false)
        assertEquals(listOf(wrong), spoken)
    }
}
