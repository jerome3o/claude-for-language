package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.GapChoiceExercise
import dev.jeromeswannack.chineselearning.lab.core.ItemAnswer
import dev.jeromeswannack.chineselearning.lab.core.JudgeExercise
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.LessonExercise
import dev.jeromeswannack.chineselearning.lab.core.LessonJson
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptDetailDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import org.robolectric.annotation.Config
import kotlin.random.Random
import kotlin.test.assertEquals

/** Judge each sentence / Choose the word: unanswered, answered + checked (with a miss), dark, and the attempt review. */
class JudgeGapScreenshots : LabScreenshotTest() {
    private val env = ExerciseEnv(random = Random(7), playClip = { _, _, _ -> true })

    private fun sampleExercise(id: String, index: Int = 0): LessonExercise {
        val spec = LessonJson.decodeFromJsonElement(CustomLessonSpec.serializer(), LessonCatalogue.sample(id)!!.spec)
        return spec.sections[0].exercises[index]
    }
    private val judge get() = sampleExercise("judge") as JudgeExercise
    private val gap get() = sampleExercise("gap_choice") as GapChoiceExercise
    private val ownWords get() = sampleExercise("gap_choice", 1) as GapChoiceExercise

    private fun player(ex: LessonExercise): @Composable () -> Unit = {
        LessonPlayer("Where does 了 go?", "⚖️", CustomLessonSpec("Where does 了 go?", "⚖️", null, listOf(LessonSection(null, listOf(ex)))), env, PlayerContext.Lesson(), {}, {})
    }

    private fun shootAfter(name: String, dark: Boolean = false, content: @Composable () -> Unit, act: () -> Unit) {
        compose.setContent { LabTheme(dark = dark) { content() } }
        compose.mainClock.advanceTimeBy(1_500)
        act()
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    /** Taps the [n]-th (0-based) node with [text]. */
    private fun tap(text: String, n: Int = 0) {
        val node = compose.onAllNodesWithText(text)[n]
        runCatching { node.performScrollTo() }
        node.performClick()
        compose.mainClock.advanceTimeBy(300)
    }

    /** Sample: right, wrong, right, wrong, right — #4 judged wrongly as correct. */
    private fun judgeAll() {
        // Each row has one "✓ Correct" and one "✗ Incorrect": the n-th of each is row n.
        listOf(true, false, true, true, true).forEachIndexed { i, right -> tap(if (right) "✓ Correct" else "✗ Incorrect", i) }
    }

    @Test fun judgeQuestion() = shoot("lessons-50-judge") { player(judge)() }

    @Config(qualifiers = "w412dp-h1900dp-xxhdpi")
    @Test fun judgeChecked() = shootAfter("lessons-51-judge-checked", content = player(judge)) {
        judgeAll()
        tap("Check")
    }

    @Config(qualifiers = "w412dp-h1900dp-xxhdpi")
    @Test fun judgeCheckedDark() = shootAfter("lessons-52-judge-checked-dark", dark = true, content = player(judge)) {
        judgeAll()
        tap("Check")
    }

    @Test fun gapQuestion() = shoot("lessons-53-gap-choice") { player(gap)() }

    @Config(qualifiers = "w412dp-h1900dp-xxhdpi")
    @Test fun gapChecked() = shootAfter("lessons-54-gap-choice-checked", content = player(gap)) {
        // Sample answers: 刚才, 刚, 刚才, 刚 — #3 picked wrong (刚).
        tap("刚才", 0); tap("刚", 1); tap("刚", 2); tap("刚", 3)
        tap("Check")
    }

    @Config(qualifiers = "w412dp-h1400dp-xxhdpi")
    @Test fun gapOwnWordsChecked() = shootAfter("lessons-55-gap-choice-own-words-checked", content = player(ownWords)) {
        tap("再"); tap("的")
        tap("Check")
    }

    @Test fun reportsEachSentence() {
        var got: ExerciseAnswer? = null
        var verdict: Boolean? = null
        compose.setContent { LabTheme { Column { JudgeView(judge, env) { c, a -> verdict = c; got = a } } } }
        compose.mainClock.advanceTimeBy(500)
        judgeAll()
        tap("Check")
        tap("Continue")
        assertEquals(false, verdict)
        assertEquals(listOf(true, true, true, false, true), got?.items?.map { it.correct })
        assertEquals(listOf(true, false, true, true, true), got?.items?.map { it.judged })
    }

    @Composable private fun Column(content: @Composable () -> Unit) = androidx.compose.foundation.layout.Column { content() }

    @Config(qualifiers = "w412dp-h1600dp-xxhdpi")
    @Test fun attemptReview() {
        val spec = CustomLessonSpec("Where does 了 go?", "⚖️", null, listOf(LessonSection(null, listOf(judge, gap))))
        val data = LessonAttemptData(
            "2026-10-23T09:00:00.000Z", 95_000,
            listOf(
                ExerciseAttempt(0, 0, "judge", false, 4, 5, 50_000, ExerciseAnswer(items = listOf(true, false, true, true, true).mapIndexed { i, j -> ItemAnswer(judged = j, correct = i != 3) })),
                ExerciseAttempt(0, 1, "gap_choice", false, 3, 4, 45_000, ExerciseAnswer(items = listOf("刚才", "刚", "刚", "刚").mapIndexed { i, p -> ItemAnswer(pick = p, correct = i != 2) })),
            ),
        )
        val detail = AttemptDetailDto("a1", "L1", "2026-10-23T09:01:35.000Z", 95_000, 7, 9, null, spec, data)
        shoot("lessons-56-judge-gap-attempt-review") { AttemptDetailScreen(Loadable(data = detail, loading = false), onBack = {}, onRetry = {}, onPlay = {}, playingKey = null) }
    }
}
