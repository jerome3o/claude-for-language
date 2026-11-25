package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.TranslateExercise
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test

/**
 * ↺ Undo in the lesson player (`./gradlew :app:recordRoborazziDebug` → app/screenshots/lesson-undo-*.png):
 * the next exercise after a "✓ Got it" by mistake, with ↺ in the top bar; after ↺ the translation is back on
 * its answer side (Got it / Missed it again).
 */
class LessonUndoScreenshots : LabScreenshotTest() {
    private val title = "综合练习：有点儿 · 一点儿 · 把…弄… · V不…"
    private val sugar = TranslateExercise("I put a little sugar in the coffee.", "我在咖啡里放了一点儿糖。", "Wǒ zài kāfēi lǐ fàng le yìdiǎnr táng.")
    private val spec = CustomLessonSpec(title, sections = listOf(LessonSection(exercises = listOf(sugar, LessonSamples.choice, LessonSamples.translate))))

    private fun play(name: String, dark: Boolean, undo: Boolean) {
        compose.setContent {
            LabTheme(dark = dark) {
                LessonPlayer(title, "🧩", spec, ExerciseEnv(random = kotlin.random.Random(1)), PlayerContext.Homework, onComplete = {}, onEnd = {})
            }
        }
        compose.onNodeWithText("Show answer").performClick()
        compose.onNodeWithText("✓ Got it").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        if (undo) {
            compose.onNodeWithTag(LESSON_UNDO_TAG).performClick()
            compose.mainClock.advanceTimeBy(1_000)
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun nextExercise() = play("lesson-undo-01-undo-ready", dark = false, undo = false)
    @Test fun backOnTheAnswer() = play("lesson-undo-02-after-undo", dark = false, undo = true)
    @Test fun backOnTheAnswerDark() = play("lesson-undo-03-after-undo-dark", dark = true, undo = true)
}
