package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Feedback while listening (docs/AUDIO_LESSONS.md "Feedback while listening") — port of
 * shared/audio-lesson/feedback.ts, parity-tested (parity/fixtures/audio-lesson-feedback.ts →
 * AudioLessonFeedbackParityTest). A SECTION is a transcript row ([AudioLessonTimeline.transcriptRows]):
 * a sentence with its repeats. Back a section = the row playing from its start, or the row before
 * when this one started less than 2 s of listening ago; the same 2 s decide which row a "Too hard"
 * is about (reaction lag).
 */

/** Port of FeedbackRowSnapshot: what an event keeps of a row. */
@Serializable
data class FeedbackRowSnapshot(
    val index: Int,
    @SerialName("start_ms") val startMs: Long,
    val text: String,
    val pinyin: String? = null,
    val english: String? = null,
)

/** Port of AudioLessonFeedbackEvent — the body of POST /api/audio-lessons/:id/feedback { events: [it] }. */
@Serializable
data class AudioLessonFeedbackEvent(
    val id: String,
    @SerialName("audio_lesson_id") val audioLessonId: String,
    /** too_hard · again · back_section · skip */
    val kind: String,
    /** lock_screen · notification · player · headset */
    val where: String,
    @SerialName("position_ms") val positionMs: Long,
    @SerialName("chapter_index") val chapterIndex: Int,
    @SerialName("row_index") val rowIndex: Int,
    val row: FeedbackRowSnapshot? = null,
    @SerialName("previous_row") val previousRow: FeedbackRowSnapshot? = null,
    val speed: Double = 1.0,
    @SerialName("audio_version") val audioVersion: String? = null,
    @SerialName("created_at") val createdAt: String,
)

/** Port of SectionJump. */
data class SectionJump(val targetMs: Long, val rowIndex: Int, val kind: String)

object AudioLessonFeedback {
    const val TOO_HARD = "too_hard"
    const val AGAIN = "again"
    const val BACK_SECTION = "back_section"
    const val SKIP = "skip"

    const val LOCK_SCREEN = "lock_screen"
    const val NOTIFICATION = "notification"
    const val PLAYER = "player"
    const val HEADSET = "headset"

    /** Port of BACK_SECTION_GRACE_MS. */
    const val BACK_SECTION_GRACE_MS = 2000L

    /** Port of FEEDBACK_ROW_TEXT_MAX. */
    const val ROW_TEXT_MAX = 300

    /** Port of sectionGraceMs: the grace in MEDIA time at a playback speed. */
    fun sectionGraceMs(speed: Double = 1.0): Long {
        val s = if (speed.isFinite() && speed > 0) speed else 1.0
        return Js.round(BACK_SECTION_GRACE_MS * s).toLong()
    }

    /** Port of rowIndexAt: the row playing at [ms] (the last one that started; -1 before the first). */
    fun rowIndexAt(rows: List<AudioLessonTranscriptRow>, ms: Double): Int {
        var lo = 0
        var hi = rows.size - 1
        var found = -1
        while (lo <= hi) {
            val mid = (lo + hi) shr 1
            if (rows[mid].startMs <= ms + 1) {
                found = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        return found
    }

    /** Port of backSectionTarget; null without a transcript (the caller falls back to chapters). */
    fun backSectionTarget(rows: List<AudioLessonTranscriptRow>, ms: Double, speed: Double = 1.0): SectionJump? {
        if (rows.isEmpty()) return null
        val i = rowIndexAt(rows, ms)
        if (i < 0) return SectionJump(0, -1, AGAIN)
        if (i > 0 && ms - rows[i].startMs < sectionGraceMs(speed)) return SectionJump(rows[i - 1].startMs, i - 1, BACK_SECTION)
        return SectionJump(rows[i].startMs, i, AGAIN)
    }

    /** Port of nextSectionTarget: the next row's start; null on the last row / no transcript. */
    fun nextSectionTarget(rows: List<AudioLessonTranscriptRow>, ms: Double): SectionJump? {
        val next = rowIndexAt(rows, ms) + 1
        if (next >= rows.size) return null
        return SectionJump(rows[next].startMs, next, SKIP)
    }

    private fun cut(s: String): String = if (s.length > ROW_TEXT_MAX) s.substring(0, ROW_TEXT_MAX - 1) + "…" else s

    /** Port of rowSnapshot. */
    fun rowSnapshot(rows: List<AudioLessonTranscriptRow>, i: Int): FeedbackRowSnapshot? {
        val r = rows.getOrNull(i) ?: return null
        return FeedbackRowSnapshot(
            index = i,
            startMs = r.startMs,
            text = cut(r.text),
            pinyin = r.pinyin?.takeIf { it.isNotEmpty() }?.let(::cut),
            english = r.english?.takeIf { it.isNotEmpty() }?.let(::cut),
        )
    }

    /** Port of buildFeedbackEvent. */
    fun buildEvent(
        id: String,
        lessonId: String,
        kind: String,
        where: String,
        positionMs: Double,
        speed: Double,
        audioVersion: String?,
        createdAt: String,
        rows: List<AudioLessonTranscriptRow>,
        chapters: List<AudioLessonChapter>,
    ): AudioLessonFeedbackEvent {
        val pos = maxOf(0.0, Js.round(positionMs))
        val i = rowIndexAt(rows, pos)
        return AudioLessonFeedbackEvent(
            id = id,
            audioLessonId = lessonId,
            kind = kind,
            where = where,
            positionMs = pos.toLong(),
            chapterIndex = if (chapters.isNotEmpty()) AudioLessonTimeline.chapterIndexAt(chapters, pos) else 0,
            rowIndex = i,
            row = rowSnapshot(rows, i),
            previousRow = rowSnapshot(rows, i - 1),
            speed = if (speed.isFinite() && speed > 0) speed else 1.0,
            audioVersion = audioVersion,
            createdAt = createdAt,
        )
    }

    /** Port of flaggedRowIndex: the row an event is about (null = none). */
    fun flaggedRowIndex(e: AudioLessonFeedbackEvent): Int? {
        if (e.kind == BACK_SECTION) return e.previousRow?.index ?: if (e.row != null) e.rowIndex else null
        if (e.kind == TOO_HARD && e.row != null && e.previousRow != null && e.positionMs - e.row.startMs < sectionGraceMs(e.speed)) return e.previousRow.index
        return if (e.row != null && e.rowIndex >= 0) e.rowIndex else null
    }
}
