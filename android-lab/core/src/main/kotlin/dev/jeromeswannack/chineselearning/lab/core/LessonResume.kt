package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Resuming a mini lesson left half-way (Lab-first; the web player doesn't do this yet —
 * android-lab/PARITY.md). After every exercise the player saves where it is: the next
 * exercise, the score so far, every answer made (the attempt rows) and the recordings'
 * files. Opening the same lesson again — from Home, today's lesson list, the session or a
 * homework pass — continues from there while [restorable] says so; completing (rating)
 * the lesson, "Start over", a new day or an edited spec clears it. Nothing goes to the
 * server until the lesson is completed, exactly as before.
 *
 * Granularity is the exercise ("a step"): the exercise that was on screen starts again
 * from its beginning; everything answered before it is kept.
 */
object LessonResume {
    /**
     * The bound: the same LOCAL date and at most 18 h since the last save. A lesson left
     * late in the evening doesn't come back half-done the next morning (a later day's
     * review starts fresh), and the 18 h cap covers a clock or time-zone jump.
     */
    const val MAX_AGE_MS = 18L * 60 * 60 * 1000

    /** A recording made in an exercise already answered (its staged file on the phone). */
    @Serializable
    data class SavedRecording(@SerialName("media_key") val mediaKey: String, val path: String, val mime: String)

    /** The saved state of one lesson run. [index] = the next exercise (== count: all answered, not rated yet). */
    @Serializable
    data class Progress(
        @SerialName("lesson_id") val lessonId: String,
        @SerialName("spec_hash") val specHash: String,
        val day: String,
        @SerialName("saved_at") val savedAt: Long,
        @SerialName("started_at") val startedAt: Long,
        val index: Int,
        val correct: Int = 0,
        val total: Int = 0,
        val attempts: List<ExerciseAttempt> = emptyList(),
        val recordings: List<SavedRecording> = emptyList(),
    )

    /** 64-bit FNV-1a of the spec's JSON, hex: an edited / pushed-update lesson gets a new hash. */
    fun specHash(specJson: String): String {
        var h = -0x340d631b7bdddcdbL // 0xcbf29ce484222325
        for (c in specJson) {
            h = h xor c.code.toLong()
            h *= 0x100000001b3L
        }
        return java.lang.Long.toHexString(h)
    }

    /**
     * The saved run to continue with, or null (then the lesson starts fresh and the saved
     * run should be cleared — see [isStale]). [exerciseCount] = the playable exercises.
     */
    fun restorable(saved: Progress?, lessonId: String, specHash: String, today: String, nowMs: Long, exerciseCount: Int): Progress? {
        if (saved == null || isStale(saved, specHash, today, nowMs)) return null
        if (saved.lessonId != lessonId) return null
        if (saved.index < 1 || saved.index > exerciseCount) return null
        return saved
    }

    /** A saved run that can never be continued: another spec, another day, or older than [MAX_AGE_MS]. */
    fun isStale(saved: Progress, specHash: String?, today: String, nowMs: Long): Boolean {
        if (specHash != null && saved.specHash != specHash) return true
        if (saved.day != today) return true
        val age = nowMs - saved.savedAt
        return age < 0 || age > MAX_AGE_MS
    }

    /**
     * A lesson opened earlier today and left on its first exercise (nothing answered, so no saved
     * run): coming back says so instead of looking like a brand-new lesson out of nowhere.
     */
    fun reopenedLine(count: Int): String = "Back to today's lesson · 1 of $count"

    /** "Continuing where you left off" — "exercise 4 of 9" / "the rating" when everything was answered. */
    fun continueLine(index: Int, count: Int): String =
        if (index >= count) "Continuing where you left off · all done" else "Continuing where you left off · ${index + 1} of $count"
}
