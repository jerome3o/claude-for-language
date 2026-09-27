package dev.jeromeswannack.chineselearning.lab.ui.teaching

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.roundToLong

/**
 * The tutor screens' little formatters — a port of `components/tutor/format.ts`, with the
 * clock and zone injectable for tests. Server timestamps are ISO or SQLite
 * ("2026-09-25 10:01:02", UTC); both parse here.
 */
object TeachingFormat {
    private val MONTH_DAY = DateTimeFormatter.ofPattern("MMM d", Locale.US)
    private val MONTH_DAY_YEAR = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)
    private val WEEKDAY_MONTH_DAY = DateTimeFormatter.ofPattern("EEE, MMM d", Locale.US)
    private val TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

    /** An ISO / SQLite timestamp as an Instant (a missing zone means UTC, like the web's `${iso}Z`). */
    fun parse(iso: String?): Instant? {
        if (iso.isNullOrBlank()) return null
        val s = iso.trim().replace(' ', 'T')
        return runCatching { Instant.parse(s) }.getOrNull()
            ?: runCatching { java.time.OffsetDateTime.parse(s).toInstant() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(s.removeSuffix("Z")).toInstant(ZoneOffset.UTC) }.getOrNull()
            ?: runCatching { LocalDate.parse(s).atStartOfDay().toInstant(ZoneOffset.UTC) }.getOrNull()
    }

    private fun jsRound(x: Double): Long = Math.floor(x + 0.5).toLong()

    /** "just now", "5 min ago", "3 hours ago", "4 days ago", "2 weeks ago", else "Sep 3". */
    fun relativeTime(iso: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        if (iso.isNullOrBlank()) return "never"
        val d = parse(iso) ?: return iso
        val diff = now.toEpochMilli() - d.toEpochMilli()
        val minutes = jsRound(diff / 60_000.0)
        if (minutes < 1) return "just now"
        if (minutes < 60) return "$minutes min ago"
        val hours = jsRound(minutes / 60.0)
        if (hours < 24) return "$hours hour${if (hours == 1L) "" else "s"} ago"
        val days = jsRound(hours / 24.0)
        if (days < 14) return "$days day${if (days == 1L) "" else "s"} ago"
        val weeks = jsRound(days / 7.0)
        if (days < 60) return "$weeks week${if (weeks == 1L) "" else "s"} ago"
        return MONTH_DAY.format(d.atZone(zone))
    }

    /** "today", "yesterday", "3 days ago", else a short date. */
    fun relativeDay(iso: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        if (iso.isNullOrBlank()) return "never"
        val d = parse(iso) ?: return iso
        val days = ChronoUnit.DAYS.between(d.atZone(zone).toLocalDate(), now.atZone(zone).toLocalDate())
        return when {
            days <= 0 -> "today"
            days == 1L -> "yesterday"
            days < 14 -> "$days days ago"
            else -> MONTH_DAY.format(d.atZone(zone))
        }
    }

    /** "Sep 3" (with the year when it isn't this year). */
    fun shortDate(iso: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        if (iso.isNullOrBlank()) return ""
        val d = parse(iso)?.atZone(zone) ?: return iso
        return if (d.year != now.atZone(zone).year) MONTH_DAY_YEAR.format(d) else MONTH_DAY.format(d)
    }

    /** "Sep 3, 4:05 PM". */
    fun shortDateTime(iso: String?, now: Instant = Instant.now(), zone: ZoneId = ZoneId.systemDefault()): String {
        if (iso.isNullOrBlank()) return ""
        val d = parse(iso)?.atZone(zone) ?: return iso
        return "${shortDate(iso, now, zone)}, ${TIME.format(d)}"
    }

    /** "4:05 PM" in the viewer's zone. */
    fun time(iso: String?, zone: ZoneId = ZoneId.systemDefault()): String = parse(iso)?.let { TIME.format(it.atZone(zone)) }.orEmpty()

    /** YYYY-MM-DD (already in the viewer's zone) → "Today" / "Yesterday" / "Tue, Sep 15". */
    fun dayLabel(day: String, today: LocalDate = LocalDate.now()): String {
        val d = runCatching { LocalDate.parse(day) }.getOrNull() ?: return day
        return when (ChronoUnit.DAYS.between(d, today)) {
            0L -> "Today"
            1L -> "Yesterday"
            else -> WEEKDAY_MONTH_DAY.format(d)
        }
    }

    fun percent(n: Double?): String = if (n == null) "—" else "${jsRound(n * 100)}%"

    fun minutes(ms: Long): String {
        val m = jsRound(ms / 60_000.0)
        if (m < 1) return if (ms > 0) "<1 min" else "0 min"
        return "$m min"
    }

    fun plural(n: Int, word: String, pluralWord: String = "${word}s"): String = "$n ${if (n == 1) word else pluralWord}"

    fun initial(name: String?, email: String?): String = ((name?.takeIf { it.isNotEmpty() } ?: email?.takeIf { it.isNotEmpty() } ?: "?").first().uppercase())

    /** Seconds as the history explorer shows them: "4.2 s", "1 min 5 s". */
    fun seconds(ms: Long?): String {
        if (ms == null || ms <= 0) return ""
        val s = ms / 1000.0
        return if (s < 60) "${(s * 10).roundToLong() / 10.0} s" else "${(s / 60).toInt()} min ${(s % 60).roundToLong()} s"
    }
}
