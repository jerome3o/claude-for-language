package dev.jeromeswannack.chineselearning.lab.data.audiolessons

import android.net.Uri
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonFeedback
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonFeedbackEvent
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import kotlinx.serialization.Serializable

/**
 * Feedback while listening (docs/AUDIO_LESSONS.md "Feedback while listening"): every "Too hard" and back /
 * next a section — from the lock screen, the media notification, a headset button or the player — is an
 * [AudioLessonFeedbackEvent] queued in the Outbox (`POST /api/audio-lessons/:id/feedback`, idempotent by the
 * event id, so it survives the train and a replay). The rows marked too hard are also kept on the phone
 * (JsonCache `audio-lessons/feedback/<id>`) for the transcript's 😵 dot.
 */
object AudioLessonFeedbackStore {
    const val OUTBOX_KIND = "audio-lesson-feedback"

    fun path(lessonId: String) = "/api/audio-lessons/${Uri.encode(lessonId)}/feedback"

    fun cacheKey(lessonId: String) = "audio-lessons/feedback/$lessonId"

    @Serializable
    data class Body(val events: List<AudioLessonFeedbackEvent>)

    /** The transcript rows marked "Too hard" on this phone. */
    @Serializable
    data class Flagged(val rows: List<Int> = emptyList())

    suspend fun record(app: LabApp, e: AudioLessonFeedbackEvent) {
        record(app.outbox, app.cache, e)
        app.scheduleBackgroundUpload()
    }

    /** Queues [e] (idempotent by its id) and, for "Too hard", remembers the row it is about. */
    suspend fun record(outbox: Outbox, cache: JsonCache, e: AudioLessonFeedbackEvent) {
        outbox.enqueueJson(OUTBOX_KIND, "POST", path(e.audioLessonId), Body(listOf(e)), id = e.id)
        if (e.kind == AudioLessonFeedback.TOO_HARD) {
            AudioLessonFeedback.flaggedRowIndex(e)?.let { idx ->
                val key = cacheKey(e.audioLessonId)
                val now = cache.get<Flagged>(key) ?: Flagged()
                if (idx !in now.rows) cache.put(key, "audio-lesson-feedback", Flagged((now.rows + idx).sorted()))
            }
        }
    }
}
