package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.floor
import kotlin.math.max

/*
 * Audio lessons (docs/AUDIO_LESSONS.md) — the player's pure helpers. Port of
 * shared/audio-lesson/timeline.ts (chapterIndexAt, transcriptIndexAt, previousChapterTarget,
 * formatClock, durationLabel, sleep timer, speeds, transcriptRows) plus the list's statusLine
 * (AudioLessonsPage.tsx) and the input limits (shared/audio-lesson/types.ts). Parity-tested
 * against the TypeScript (parity/fixtures/audio-lesson.ts → AudioLessonParityTest).
 */

/** AudioLessonChapter — where a chapter starts in the rendered file. */
@Serializable
data class AudioLessonChapter(val title: String, @SerialName("start_ms") val startMs: Long)

/** AudioLessonTranscriptLine — one spoken clip, timed in the rendered file. */
@Serializable
data class AudioLessonTranscriptLine(
    @SerialName("start_ms") val startMs: Long,
    val lang: String,
    val voice: String,
    val text: String,
    val pinyin: String? = null,
    val english: String? = null,
    val chapter: Int = 0,
)

/** LessonWord — a word / structure the lesson teaches. */
@Serializable
data class AudioLessonWord(val hanzi: String, val pinyin: String = "", val english: String = "", val status: String? = null)

/** TranscriptRow — what the player shows: lines [first]..[last] joined into one row. */
data class AudioLessonTranscriptRow(
    val first: Int,
    val last: Int,
    val startMs: Long,
    val lang: String,
    val text: String,
    val pinyin: String? = null,
    val english: String? = null,
    /** How many times the line is said in a row (a sleep word ×3, an example sentence ×3); null = once. */
    val repeat: Int? = null,
)

object AudioLessonTimeline {
    /** Port of AUDIO_LESSON_SPEEDS: the speed chip's cycle (pitch kept). */
    val SPEEDS: List<Double> = listOf(0.75, 0.9, 1.0, 1.25)

    /** Port of SLEEP_TIMER_CHOICES (minutes; 0 = off, -1 = end of this chapter). */
    val SLEEP_TIMER_CHOICES: List<Int> = listOf(0, 10, 15, 20, 30, 45, 60, -1)

    /** Port of SLEEP_FADE_MS: the last stretch of a sleep timer fades out over this long. */
    const val SLEEP_FADE_MS = 30_000L

    /** "previous chapter" goes back one more chapter within this long of a chapter's start. */
    const val PREVIOUS_CHAPTER_GRACE_MS = 3000L

    /** Port of chapterIndexAt: the chapter playing at [ms] (the last one that started). */
    fun chapterIndexAt(chapters: List<AudioLessonChapter>, ms: Double): Int {
        var idx = 0
        for (i in chapters.indices) if (chapters[i].startMs <= ms + 1) idx = i
        return idx
    }

