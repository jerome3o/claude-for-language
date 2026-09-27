package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.DictationExercise
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAnswer
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.HandwritingAnswer
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.LessonJson
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.LessonSentence
import dev.jeromeswannack.chineselearning.lab.core.StrokeGeometry
import dev.jeromeswannack.chineselearning.lab.core.WriteHandwritingExercise
import dev.jeromeswannack.chineselearning.lab.core.WritingInput
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.AttemptSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.editor.LessonPreviewPane
import dev.jeromeswannack.chineselearning.lab.ui.editor.LessonTrialScreen
import dev.jeromeswannack.chineselearning.lab.ui.strokes.TestStrokes
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonArray
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Test
import org.robolectric.annotation.Config
import kotlin.random.Random

/**
 * Package K: the real lesson player in Try it / catalogue trials / the editor's Preview, and the
 * tutor's review of a student's lesson answers with handwriting re-drawn stroke by stroke.
 */
class LessonReviewScreenshots : LabScreenshotTest() {
    private val env = ExerciseEnv(random = Random(7), strokeLoader = TestStrokes.loader)
    private fun json(spec: CustomLessonSpec): JsonObject = LessonJson.encodeToJsonElement(CustomLessonSpec.serializer(), spec).jsonObject

    // ---- Try it / catalogue trial / editor Preview: the real player, nothing recorded ----

    @Test fun tryIt() = shoot("k-lessons-01-try-it") {
        LessonTrialScreen("The 把 sentence", json(LessonSamples.full), null, env, onBack = {}, onFinished = {})
    }

    @Test fun tryItFinished() {
        compose.setContent { LabTheme { LessonTrialScreen("The 把 sentence", json(LessonSamples.lesson(LessonSamples.choice)), null, env, onBack = {}, onFinished = {}) } }
        compose.mainClock.advanceTimeBy(1_500)
        compose.onAllNodesWithText("请把窗户关上。").onFirst().performClick()
        compose.mainClock.advanceTimeBy(300)
        compose.onAllNodesWithText("Continue").onFirst().performClick()
        compose.mainClock.advanceTimeBy(2_000)
        compose.onRoot().captureRoboImage("screenshots/k-lessons-02-try-it-finished.png")
    }

    @Test fun tryItInvalid() = shoot("k-lessons-03-try-it-problems") {
        val broken = buildJsonObject { put("title", "Half-written lesson"); put("sections", "not a list") }
        LessonTrialScreen("Half-written lesson", broken, null, env, onBack = {}, onFinished = {})
    }

    @Test fun editorPreview() = shoot("k-lessons-04-editor-preview") {
        LessonPreviewPane(json(LessonSamples.full), env)
    }

    @Test fun editorPreviewIncomplete() = shoot("k-lessons-05-editor-preview-incomplete") {
        val spec = json(LessonSamples.lesson(LessonSamples.choice.copy(options = listOf(LessonSentence("请把窗户关上。")))))
        LessonPreviewPane(spec, env, errors = listOf("Section 1, exercise 1: a choice needs at least 2 options"))
    }

    // ---- The tutor's view of a student's answers ----

    private val summaries = listOf(
        AttemptSummaryDto("a1", "L1", "The 把 sentence", "🧱", "2026-09-27T09:12:00.000Z", 312_000, 4, 6, 2, 1),
        AttemptSummaryDto("a2", "L2", "Writing 你好", "✍️", "2026-09-26T19:40:00.000Z", 95_000, 1, 2, 1, 0),
        AttemptSummaryDto("a3", "L3", "At the hotel", "🏨", "2026-09-24T08:05:00.000Z", 421_000, 3, 3, 3, 0),
    )

    @Test fun tutorList() = shoot("k-lessons-06-tutor-attempts") {
        AttemptListScreen(Loadable(data = summaries, loading = false), onBack = {}, onOpen = {}, onRetry = {}, studentName = "Jerome")
    }

    @Test fun tutorListEmpty() = shoot("k-lessons-07-tutor-attempts-empty") {
        AttemptListScreen(Loadable(data = emptyList(), loading = false), onBack = {}, onOpen = {}, onRetry = {}, studentName = "Jerome")
    }

