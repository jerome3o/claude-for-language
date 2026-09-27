package dev.jeromeswannack.chineselearning.lab.ui.connections

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/** Small formatters shared by the Tutor tab screens (web: components/tutor/format.ts, ConnectionDetailPage). */
object Fmt {
    /** Server timestamps: ISO, or SQLite's "YYYY-MM-DD HH:MM:SS" in UTC. */
    fun parse(iso: String?): Instant? {
        if (iso.isNullOrBlank()) return null
        return runCatching { Instant.parse(iso) }.getOrNull()
            ?: runCatching { Instant.parse(if (iso.endsWith("Z")) iso.replaceFirst(' ', 'T') else iso.replaceFirst(' ', 'T') + "Z") }.getOrNull()
            ?: runCatching { LocalDateTime.parse(iso.replaceFirst(' ', 'T')).toInstant(ZoneOffset.UTC) }.getOrNull()
    }

    private val shortMonthDay = DateTimeFormatter.ofPattern("MMM d", Locale.US)
    private val time = DateTimeFormatter.ofPattern("h:mm a", Locale.US)
    private val weekday = DateTimeFormatter.ofPattern("EEE", Locale.US)

    /** "today", "yesterday", "3 days ago", else "Sep 12" (web: relativeDay). */
    fun relativeDay(iso: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val d = parse(iso) ?: return iso ?: "never"
        val days = ChronoUnit.DAYS.between(d.atZone(zone).toLocalDate(), now.atZone(zone).toLocalDate())
        return when {
            days <= 0 -> "today"
            days == 1L -> "yesterday"
            days < 14 -> "$days days ago"
            else -> shortMonthDay.format(d.atZone(zone))
        }
    }

    /** "9:41 AM" today, "Yesterday", "Tue" within a week, else "Sep 12" (web: formatConversationDate). */
    fun conversationDate(iso: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        val d = parse(iso) ?: return ""
        val diffDays = Math.floorDiv(now.toEpochMilli() - d.toEpochMilli(), 86_400_000L)
        val z = d.atZone(zone)
        return when {
            diffDays == 0L -> time.format(z)
            diffDays == 1L -> "Yesterday"
            diffDays < 7 -> weekday.format(z)
            else -> shortMonthDay.format(z)
        }
    }

    /** "Sep 12, 9:41 AM" (web: shortDateTime). */
    fun shortDateTime(iso: String?, zone: ZoneId = ZoneId.systemDefault()): String {
        val d = parse(iso) ?: return iso.orEmpty()
        val z = d.atZone(zone)
        return "${shortMonthDay.format(z)}, ${time.format(z)}"
    }

    fun plural(n: Int, word: String, pluralWord: String = "${word}s") = "$n ${if (n == 1) word else pluralWord}"
}
