package dev.jeromeswannack.chineselearning.lab.ui.strokes

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CharStrokeData
import dev.jeromeswannack.chineselearning.lab.core.CharacterQuizState
import dev.jeromeswannack.chineselearning.lab.core.CharacterWritingResult
import dev.jeromeswannack.chineselearning.lab.core.HintLevel
import dev.jeromeswannack.chineselearning.lab.core.QuizFeedback
import dev.jeromeswannack.chineselearning.lab.core.QuizOptions
import dev.jeromeswannack.chineselearning.lab.core.StrokePoint
import dev.jeromeswannack.chineselearning.lab.core.StrokeQuiz
import dev.jeromeswannack.chineselearning.lab.core.WritingExerciseResult
import dev.jeromeswannack.chineselearning.lab.core.WritingGrade
import dev.jeromeswannack.chineselearning.lab.core.WritingMode
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.pow

/** Feedback for the pad: a pluck that climbs per stroke, a bump on a miss, a chord per character. */
interface WritingFx {
    fun strokeCorrect(index: Int) {}
    fun miss() {}
    fun characterDone(perfect: Boolean) {}

    companion object {
        val None = object : WritingFx {}

        /** Sounds + haptics through the app's fx (respecting its toggles and the pad's own mute). */
        fun of(context: Context, muted: () -> Boolean): WritingFx {
            val app = context.applicationContext as? LabApp ?: return None
            return object : WritingFx {
                // The web's pluck climbs C5 D5 E5 G5 A5 C6: semitones above the first note.
                private val steps = intArrayOf(0, 2, 4, 7, 9, 12)

                override fun strokeCorrect(index: Int) {
                    if (!muted()) app.sounds.play(Sounds.Sfx.POP, 0.55f, 2.0.pow(steps[index % steps.size] / 12.0).toFloat())
                    app.haptics.tick()
                }

                override fun miss() {
                    if (!muted()) app.sounds.play(Sounds.Sfx.WRONG, 0.35f)
                    app.haptics.wrong()
                }

                override fun characterDone(perfect: Boolean) {
                    if (!muted()) app.sounds.play(if (perfect) Sounds.Sfx.MILESTONE else Sounds.Sfx.CORRECT, 0.7f)
                    if (perfect) app.haptics.celebrate() else app.haptics.correct()
                }
            }
        }
    }
}

enum class StatusTone { Neutral, Good, Bad, Hint }

data class WritingStatus(val text: String = "", val tone: StatusTone = StatusTone.Neutral)

/**
 * The per-word writing run — port of the web's `WritingRun` (components/strokes/WritingExercise.tsx):
 * runs the pure quiz ([StrokeQuiz]) character by character, owns timing (demo, the 1.1 s pause
 * after each character) and feedback, and exposes Compose state for [WritingRunView]. Rules
 * live in core; this is orchestration only, so a lesson exercise, the practice page and the
 * card's "Write it" sheet behave the same.
 */