    /** A handwriting run as the player records it (summarizeWriting), with real ink from the test stroke data. */
    private fun run(text: String, mode: String, grade: String): JsonObject = buildJsonObject {
        put("text", text)
        put("mode", mode)
        put("grade", grade)
        putJsonArray("skipped") {}
        putJsonArray("characters") {
            text.forEachIndexed { ci, ch ->
                val data = TestStrokes.data(ch.toString())
                addJsonObject {
                    put("character", ch.toString())
                    put("grade", if (ci == 0) "perfect" else "practice")
                    put("mistakes", if (ci == 0) 0 else 3)
                    put("hints", if (ci == 0) 0 else 1)
                    put("revealed", if (ci == 0) 0 else 1)
                    put("ms", if (ci == 0) 4_200 else 11_800)
                    put("accuracy", 1)
                    putJsonArray("strokes") {
                        data.medians.forEachIndexed { si, median ->
                            val misses = if (ci == 1 && si == 1) 2 else 0
                            val hinted = ci == 1 && si == 3
                            val revealed = ci == 1 && si == 5
                            addJsonObject {
                                put("misses", misses)
                                putJsonArray("mistakes") { if (misses > 0) { add("wrong_direction"); add("wrong_stroke") } }
                                put("hinted", hinted)
                                put("revealed", revealed)
                                if (!revealed) putJsonArray("drawn") {
                                    StrokeGeometry.compactStroke(TestStrokes.draw(median, dx = 14.0 - si * 3, dy = -10.0 + si * 2)).forEach { p -> addJsonArray { add(p[0]); add(p[1]) } }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private val handSpec = CustomLessonSpec(
        "Writing 你好", "✍️", null,
        listOf(LessonSection("Write it", listOf(
            WriteHandwritingExercise(LessonSentence("你好", "nǐ hǎo", "hello")),
            DictationExercise(LessonSentence("你好", "nǐ hǎo", "hello"), input = WritingInput.HANDWRITE),
        ))),
    )

    private val handAttempt = AttemptDetailDto(
        "a2", "L2", "2026-09-26T19:40:00.000Z", 95_000, 1, 2, 1, handSpec,
        LessonAttemptData(
            "2026-09-26T19:38:25.000Z", 95_000,
            listOf(
                ExerciseAttempt(0, 0, "write_handwriting", false, 0, 1, 52_000, ExerciseAnswer(handwriting = HandwritingAnswer(engine = "strokes", text = "你好", checked = false, mistakes = 3, writing = run("你好", "recall", "practice")))),
                ExerciseAttempt(0, 1, "dictation", true, 1, 1, 43_000, ExerciseAnswer(plays = 2, handwriting = HandwritingAnswer(engine = "strokes", text = "你好", checked = true, mistakes = 0, writing = run("你好", "trace", "good")))),
            ),
        ),
    )

    @Test fun tutorDetailStrokes() = shoot("k-lessons-08-tutor-answer-strokes") {
        AttemptDetailScreen(Loadable(data = handAttempt, loading = false), onBack = {}, onRetry = {}, onPlay = {}, playingKey = null, studentName = "Jerome", strokeLoader = TestStrokes.loader)
    }

    @Test fun tutorDetailDark() = shoot("k-lessons-09-tutor-answer-strokes-dark", dark = true) {
        AttemptDetailScreen(Loadable(data = handAttempt, loading = false), onBack = {}, onRetry = {}, onPlay = {}, playingKey = null, studentName = "Jerome", strokeLoader = TestStrokes.loader)
    }

    @Config(qualifiers = UNFOLDED)
    @Test fun tutorDetailUnfolded() = shoot("k-lessons-10-tutor-answer-unfolded") {
        AttemptDetailScreen(Loadable(data = handAttempt, loading = false), onBack = {}, onRetry = {}, onPlay = {}, playingKey = null, studentName = "Jerome", strokeLoader = TestStrokes.loader)
    }
}
