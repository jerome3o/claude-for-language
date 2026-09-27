package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Pinyin
import dev.jeromeswannack.chineselearning.lab.data.api.CallDetailDto
import dev.jeromeswannack.chineselearning.lab.data.api.CallListItemDto
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToLong

/** The words and rules of the web's calls pages (CallsListPage / CallReviewPage), without Compose. */
object CallsFormat {
    val STATUS_TEXT = mapOf(
        "none" to "Not processed yet",
        "waiting_uploads" to "Waiting for recordings to finish uploading…",
        "transcribing" to "Transcribing…",
        "summarizing" to "Writing the lesson notes…",
        "done" to "Ready",
        "failed" to "Something went wrong",
    )

    val TRANSCRIBER_NAME = mapOf("gemini" to "Gemini", "soniox" to "Soniox", "whisper" to "Whisper (Workers AI)")

    private val HAN = Regex("[㐀-鿿]")
    private val HAN_RUN = Regex("[\u3400-\u9fff]+")

    /** `toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })`. */
    fun whenText(epochMs: Long, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String =
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale).format(Instant.ofEpochMilli(epochMs).atZone(zone))

    private fun createdMs(createdAt: String): Long = runCatching { Js.parseDate(createdAt) }.getOrDefault(0L)

    private fun minutes(start: Long, end: Long) = max(1L, ((end - start) / 60_000.0).roundToLong())

    /** The list row's line: when · N min · state (web: callMeta). */
    fun meta(c: CallListItemDto, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String {
        val w = whenText(c.started_at ?: createdMs(c.created_at), zone, locale)
        if (c.status == "live") return w
        val mins = if (c.started_at != null && c.ended_at != null) " · ${minutes(c.started_at, c.ended_at)} min" else ""
        val state = when {
            c.has_summary -> " · notes ready"
            c.processing_status == "done" -> " · transcript ready"
            c.processing_status == "failed" -> " · processing failed"
            c.processing_status == "none" -> ""
            else -> " · processing…"
        }
        return "$w$mins$state"
    }

    fun listTitle(c: CallListItemDto): String = c.title ?: c.other_user_name?.let { "Lesson with $it" } ?: "Test call"

    fun listIcon(c: CallListItemDto): String = if (c.status == "live") "🔴" else if (c.has_summary) "📝" else "📼"

    /** Still being processed — the review page polls (web: isBusy). */
    fun isBusy(d: CallDetailDto?): Boolean {
        if (d == null) return false
        val s = d.call.processing_status
        return d.call.status == "live" || s == "waiting_uploads" || s == "transcribing" || s == "summarizing" ||
            (d.call.status == "ended" && s == "none" && d.pieces.any { it.status != "done" && it.status != "failed" })
    }

    fun durationText(d: CallDetailDto): String {
        val s = d.call.started_at ?: return ""
        val e = d.call.ended_at ?: return ""
        return "${minutes(s, e)} min"
    }

    fun title(d: CallDetailDto, myId: String?): String {
        val other = d.participants.firstOrNull { it.id != myId }
        return d.call.title ?: other?.let { "Lesson with ${it.displayName}" } ?: "Video call"
    }

    /** A line's pinyin: the transcriber's, else made on the phone when the line has hanzi (web: segPinyin). */
    fun segPinyin(text: String, pinyin: String?): String? {
        if (!pinyin.isNullOrBlank()) return pinyin
        if (!HAN.containsMatchIn(text)) return null
        // Like pinyin-pro's `nonZh: 'consecutive'`: only the Han runs become pinyin, the rest stays as written.
        return runCatching {
            HAN_RUN.replace(text) { m -> " " + Pinyin.toPinyin(m.value).trim() + " " }.replace(Regex(" {2,}"), " ").trim()
        }.getOrNull()?.takeIf { it.isNotBlank() }
    }

    /** "New deck: Lesson 2026-09-27" — the date of the call in UTC, like `toISOString().slice(0, 10)`. */
    fun defaultDeckName(startedAt: Long?, now: Long = System.currentTimeMillis()): String =
        "Lesson ${Instant.ofEpochMilli(startedAt ?: now).toString().take(10)}"

    fun plural(n: Int, word: String) = "$n $word${if (n == 1) "" else "s"}"
}
