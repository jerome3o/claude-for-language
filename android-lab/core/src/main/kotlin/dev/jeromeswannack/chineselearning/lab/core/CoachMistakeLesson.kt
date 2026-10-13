package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Port of shared/coach/mistakeLesson.ts — "🎯 Mini lesson on this mistake" (Sentence Coach): after
 * ✏️ Check my sentence found a mistake, a short mini lesson about exactly that mistake, played at
 * once in the lesson player (nothing recorded) and kept only when he saves it. Stored on the
 * conversation as an assistant message with content_type [CONTENT_TYPE]. Parity-tested through
 * android-lab/parity/fixtures/coach.ts (CoachParityTest).
 */
object CoachMistakeLesson {
    /** Port of MISTAKE_LESSON_CONTENT_TYPE. */
    const val CONTENT_TYPE = "mistake_lesson"
    /** Port of COACH_MISTAKE_LESSON_LABEL. */
    const val LABEL = "🎯 Mini lesson on this mistake"
    /** Port of COACH_MISTAKE_LESSON_BUSY. */
    const val BUSY = "Writing your mini lesson…"

    /**
     * JS `[\s\p{P}\p{S}]` with the u flag: JS `\s` is the ASCII controls + every Unicode space
     * separator + U+FEFF, spelled out (Java's `\s` is ASCII only).
     */
    private val NOT_CORE = Regex("[\\t\\n\\u000B\\f\\r\\p{Z}\\uFEFF\\p{P}\\p{S}]")
    private val HAN = Regex("\\p{IsHan}")

    /** Port of sentenceCore: the sentence without spaces, punctuation and symbols. */
    fun sentenceCore(text: String): String = NOT_CORE.replace(text, "")

    /** Port of coachMistakeLessonOffered: a Chinese check whose correction differs from what was written. */
    fun offered(originalInput: String?, isCorrect: Boolean, corrected: String?): Boolean {
        if (isCorrect) return false
        val wrote = sentenceCore(originalInput.orEmpty())
        val fixed = sentenceCore(corrected.orEmpty())
        return wrote.isNotEmpty() && fixed.isNotEmpty() && wrote != fixed && HAN.containsMatchIn(wrote)
    }

    /** Port of mistakeLessonExerciseCount. */
    fun exerciseCount(spec: CustomLessonSpec): Int = spec.sections.sumOf { it.exercises.size }

    /** Port of mistakeLessonCardLine: "🎯 Mini lesson · 10 exercises". */
    fun cardLine(exercises: Int): String = "🎯 Mini lesson · $exercises exercise${if (exercises == 1) "" else "s"}"

    /** Port of MistakeLessonContent. */
    @Serializable
    data class Content(
        val spec: CustomLessonSpec,
        @SerialName("lesson_id") val lessonId: String? = null,
        @SerialName("saved_at") val savedAt: String? = null,
        val completed: Boolean = false,
    )

    /** Port of parseMistakeLessonContent: null unless it is a lesson. */
    fun parse(raw: String?): Content? {
        if (raw.isNullOrBlank()) return null
        val obj = runCatching { LessonJson.parseToJsonElement(raw) as? kotlinx.serialization.json.JsonObject }.getOrNull() ?: return null
        val spec = obj["spec"] as? kotlinx.serialization.json.JsonObject ?: return null
        if (spec["sections"] !is kotlinx.serialization.json.JsonArray) return null
        return runCatching { LessonJson.decodeFromJsonElement(Content.serializer(), obj) }.getOrNull()
    }
}
