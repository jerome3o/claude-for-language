package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/*
 * Port of shared/lesson/attempt.ts: what the learner answered in each exercise of a
 * lesson run and how long it took. It rides on the completion event (same id) to
 * POST /api/custom-lessons/offline-complete; recordings go up afterwards by media key.
 * Field names are the wire names (snake_case).
 */

/** Handwriting as vector strokes: one flat [x0, y0, x1, y1, …] list per stroke (pad pixels). */
@Serializable
data class HandwritingStrokes(val width: Int, val height: Int, val strokes: List<List<Int>>)

@Serializable
data class HandwritingAnswer(
    val strokes: HandwritingStrokes? = null,
    /** A stroke-order checked run (StrokeWritingSummary), kept as JSON. */
    val writing: JsonElement? = null,
    val text: String? = null,
    val checked: Boolean? = null,
    val mistakes: Int? = null,
    /** 'sketch' (free drawing) or a stroke engine's id. */
    val engine: String? = null,
)

@Serializable
data class SentenceFeedback(
    /** correct | minor | incorrect */
    val verdict: String = "incorrect",
    @SerialName("uses_all_words") val usesAllWords: Boolean = false,
    val corrected: LessonSentence? = null,
    val comment: String = "",
)

@Serializable
data class AttemptRecording(
    @SerialName("media_key") val mediaKey: String,
    @SerialName("duration_ms") val durationMs: Long,
    val mime: String? = null,
)

@Serializable
data class QuestionAnswer(val choice: Int? = null, val text: String? = null, val correct: Boolean? = null)

@Serializable
data class ExerciseAnswer(
    val text: String? = null,
    /** An index into the SPEC's options (not display order). */
    val choice: Int? = null,
    val order: List<String>? = null,
    val mistakes: Int? = null,
    @SerialName("self_assessed") val selfAssessed: Boolean? = null,
    @SerialName("hint_used") val hintUsed: Boolean? = null,
    val plays: Int? = null,
    val handwriting: HandwritingAnswer? = null,
    val recording: AttemptRecording? = null,
    val feedback: SentenceFeedback? = null,
    val questions: List<QuestionAnswer>? = null,
)

@Serializable
data class ExerciseAttempt(
    val section: Int,
    val index: Int,
    val type: String,
    /** null for unscored exercises (notes). */
    val correct: Boolean? = null,
    val points: Int = 0,
    @SerialName("max_points") val maxPoints: Int = 0,
    @SerialName("duration_ms") val durationMs: Long = 0,
    val answer: ExerciseAnswer? = null,
)

@Serializable
data class LessonAttemptData(
    @SerialName("started_at") val startedAt: String = "",
    @SerialName("duration_ms") val durationMs: Long = 0,
    val exercises: List<ExerciseAttempt> = emptyList(),
)

data class SectionTime(val section: Int, val durationMs: Long, val exercises: Int, val correct: Int, val scored: Int)

object LessonAttempts {
    /** `exerciseMediaKey`: stable per position in a run. */
    fun mediaKey(section: Int, index: Int) = "s${section}e$index"

    /** `sectionTimes`. */
    fun sectionTimes(data: LessonAttemptData): List<SectionTime> {
        val by = LinkedHashMap<Int, SectionTime>()
        for (ex in data.exercises) {
            val s = by[ex.section] ?: SectionTime(ex.section, 0, 0, 0, 0)
            by[ex.section] = s.copy(
                durationMs = s.durationMs + Math.max(0L, ex.durationMs),
                exercises = s.exercises + 1,
                scored = s.scored + if (ex.correct != null) 1 else 0,
                correct = s.correct + if (ex.correct == true) 1 else 0,
            )
        }
        return by.values.sortedBy { it.section }
    }

    /** `formatDuration`: "12 s", "1:05", "1 h 5 min". */
    fun formatDuration(ms: Long): String {
        val s = Js.round(ms / 1000.0).toLong()
        if (s < 60) return "$s s"
        val m = s / 60
        if (m < 60) return "$m:${(s % 60).toString().padStart(2, '0')}"
        return "${m / 60} h ${m % 60} min"
    }

    /**
     * The attempt entry for an exercise the learner just finished (StudyCustomLesson's
     * `advance`): a conversation scores one point per right question, everything else 0/max.
     */
    fun attemptFor(section: Int, index: Int, exercise: LessonExercise, correct: Boolean?, answer: ExerciseAnswer?, durationMs: Long): ExerciseAttempt {
        val maxPoints = Lessons.exercisePoints(exercise)
        val points = answer?.questions?.count { it.correct == true } ?: if (correct == true) maxPoints else 0
        return ExerciseAttempt(
            section = section,
            index = index,
            type = exercise.type,
            correct = correct,
            points = if (correct == null) 0 else Math.min(points, maxPoints),
            maxPoints = if (correct == null) 0 else maxPoints,
            durationMs = durationMs,
            answer = answer,
        )
    }
}