class WritingController(
    val text: String,
    val chars: List<String>,
    private val data: Map<String, CharStrokeData>,
    val skipped: List<String>,
    initialMode: WritingMode,
    private val autoDemo: Boolean,
    private val scope: CoroutineScope,
    private val fx: WritingFx = WritingFx.None,
    private val onComplete: (WritingExerciseResult) -> Unit = {},
    private val clock: () -> Long = System::currentTimeMillis,
) {
    var mode by mutableStateOf(initialMode)
        private set
    var charIdx by mutableStateOf(0)
        private set
    var results by mutableStateOf<List<CharacterWritingResult>>(emptyList())
        private set
    var summary by mutableStateOf(false)
        private set
    var quiz by mutableStateOf(StrokeQuiz.create(chars[0], data.getValue(chars[0]), QuizOptions(initialMode), clock()))
        private set
    var demoKey by mutableStateOf<Long?>(if (autoDemo && initialMode == WritingMode.TRACE) clock() else null)
        private set
    var justCompleted by mutableStateOf<Int?>(null)
        private set
    var status by mutableStateOf(WritingStatus())
        private set
    var celebrate by mutableStateOf<WritingGrade?>(null)
        private set
    /** Bumped on every character start, so the pad resets its animations. */
    var runKey by mutableLongStateOf(0L)
        private set
    /** The finished result of the last run (the summary shows it). */
    var lastResult by mutableStateOf<WritingExerciseResult?>(null)
        private set

    private var startedAt = clock()
    private var advance: Job? = null

    val charData: CharStrokeData get() = data.getValue(chars[charIdx])
    val hint: HintLevel get() = StrokeQuiz.hintLevel(quiz)
    val finished: Boolean get() = quiz.isComplete

    /** The line under the pad when there's no feedback to show. */
    val progressText: String
        get() {
            val total = quiz.strokeCount
            val of = if (chars.size > 1) " · character ${charIdx + 1} of ${chars.size}" else ""
            return when {
                demoKey != null -> "Watch the stroke order — or just start writing"
                finished -> "$total strokes$of"
                else -> "Stroke ${quiz.current + 1} of $total$of"
            }
        }

    private fun startChar(idx: Int, m: WritingMode, demo: Boolean) {
        val c = chars[idx]
        charIdx = idx
        quiz = StrokeQuiz.create(c, data.getValue(c), QuizOptions(m), clock())
        justCompleted = null
        celebrate = null
        status = WritingStatus()
        demoKey = if (demo) clock() else null
        runKey++
    }

    /** ↺ Again / mode switch: the whole word from the start. */
    fun restartWord(m: WritingMode = mode) {
        advance?.cancel()
        mode = m
        results = emptyList()
        summary = false
        lastResult = null
        startedAt = clock()
        startChar(0, m, autoDemo && m == WritingMode.TRACE)
    }

    fun switchMode(m: WritingMode) {
        if (m != mode) restartWord(m)
    }

    fun toggleMode() = restartWord(if (mode == WritingMode.TRACE) WritingMode.RECALL else WritingMode.TRACE)

    /** ↺ Restart: this character again, no demo. */
    fun restartChar() = startChar(charIdx, mode, false)

    /** ▶ Watch: replay the stroke order. */
    fun watch() {
        demoKey = clock()
    }

    /** 💡 Hint: paint the current stroke (counts as hinted). */
    fun requestHint() {
        quiz = StrokeQuiz.requestHint(quiz)
        demoKey = null
        status = WritingStatus("Follow the blue stroke — start at the dot.", StatusTone.Hint)
    }

    fun onPenDown() {
        if (demoKey != null) demoKey = null
    }

    /** Timing starts when the learner can write, not when the animation began. */
    fun onDemoEnd() {
        demoKey = null
        val q = quiz
        if (q.current == 0 && q.pending.misses == 0) {
            val now = clock()
            quiz = q.copy(startedAt = now, pending = q.pending.copy(startedAt = now))
        }
    }

    /** A finished drawing from the pad. */
    fun onStroke(points: List<StrokePoint>): InkOutcome {
        if (quiz.isComplete || summary) return InkOutcome.Ignore
        val (state, feedback) = StrokeQuiz.submit(quiz, points, clock())
        quiz = state
        return when (feedback) {
            QuizFeedback.Ignored -> InkOutcome.Ignore
            is QuizFeedback.Correct -> {
                justCompleted = feedback.index
                fx.strokeCorrect(feedback.index)
                if (feedback.complete) finishChar(state) else status = WritingStatus()
                InkOutcome.Accept
            }
            is QuizFeedback.Revealed -> {
                justCompleted = feedback.index
                fx.miss()
                if (feedback.complete) finishChar(state)
                else status = WritingStatus("That's how stroke ${feedback.index + 1} goes — on to the next.", StatusTone.Hint)
                InkOutcome.Reject
            }
            is QuizFeedback.Mistake -> {
                fx.miss()
                status = WritingStatus(StrokeQuiz.mistakeMessage(feedback), if (feedback.hint == HintLevel.NONE) StatusTone.Bad else StatusTone.Hint)
                InkOutcome.Reject
            }
        }
    }

    private fun finishChar(state: CharacterQuizState) {
        val result = StrokeQuiz.summarizeCharacter(state, clock())
        val all = results + result
        results = all
        celebrate = result.grade
        status = WritingStatus(GRADE_LINE.getValue(result.grade), if (result.grade == WritingGrade.PRACTICE) StatusTone.Hint else StatusTone.Good)
        fx.characterDone(result.grade == WritingGrade.PERFECT)
        advance = scope.launch {
            delay(ADVANCE_MS)
            advance = null
            if (charIdx + 1 < chars.size) {
                startChar(charIdx + 1, mode, autoDemo && mode == WritingMode.TRACE)
            } else {
                val r = StrokeQuiz.summarizeExercise(text, mode, all, skipped, startedAt, clock())
                lastResult = r
                summary = true
                onComplete(r)
            }
        }
    }

    companion object {
        const val ADVANCE_MS = 1100L

        val GRADE_LINE = mapOf(
            WritingGrade.PERFECT to "完美！Perfect",
            WritingGrade.GOOD to "很好！Nicely done",
            WritingGrade.PRACTICE to "Done — worth another go",
        )

        val MODE_LABEL = mapOf(WritingMode.TRACE to "Trace", WritingMode.RECALL to "From memory")
    }
}
