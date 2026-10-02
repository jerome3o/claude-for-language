package dev.jeromeswannack.chineselearning.lab.ui.calls

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.Pinyin
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLessons
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

    /** A lesson of several calls: from the first call's start to the last one's end (web: durationText). */
    fun durationText(d: CallDetailDto): String {
        val calls = d.lesson?.calls.orEmpty()
        val s = (if (calls.size > 1) calls.first().started_at else d.call.started_at) ?: return ""
        val e = (if (calls.size > 1) calls.last().ended_at else d.call.ended_at) ?: return ""
        return "${minutes(s, e)} min"
    }

    /** How many calls the lesson was (1 without a lesson). */
    fun lessonCallCount(d: CallDetailDto): Int = d.lesson?.calls?.size?.takeIf { it > 0 } ?: 1

    /** `toLocaleTimeString(undefined, { timeStyle: 'short' })`. */
    fun timeText(epochMs: Long, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String =
        DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(Instant.ofEpochMilli(epochMs).atZone(zone))

    /** One call of a lesson: "12:31–12:53", "13:32 (live)" (web: the review page's lesson box / the list's call line). */
    fun callSpan(status: String, startedAt: Long?, endedAt: Long?, createdAt: String, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String {
        val from = timeText(startedAt ?: createdMs(createdAt), zone, locale)
        return from + when {
            status == "live" -> " (live)"
            endedAt != null -> "–" + timeText(endedAt, zone, locale)
            else -> ""
        }
    }

    /** The Past calls list's entries: one per lesson, newest first (port of groupCallsByLesson). */
    fun groupByLesson(calls: List<CallListItemDto>): List<CallLessons.Group<CallListItemDto>> =
        CallLessons.groupCallsByLesson(calls, { it.id }, { it.lesson_id }, { it.created_at })

    /** The call a lesson entry opens: the live one, else the latest. */
    fun lessonHead(group: List<CallListItemDto>): CallListItemDto = group.firstOrNull { it.status == "live" } ?: group.last()

    fun lessonTitle(group: List<CallListItemDto>): String {
        val head = lessonHead(group)
        return group.firstNotNullOfOrNull { it.title?.takeIf { t -> t.isNotEmpty() } } ?: head.other_user_name?.let { "Lesson with $it" } ?: "Test call"
    }

    fun lessonIcon(group: List<CallListItemDto>): String = if (group.any { it.status == "live" }) "🔴" else if (group.any { it.has_summary }) "📝" else "📼"

    /** "Oct 2, 2026, 12:31 · 57 min · 4 calls · notes ready" (web: lessonMeta); a one-call lesson reads like before. */
    fun lessonMeta(group: List<CallListItemDto>, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String {
        val first = group.first()
        val last = group.last()
        if (group.size == 1) return meta(first, zone, locale)
        val w = whenText(first.started_at ?: createdMs(first.created_at), zone, locale)
        val live = group.any { it.status == "live" }
        val span = if (!live && first.started_at != null && last.ended_at != null) " · ${minutes(first.started_at, last.ended_at)} min" else ""
        val notes = if (group.any { it.has_summary }) " · notes ready" else ""
        return "$w$span · ${group.size} calls$notes"
    }

    /** The calls under a lesson entry: "1. 12:31–12:53", "2. 12:54–13:11", … */
    fun lessonCallLines(group: List<CallListItemDto>, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): List<String> =
        group.mapIndexed { i, c ->
            val from = timeText(c.started_at ?: createdMs(c.created_at), zone, locale)
            "${i + 1}. $from" + when {
                c.status == "live" -> " (live)"
                c.started_at != null && c.ended_at != null -> "–" + timeText(c.ended_at, zone, locale)
                else -> ""
            }
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

    /** The connection log's rows: "m:ss" since the first event, who, kind, detail (web: the review page's Connection log). */
    fun diagRows(events: List<dev.jeromeswannack.chineselearning.lab.data.api.CallDiagDto>): List<DiagRow> {
        if (events.isEmpty()) return emptyList()
        val sorted = events.sortedBy { it.t }
        val first = sorted.first().t
        return sorted.map { e ->
            val s = maxOf(0L, (e.t - first) / 1000)
            DiagRow("${s / 60}:${(s % 60).toString().padStart(2, '0')}", e.name.ifBlank { "?" }, e.kind, e.detail)
        }
    }

    data class DiagRow(val time: String, val who: String, val kind: String, val detail: String)
}