    /** Port of transcriptIndexAt: the transcript line playing at [ms], -1 before the first. */
    fun transcriptIndexAt(lines: List<AudioLessonTranscriptLine>, ms: Double): Int {
        var lo = 0
        var hi = lines.size - 1
        var found = -1
        while (lo <= hi) {
            val mid = (lo + hi) shr 1
            if (lines[mid].startMs <= ms + 1) {
                found = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        return found
    }

    /** Port of previousChapterTarget: this chapter's start, or the one before within 3 s of the start. */
    fun previousChapterTarget(chapters: List<AudioLessonChapter>, ms: Double): Long {
        val i = chapterIndexAt(chapters, ms)
        if (i > 0 && ms - chapters[i].startMs < PREVIOUS_CHAPTER_GRACE_MS) return chapters[i - 1].startMs
        return chapters.getOrNull(i)?.startMs ?: 0L
    }

    /** The player's ⏭ (inline in the web player): the next chapter's start, or null in the last one. */
    fun nextChapterTarget(chapters: List<AudioLessonChapter>, ms: Double): Long? =
        chapters.getOrNull(chapterIndexAt(chapters, ms) + 1)?.startMs

    /** Port of formatClock: "1:05", "12:40", "1:02:03". */
    fun formatClock(ms: Double): String {
        val total = max(0.0, floor(ms / 1000)).toLong()
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        val ss = s.toString().padStart(2, '0')
        return if (h > 0) "$h:${m.toString().padStart(2, '0')}:$ss" else "$m:$ss"
    }

    /** Port of durationLabel: "14 min". */
    fun durationLabel(ms: Double): String = "${max(1.0, Js.round(ms / 60000)).toLong()} min"

    /** Port of sleepTimerLabel. */
    fun sleepTimerLabel(minutes: Int): String = when (minutes) {
        0 -> "Off"
        -1 -> "End of chapter"
        else -> "$minutes min"
    }

    /** Port of sleepFadeVolume: the volume [remainingMs] before the timer ends (1 → 0 over the fade). */
    fun sleepFadeVolume(remainingMs: Double): Double = when {
        remainingMs >= SLEEP_FADE_MS -> 1.0
        remainingMs <= 0 -> 0.0
        else -> remainingMs / SLEEP_FADE_MS
    }

    /** The speed chip (the web's changeSpeed): the next of [SPEEDS]; an unknown speed goes to the first, like indexOf -1 → 0. */
    fun nextSpeed(speed: Double): Double = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.size]

    /** A remembered speed: one of [SPEEDS], else 1× (the web's readSpeed). */
    fun parseSpeed(raw: Double?): Double = if (raw != null && raw in SPEEDS) raw else 1.0

    /** The chip's label: "0.75×", "1×" (the web renders `{speed}×`). */
    fun speedLabel(speed: Double): String = Js.numberToString(speed) + "×"

    private val SENTENCE_END = Regex("[.!?:][\"”’)]?$")
    private val LEADING_PUNCT = Regex("^[,.;:!?]")

    /**
     * English narration and the Chinese spoken inside it: format A's host + teacher, and a
     * sleep lesson's recap ("The word was 银行: bank…": the recap voice + the sleep voice right after it).
     */
    private fun isNarration(lines: List<AudioLessonTranscriptLine>, j: Int): Boolean {
        val l = lines.getOrNull(j) ?: return false
        if (l.voice == "narrator" || l.voice == "recap") return true
        if (!l.pinyin.isNullOrEmpty()) return false
        if (l.voice == "teacher") return true
        val before = lines.getOrNull(j - 1)
        return l.voice == "sleep" && before != null && before.voice == "recap" && before.chapter == l.chapter
    }

    /** JS String.prototype.trim (ECMAScript WhiteSpace + LineTerminator). */
    private fun jsTrim(s: String): String = s.trim { it.isWhitespace() || it == '﻿' || it == ' ' }

    private val TRAILING_STOP = Regex("[.!?]+[\"”’)]?$")

    /** Port of sameEnglish: "Thin, please" and "Thin, please." are the same translation. */
    private fun sameEnglish(a: String, b: String): Boolean {
        fun t(s: String) = jsTrim(jsTrim(s).replace(TRAILING_STOP, ""))
        return t(a) == t(b)
    }

    /**
     * Port of transcriptRows: an English sentence with Chinese inside ("a 兰州拉面 place") is
     * spoken as several clips, shown as ONE row; a Chinese line said several times in a row is
     * ONE row with [AudioLessonTranscriptRow.repeat] ("邮局 ×3"); a translation read right after
     * the line it translates joins that line's row.
     */
    fun transcriptRows(lines: List<AudioLessonTranscriptLine>): List<AudioLessonTranscriptRow> {
        val rows = ArrayList<AudioLessonTranscriptRow>()
        lines.forEachIndexed { i, l ->
            val prev = rows.lastOrNull()
            val prevLine = lines.getOrNull(i - 1)
            // The host reading the translation of the line just shown under it ("Line by line"), or a sleep
            // lesson's English voice translating the example sentence it just heard: one row.
            if (prev != null && prev.last == i - 1 && (l.voice == "narrator" || l.voice == "recap") && !prev.english.isNullOrEmpty() && sameEnglish(prev.english, l.text)) {
                rows[rows.size - 1] = prev.copy(last = i)
                return@forEachIndexed
            }
            // The same Chinese line again, right after itself (same voice, same chapter): one row, "×N".
            if (prev != null && prevLine != null && prev.last == i - 1 && prev.lang == "zh" && l.lang == "zh" &&
                prevLine.voice == l.voice && prevLine.chapter == l.chapter && prevLine.text == l.text
            ) {
                rows[rows.size - 1] = prev.copy(last = i, repeat = (prev.repeat ?: 1) + 1)
                return@forEachIndexed
            }
            val open = prev != null && prevLine != null && isNarration(lines, i - 1) && isNarration(lines, i) &&
                prevLine.chapter == l.chapter && !SENTENCE_END.containsMatchIn(jsTrim(prevLine.text))
            if (open) {
                val glue = if (l.lang == "zh" || prevLine!!.lang == "zh") (if (LEADING_PUNCT.containsMatchIn(l.text)) "" else " ") else " "
                rows[rows.size - 1] = prev!!.copy(text = "${prev.text}$glue${l.text}", last = i, lang = "en")
                return@forEachIndexed
            }
            rows += AudioLessonTranscriptRow(
                first = i,
                last = i,
                startMs = l.startMs,
                lang = l.lang,
                text = l.text,
                pinyin = l.pinyin?.takeIf { it.isNotEmpty() },
                english = l.english?.takeIf { it.isNotEmpty() },
            )
        }
        return rows
    }

    /** Port of formatMb (services/audioLessons.ts): "4.2 MB", "" for none. */
    fun formatMb(bytes: Long?): String {
        if (bytes == null || bytes == 0L) return ""
        return "${Js.toFixed(bytes / (1024.0 * 1024.0), 1)} MB"
    }

    /** Port of statusLine (AudioLessonsPage.tsx): what a list row says under the title. */
    fun statusLine(
        status: String,
        progress: String?,
        progressDone: Int?,
        progressTotal: Int?,
        error: String?,
        durationMs: Long?,
        wordCount: Int,
        sizeBytes: Long?,
    ): String = when (status) {
        "queued" -> "Waiting to start…"
        "writing" -> progress?.takeIf { it.isNotEmpty() } ?: "Claude is writing the lesson…"
        "speaking" -> if (progressTotal != null && progressTotal != 0) "Recording ${progressDone ?: 0} of $progressTotal clips…" else "Recording…"
        "rendering" -> "Putting it together…"
        "failed" -> error?.takeIf { it.isNotEmpty() } ?: "Something went wrong"
        "ready" -> listOfNotNull(
            durationMs?.takeIf { it != 0L }?.let { durationLabel(it.toDouble()) },
            wordCount.takeIf { it != 0 }?.let { "$it words" },
            formatMb(sizeBytes).takeIf { it.isNotEmpty() },
        ).joinToString(" · ")
        else -> ""
    }

    /** True while the server is still making it (the list polls). */
    fun isBuilding(status: String): Boolean = status != "ready" && status != "failed"

    /** Port of AUDIO_LESSON_INPUT_LIMITS (shared/audio-lesson/types.ts). */
    object Limits {
        const val DESCRIPTION = 1000
        const val DIALOGUE = 4000
        const val TEXT = 20_000
        const val MIN_MINUTES = 5
        const val MAX_MINUTES = 40
        fun defaultMinutes(format: String): Int = if (format == "sleep") 20 else 12
    }
}
